import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { build } from './app.js';
import { getConfig } from './config.js';
import { diagnoseMongoConnectivity } from './mongoDiagnostic.js';
import {
  createShutdown,
  registerShutdownSignals,
  resolveShutdownTimeout
} from './shutdown.js';
import status from './status.js';
import logger from './utils/logger.js';

export function createServer(app, enableHttpsForDev) {
  if (!enableHttpsForDev) {
    return http.createServer(app);
  }

  return https.createServer(
    {
      key: fs.readFileSync('server-dev-only.key'),
      cert: fs.readFileSync('server-dev-only.cert')
    },
    app
  );
}

function logBanner() {
  console.log('==================================================');
  console.log('TEC CUSTOM STATUS SERVICE');
  console.log(`Version: ${process.env.SERVICE_VERSION ?? 'unknown'}`);
  console.log('Bitstring size: 131072');
  console.log(`Node: ${process.version}`);
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log('==================================================');
}

export async function start() {
  logBanner();

  await diagnoseMongoConnectivity();

  const { port, enableHttpsForDev } = getConfig();
  const app = await build();
  const server = createServer(app, enableHttpsForDev);

  await new Promise(resolve => server.listen(port, resolve));

  logger.info(
    `Server running on port ${port} with ${
      enableHttpsForDev ? 'https' : 'http'
    }`
  );

  const shutdown = createShutdown({
    server,
    closeStatusManager: status.closeStatusManager,
    logger,
    timeoutMs: resolveShutdownTimeout(process.env.STATUS_SHUTDOWN_TIMEOUT_MS)
  });

  registerShutdownSignals(shutdown);

  return { server, shutdown };
}
