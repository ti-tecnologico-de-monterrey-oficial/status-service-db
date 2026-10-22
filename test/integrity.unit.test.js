import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MongoDbCredentialStatusManager } from '../node_modules/@digitalcredentials/credential-status-manager-db/dist/credential-status-manager-mongodb.js';
import { WriteConflictError, NotFoundError } from '../node_modules/@digitalcredentials/credential-status-manager-db/dist/errors.js';
import testVC from '../src/test-fixtures/testVC.js';
import { ensureStatusIndexes } from '../src/ensureStatusIndexes.js';

function managerWithCollection(collection) {
  const manager = new MongoDbCredentialStatusManager({
    didMethod: 'key', didSeed: 'test-nonproduction-seed',
    statusCredentialSiteOrigin: 'https://example.invalid/status',
    databaseName: 'unit_test_only'
  });
  let closed = 0;
  manager.connectDatabase = async () => ({
    client: {}, database: { collection: () => collection }
  });
  manager.disconnectDatabase = async () => { closed++; };
  return { manager, getClosed: () => closed };
}

test('insert errors are propagated (no false HTTP success)', async () => {
  const { manager, getClosed } = managerWithCollection({
    insertOne: async () => { throw Object.assign(new Error('write failed'), { code: 55 }); }
  });
  await assert.rejects(manager.createRecord('UserCredential', { id: 'x' }), /write failed/);
  assert.equal(getClosed(), 1);
});

test('unacknowledged inserts fail', async () => {
  const { manager } = managerWithCollection({ insertOne: async () => ({ acknowledged: false }) });
  await assert.rejects(manager.createRecord('UserCredential', { id: 'x' }), /did not acknowledge/);
});

test('replace fails if Config does not match', async () => {
  const { manager } = managerWithCollection({
    replaceOne: async () => ({ acknowledged: true, matchedCount: 0 })
  });
  await assert.rejects(manager.updateRecord('Config', 'id', 'config', { id: 'config' }), /expected one matching document/);
});

test('replace accepts matched unchanged documents', async () => {
  const { manager } = managerWithCollection({
    replaceOne: async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 0 })
  });
  await manager.updateRecord('Config', 'id', 'config', { id: 'config' });
});

test('duplicate revocation index is retryable; duplicate credential id is not', async () => {
  const { manager } = managerWithCollection({
    insertOne: async () => { throw Object.assign(new Error('E11000 index: ux_revocation_status_index'), { code: 11000 }); }
  });
  await assert.rejects(manager.createRecord('UserCredential', { id: 'x' }), WriteConflictError);

  const { manager: other } = managerWithCollection({
    insertOne: async () => { throw Object.assign(new Error('E11000 index: ux_user_credential_id'), { code: 11000 }); }
  });
  await assert.rejects(other.createRecord('UserCredential', { id: 'x' }), error => {
    assert.equal(error.code, 11000);
    assert.equal(error instanceof WriteConflictError, false);
    return true;
  });
});

test('transaction recomputes after a WriteConflict and closes each session', async () => {
  let attempts = 0;
  let closed = 0;
  let ended = 0;
  const { manager } = managerWithCollection({});
  manager.connectDatabase = async () => ({
    client: { startSession: () => ({
      withTransaction: async callback => callback(),
      endSession: async () => { ended++; }
    }) }
  });
  manager.disconnectDatabase = async () => { closed++; };
  const result = await manager.executeTransaction(async () => {
    attempts++;
    if (attempts === 1) throw new WriteConflictError({ message: 'collision' });
    return 'position 2';
  });
  assert.equal(result, 'position 2');
  assert.equal(attempts, 2);
  assert.equal(ended, 2);
  assert.equal(closed, 2);
});

test('persistent conflicts terminate after a bounded number of attempts', async () => {
  let attempts = 0;
  const { manager } = managerWithCollection({});
  manager.connectDatabase = async () => ({
    client: { startSession: () => ({
      withTransaction: async callback => callback(),
      endSession: async () => {}
    }) }
  });
  await assert.rejects(manager.executeTransaction(async () => {
    attempts++;
    throw new WriteConflictError({ message: 'collision forever' });
  }), WriteConflictError);
  assert.equal(attempts, 9);
});

test('startup creates and verifies two unique indexes', async () => {
  const created = [];
  const { manager, getClosed } = managerWithCollection({
    createIndex: async (spec, opts) => { created.push({spec, opts}); },
    listIndexes: () => ({ toArray: async () => created.map(item => ({name:item.opts.name,unique:item.opts.unique})) })
  });
  await ensureStatusIndexes(manager);
  assert.deepEqual(created.map(item => item.opts.name), ['ux_user_credential_id', 'ux_revocation_status_index']);
  assert.ok(created.every(item => item.opts.unique));
  assert.equal(getClosed(), 1);
});

test('startup fails closed if legacy data contains a duplicate', async () => {
  const { manager, getClosed } = managerWithCollection({
    createIndex: async () => { throw new Error('E11000 duplicate key'); }
  });
  await assert.rejects(ensureStatusIndexes(manager), /duplicate key/);
  assert.equal(getClosed(), 1);
});

function mockAllocationManager() {
  const { manager } = managerWithCollection({});
  manager.getConfigRecord = async () => ({
    id: 'config', credentialsIssuedCounter: 0,
    statusCredentialInfo: {
      revocation: {
        latestStatusCredentialId: 'list-one',
        latestCredentialsIssuedCounter: 0,
        statusCredentialsCounter: 1
      }
    }
  });
  return manager;
}

test('a missing credential legitimately receives an initial index', async () => {
  const manager = mockAllocationManager();
  manager.getUserCredentialRecordById = async () => {
    throw new NotFoundError({ message: 'new credential' });
  };
  const result = await manager.attachCredentialStatus({
    credential: structuredClone(testVC), statusPurposes: ['revocation']
  });
  assert.equal(result.newUserCredential, true);
  assert.equal(result.credentialStatusInfo.revocation.statusListIndex, 1);
});

test('failed credential lookup aborts instead of allocating again', async () => {
  const manager = mockAllocationManager();
  manager.getUserCredentialRecordById = async () => {
    throw new Error('MongoDB read unavailable');
  };
  await assert.rejects(manager.attachCredentialStatus({
    credential: structuredClone(testVC), statusPurposes: ['revocation']
  }), /MongoDB read unavailable/);
});
