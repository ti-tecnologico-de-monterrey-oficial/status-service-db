import dns from 'node:dns/promises';
import net from 'node:net';

export async function testTcpConnection(host, port) {
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

function formatAddresses(addresses) {
  return addresses
    .map(address => address.address)
    .join(', ');
}

async function diagnoseSrvConnection(seedHost) {
  const srvRecord = `_mongodb._tcp.${seedHost}`;

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
        `[Mongo diagnostic] Target DNS: ${formatAddresses(addresses)}`
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
}

async function diagnoseDirectConnection(seedHost, urlPort) {
  const port = Number(urlPort || 27017);

  console.log(
    `[Mongo diagnostic] Direct target: ${seedHost}:${port}`
  );

  try {
    const addresses = await dns.lookup(seedHost, {
      all: true
    });

    console.log(
      `[Mongo diagnostic] DNS: ${formatAddresses(addresses)}`
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

/**
 * Registra en el log si el host de CRED_STATUS_DB_URL resuelve y acepta
 * conexiones TCP. Solo informa: nunca detiene el arranque.
 */
export async function diagnoseMongoConnectivity(
  mongoUrl = process.env.CRED_STATUS_DB_URL
) {
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
  const isSrvConnection = parsedUrl.protocol === 'mongodb+srv:';

  console.log(
    `[Mongo diagnostic] Connection type: ${
      isSrvConnection ? 'mongodb+srv' : 'mongodb'
    }`
  );

  console.log(
    `[Mongo diagnostic] Seed host: ${seedHost}`
  );

  if (isSrvConnection) {
    await diagnoseSrvConnection(seedHost);
    return;
  }

  await diagnoseDirectConnection(seedHost, parsedUrl.port);
}
