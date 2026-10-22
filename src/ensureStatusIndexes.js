/**
 * Idempotent MongoDB schema protection for DCC Status.
 *
 * Call only AFTER createStatusManager() finishes its existing auto-deploy.
 * Never delete or repair records during boot. Existing duplicates or lack of
 * index permissions must fail startup (no allocations in an unsafe state).
 */
export async function ensureStatusIndexes(statusManager) {
  const { client, database } = await statusManager.connectDatabase();
  try {
    const credentials = database.collection(statusManager.userCredentialTableName);

    // MongoDB's default _id index is NOT a unique index on the app-level `id`.
    await credentials.createIndex(
      { id: 1 },
      { unique: true, name: 'ux_user_credential_id' }
    );

    // This service only allocates revocation status. Status-list positions must
    // be unique per list, even when requests reach different app replicas.
    await credentials.createIndex(
      {
        'statusInfo.revocation.statusCredentialId': 1,
        'statusInfo.revocation.statusListIndex': 1
      },
      { unique: true, name: 'ux_revocation_status_index' }
    );

    // Fail closed if the index is missing, nonunique, or incompatible.
    const indexes = await credentials.listIndexes().toArray();
    for (const name of ['ux_user_credential_id', 'ux_revocation_status_index']) {
      const index = indexes.find(item => item.name === name);
      if (index?.unique !== true) {
        throw new Error(`Required unique MongoDB index was not created: ${name}`);
      }
    }
    console.info('[DCC Status] MongoDB unique indexes verified.');
  } finally {
    await statusManager.disconnectDatabase(client);
  }
}
