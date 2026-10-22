import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureStatusIndexes } from './ensureStatusIndexes.js';

function managerWithIndexes(indexes) {
  const collection = {
    createIndex: vi.fn().mockResolvedValue(),
    listIndexes: () => ({ toArray: async () => indexes })
  };
  return {
    userCredentialTableName: 'UserCredential',
    connectDatabase: vi.fn().mockResolvedValue({
      client: 'client',
      database: { collection: () => collection }
    }),
    disconnectDatabase: vi.fn().mockResolvedValue(),
    collection
  };
}

const uniqueIndexes = [
  { name: 'ux_user_credential_id', unique: true },
  { name: 'ux_revocation_status_index', unique: true }
];

describe('ensureStatusIndexes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates both unique indexes and disconnects', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const manager = managerWithIndexes(uniqueIndexes);

    await ensureStatusIndexes(manager);

    expect(manager.collection.createIndex).toHaveBeenCalledTimes(2);
    expect(manager.disconnectDatabase).toHaveBeenCalledWith('client');
  });

  it('fails closed when an index is missing', async () => {
    const manager = managerWithIndexes([uniqueIndexes[0]]);

    await expect(ensureStatusIndexes(manager)).rejects.toThrow(
      'Required unique MongoDB index was not created: ux_revocation_status_index'
    );
    expect(manager.disconnectDatabase).toHaveBeenCalledWith('client');
  });

  it('fails closed when an index exists but is not unique', async () => {
    const manager = managerWithIndexes([
      { name: 'ux_user_credential_id', unique: false },
      uniqueIndexes[1]
    ]);

    await expect(ensureStatusIndexes(manager)).rejects.toThrow(
      'Required unique MongoDB index was not created: ux_user_credential_id'
    );
  });
});
