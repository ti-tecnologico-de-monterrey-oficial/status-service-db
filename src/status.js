import { createStatusManager } from '@digitalcredentials/credential-status-manager-db';
import { getConfig } from './config.js';
import { ensureStatusIndexes } from './ensureStatusIndexes.js';

const {
  credStatusService,
  statusCredSiteOrigin,
  credStatusDatabaseUrl,
  credStatusDatabaseHost,
  credStatusDatabasePort,
  credStatusDatabaseUsername,
  credStatusDatabasePassword,
  credStatusDatabaseName,
  statusCredTableName,
  userCredTableName,
  configTableName,
  eventTableName,
  credEventTableName,
  credStatusDidSeed
} = getConfig();

let STATUS_LIST_MANAGER;
let STATUS_LIST_MANAGER_PROMISE = null;

async function createMongoDbStatusManager() {
  return createStatusManager({
    statusCredentialSiteOrigin: statusCredSiteOrigin,
    databaseService: credStatusService,
    databaseUrl: credStatusDatabaseUrl,
    databaseHost: credStatusDatabaseHost,
    databasePort: credStatusDatabasePort,
    databaseUsername: credStatusDatabaseUsername,
    databasePassword: credStatusDatabasePassword,
    databaseName: credStatusDatabaseName,
    statusCredentialTableName: statusCredTableName,
    userCredentialTableName: userCredTableName,
    configTableName,
    eventTableName,
    credentialEventTableName: credEventTableName,
    didMethod: 'key',
    didSeed: credStatusDidSeed,
    // This is the already the default value,
    // but setting here to be explicit
    autoDeployDatabase: true,
    // This is the already the default value,
    // but setting here to be explicit
    signStatusCredential: true,
    // This is the already the default value,
    // but setting here to be explicit
    signUserCredential: false
  });
}

/* we allow passing in a status manager, for testing */
async function initializeStatusManager(statusManager) {
  // Mantener compatibilidad con las pruebas existentes.
  if (statusManager) {
    STATUS_LIST_MANAGER = statusManager;
    return;
  }

  // El manager ya est� inicializado.
  if (STATUS_LIST_MANAGER) {
    return;
  }

  // Crear una sola promesa de inicializaci�n.
  if (!STATUS_LIST_MANAGER_PROMISE) {
    STATUS_LIST_MANAGER_PROMISE = (async () => {
      switch (credStatusService) {
        case 'mongodb': {
          const initializedManager =
            await createMongoDbStatusManager();

          // Los �ndices deben existir antes de publicar el manager.
          await ensureStatusIndexes(initializedManager);

          STATUS_LIST_MANAGER = initializedManager;
          break;
        }

        default:
          throw new Error(
            `Encountered unsupported credential status service: ${credStatusService}`
          );
      }
    })();
  }

  // Las llamadas concurrentes esperan la misma inicializaci�n.
  const initialization = STATUS_LIST_MANAGER_PROMISE;

  try {
    await initialization;
  } catch (error) {
    // Permitir otro intento si falla la inicializaci�n.
    if (STATUS_LIST_MANAGER_PROMISE === initialization) {
      STATUS_LIST_MANAGER_PROMISE = null;
    }

    throw error;
  }
}

async function getStatusManager() {
  await initializeStatusManager();
  return STATUS_LIST_MANAGER;
}

/**
 * V2.2
 * Cierra las conexiones MongoDB compartidas cuando
 * el servidor HTTP termina de procesar sus solicitudes.
 */
async function closeStatusManager() {
  if (!STATUS_LIST_MANAGER) {
    return;
  }

  if (
    typeof STATUS_LIST_MANAGER.closeSharedDatabaseClient ===
    'function'
  ) {
    await STATUS_LIST_MANAGER.closeSharedDatabaseClient();

    console.info(
      '[STATUS_POOL] MongoDB shared client closed.'
    );
  }
}

async function allocateRevocationStatus(verifiableCredential) {
  const statusManager = await getStatusManager();
  const result = verifiableCredential.credentialStatus ?
    verifiableCredential :
    await statusManager.allocateRevocationStatus(verifiableCredential);
  return result;
}

async function updateStatus(credentialId, credentialStatus) {
  const statusManager = await getStatusManager();
  try {
    switch (credentialStatus) {
      case 'revoked':
        await statusManager.revokeCredential(credentialId);
        return { code: 200, message: 'Credential successfully revoked.' };
      case 'suspended':
        await statusManager.suspendCredential(credentialId);
        return { code: 200, message: 'Credential successfully suspended.' };
      case 'unsuspended':
        await statusManager.unsuspendCredential(credentialId);
        return { code: 200, message: 'Credential successfully unsuspended.' };
      default:
        return { code: 400, message: `Unsupported credential status: "${credentialStatus}"` };
    }
  } catch (error) {
    return {
      code: error.code ?? 500,
      message: error.message ??
        `Unable to apply status "${credentialStatus}" to credential with ID "${credentialId}".`
    };
  }
}

async function getCredentialInfo(credentialId) {
  const statusManager = await getStatusManager();
  return statusManager.getCredentialInfo(credentialId);
}

async function getStatusCredential(statusCredentialId) {
  const statusManager = await getStatusManager();
  return await statusManager.getStatusCredential(statusCredentialId);
}

export default {
  initializeStatusManager,
  getStatusManager,
  closeStatusManager,
  allocateRevocationStatus,
  updateStatus,
  getCredentialInfo,
  getStatusCredential
};
