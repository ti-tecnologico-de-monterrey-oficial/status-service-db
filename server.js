import { build } from './src/app.js';
import { getConfig } from './src/config.js';
import fs from 'fs';
import http from 'http';
import https from 'https';
import logger from './src/utils/logger.js';
import dns from 'node:dns/promises';
import net from 'node:net';

const SERVICE_VERSION = process.env.SERVICE_VERSION ?? 'status-service-db-custom-unknown';

async function testTcpConnection(host, port) {
  return new Promise(resolve => {
    const socket = net.createConnection({
      host,
      port,
      timeout: 10000
    });

    socket.once('connect', () => {
      console.log(
        `[Mongo diagnostic] TCP connection OK: ${host}:${port}`
      );

      socket.destroy();
      resolve(true);
    });

    socket.once('timeout', () => {
      console.error(
        `[Mongo diagnostic] TCP timeout: ${host}:${port}`
      );

      socket.destroy();
      resolve(false);
    });

    socket.once('error', error => {
      console.error(
        `[Mongo diagnostic] TCP failed: ${host}:${port} - ` +
        `${error.code ?? 'UNKNOWN'} - ${error.message}`
      );

      socket.destroy();
      resolve(false);
    });
  });
}

async function diagnoseMongoConnectivity() {
  const mongoUrl = process.env.CRED_STATUS_DB_URL;

  if (!mongoUrl) {
    console.error(
      '[Mongo diagnostic] CRED_STATUS_DB_URL no está configurada'
    );

    return;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(mongoUrl);
  } catch {
    console.error(
      '[Mongo diagnostic] No fue posible interpretar CRED_STATUS_DB_URL'
    );

    return;
  }

  const seedHost = parsedUrl.hostname;
  const isSrvConnection =
    parsedUrl.protocol === 'mongodb+srv:';

  console.log(
    `[Mongo diagnostic] Connection type: ${
      isSrvConnection ? 'mongodb+srv' : 'mongodb'
    }`
  );

  console.log(
    `[Mongo diagnostic] Seed host: ${seedHost}`
  );

  if (isSrvConnection) {
    const srvRecord =
      `_mongodb._tcp.${seedHost}`;

    console.log(
      `[Mongo diagnostic] SRV query: ${srvRecord}`
    );

    let records;

    try {
      records = await dns.resolveSrv(srvRecord);
    } catch (error) {
      console.error(
        `[Mongo diagnostic] SRV lookup failed: ` +
        `${error.code ?? 'UNKNOWN'} - ${error.message}`
      );

      return;
    }

    if (records.length === 0) {
      console.error(
        '[Mongo diagnostic] SRV lookup returned no servers'
      );

      return;
    }

    for (const record of records) {
      const target = record.name.replace(/\.$/, '');
      const port = record.port;

      console.log(
        `[Mongo diagnostic] SRV target: ${target}:${port}`
      );

      try {
        const addresses = await dns.lookup(target, {
          all: true
        });

        console.log(
          `[Mongo diagnostic] Target DNS: ${
            addresses
              .map(address => address.address)
              .join(', ')
          }`
        );
      } catch (error) {
        console.error(
          `[Mongo diagnostic] Target DNS failed for ${target}: ` +
          `${error.code ?? 'UNKNOWN'} - ${error.message}`
        );

        continue;
      }

      await testTcpConnection(target, port);
    }

    return;
  }

  const port = Number(
    parsedUrl.port || 27017
  );

  console.log(
    `[Mongo diagnostic] Direct target: ${seedHost}:${port}`
  );

  try {
    const addresses = await dns.lookup(seedHost, {
      all: true
    });

    console.log(
      `[Mongo diagnostic] DNS: ${
        addresses
          .map(address => address.address)
          .join(', ')
      }`
    );
  } catch (error) {
    console.error(
      `[Mongo diagnostic] DNS failed: ` +
      `${error.code ?? 'UNKNOWN'} - ${error.message}`
    );

    return;
  }

  await testTcpConnection(seedHost, port);
}

const run = async () => {
  console.log('==================================================');
  console.log('TEC CUSTOM STATUS SERVICE');
  console.log(
    `Version: ${
      process.env.SERVICE_VERSION ?? 'unknown'
    }`
  );
  console.log('Bitstring size: 131072');
  console.log(`Node: ${process.version}`);
  console.log(
    `Started at: ${new Date().toISOString()}`
  );
  console.log('==================================================');

  await diagnoseMongoConnectivity();
 
  const { port, enableHttpsForDev } = getConfig();
  const app = await build();

  if (enableHttpsForDev) {
    https
      .createServer(
        {
          key: fs.readFileSync('server-dev-only.key'),
          cert: fs.readFileSync('server-dev-only.cert')
        },
        app
      ).listen(port, () => logger.info(`Server running on port ${port} with https`));
  } else {
    http
      .createServer(app).listen(port, () => logger.info(`Server running on port ${port} with http`));
  }
};

run();
