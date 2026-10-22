import { test } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStatusManager } from '@digitalcredentials/credential-status-manager-db';
import { ensureStatusIndexes } from '../src/ensureStatusIndexes.js';
import testVC from '../src/test-fixtures/testVC.js';

// This test is deliberately OPT-IN and refuses ordinary DEV/QA/production DBs.
const url = process.env.V2_MONGO_TEST_URL;
const didSeed = process.env.V2_DID_TEST_SEED;
const dbName = process.env.V2_MONGO_TEST_DB;
const enabled = Boolean(url && didSeed && /^credentialStatus_v2_test_[A-Za-z0-9_]+$/.test(dbName ?? ''));
const guardedTest = enabled ? test : test.skip;

guardedTest('MongoDB real: 1 + 2 + 5 + 10 concurrent allocations preserve all counters',
  { timeout: 180000 }, async () => {
    const manager = await createStatusManager({
      databaseService: 'mongodb',
      databaseUrl: url,
      databaseName: dbName,
      statusCredentialSiteOrigin: 'https://example.invalid/v2-status-integration',
      didMethod: 'key', didSeed,
      autoDeployDatabase: true,
      signStatusCredential: true,
      signUserCredential: false
    });
    await ensureStatusIndexes(manager);

    const {client, database} = await manager.connectDatabase();
    try {
      const user = database.collection(manager.userCredentialTableName);
      const config = database.collection(manager.configTableName);
      const initial = await user.countDocuments({});
      let expected = initial;
      for (const count of [1, 2, 5, 10]) {
        const credentials = Array.from({length: count}, () => ({
          ...structuredClone(testVC), id: `urn:uuid:${randomUUID()}`
        }));
        const results = await Promise.allSettled(credentials.map(vc =>
          manager.allocateRevocationStatus(vc)));
        const failures = results.filter(item => item.status === 'rejected');
        assert.equal(failures.length, 0,
          `Failed for concurrency=${count}: ${failures.map(f => f.reason?.message).join(' | ')}`);

        expected += count;
        const actual = await user.countDocuments({});
        const configuration = await config.findOne({});
        const duplicates = await user.aggregate([
          {$group: {_id: {
            list: '$statusInfo.revocation.statusCredentialId',
            index: '$statusInfo.revocation.statusListIndex'
          }, count: {$sum: 1}}},
          {$match: {count: {$gt: 1}}}
        ]).toArray();
        const unique = await user.aggregate([
          {$group: {_id: {
            list: '$statusInfo.revocation.statusCredentialId',
            index: '$statusInfo.revocation.statusListIndex'
          }}}
        ]).toArray();
        const missing = await user.countDocuments({
          'statusInfo.revocation.statusListIndex': {$exists: false}
        });
        assert.equal(actual, expected, 'UserCredential count');
        assert.equal(configuration.credentialsIssuedCounter, expected, 'Config counter');
        assert.equal(configuration.statusCredentialInfo.revocation.latestCredentialsIssuedCounter,
          expected, 'Revocation counter (valid while within one 131072-slot list)');
        assert.equal(unique.length, expected, 'Unique revocation positions');
        assert.equal(missing, 0, 'Missing revocation positions');
        assert.deepEqual(duplicates, [], 'Duplicate positions');
        assert.equal((await manager.getDatabaseState()).valid, true, 'Library database state');
        console.log(`V2 integration OK: concurrency=${count}, total=${actual}, duplicates=0`);
      }
    } finally {
      await manager.disconnectDatabase(client);
    }
  });
