import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveSrv: vi.fn(),
  lookup: vi.fn(),
  createConnection: vi.fn()
}));

vi.mock('node:dns/promises', () => ({
  default: { resolveSrv: mocks.resolveSrv, lookup: mocks.lookup }
}));

vi.mock('node:net', () => ({
  default: { createConnection: mocks.createConnection }
}));

const { diagnoseMongoConnectivity, testTcpConnection } = await import('./mongoDiagnostic.js');

// Socket falso que emite el evento indicado en cuanto alguien lo escucha.
function socketThatEmits(event, payload) {
  const socket = new EventEmitter();
  socket.destroy = vi.fn();
  socket.once = (name, listener) => {
    EventEmitter.prototype.once.call(socket, name, listener);
    if (name === event) queueMicrotask(() => socket.emit(event, payload));
    return socket;
  };
  return socket;
}

describe('mongo diagnostic', () => {
  let log;
  let error;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createConnection.mockImplementation(() => socketThatEmits('connect'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.resolveSrv.mockReset();
    mocks.lookup.mockReset();
    mocks.createConnection.mockReset();
  });

  describe('testTcpConnection', () => {
    it('resolves true when the socket connects', async () => {
      const socket = socketThatEmits('connect');
      mocks.createConnection.mockReturnValue(socket);

      await expect(testTcpConnection('db.example', 27017)).resolves.toBe(true);
      expect(socket.destroy).toHaveBeenCalled();
      expect(mocks.createConnection).toHaveBeenCalledWith({
        host: 'db.example',
        port: 27017,
        timeout: 10000
      });
    });

    it('resolves false on timeout', async () => {
      mocks.createConnection.mockReturnValue(socketThatEmits('timeout'));

      await expect(testTcpConnection('db.example', 27017)).resolves.toBe(false);
      expect(error).toHaveBeenCalledWith('[Mongo diagnostic] TCP timeout: db.example:27017');
    });

    it('resolves false on a socket error and reports its code', async () => {
      mocks.createConnection.mockReturnValue(
        socketThatEmits('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))
      );

      await expect(testTcpConnection('db.example', 27017)).resolves.toBe(false);
      expect(error).toHaveBeenCalledWith(
        '[Mongo diagnostic] TCP failed: db.example:27017 - ECONNREFUSED - refused'
      );
    });

    it('reports UNKNOWN when the socket error has no code', async () => {
      mocks.createConnection.mockReturnValue(socketThatEmits('error', new Error('boom')));

      await testTcpConnection('db.example', 27017);

      expect(error).toHaveBeenCalledWith(
        '[Mongo diagnostic] TCP failed: db.example:27017 - UNKNOWN - boom'
      );
    });
  });

  describe('diagnoseMongoConnectivity', () => {
    it('reports a missing url', async () => {
      await diagnoseMongoConnectivity('');

      expect(error).toHaveBeenCalledWith('[Mongo diagnostic] CRED_STATUS_DB_URL no está configurada');
    });

    it('reads the url from CRED_STATUS_DB_URL by default', async () => {
      vi.stubEnv('CRED_STATUS_DB_URL', 'mongodb://db.example:27018/status');
      mocks.lookup.mockResolvedValue([{ address: '10.0.0.4' }]);

      try {
        await diagnoseMongoConnectivity();
      } finally {
        vi.unstubAllEnvs();
      }

      expect(log).toHaveBeenCalledWith('[Mongo diagnostic] Direct target: db.example:27018');
    });

    it('reports an url that cannot be parsed', async () => {
      await diagnoseMongoConnectivity('not a url');

      expect(error).toHaveBeenCalledWith('[Mongo diagnostic] No fue posible interpretar CRED_STATUS_DB_URL');
    });

    it('checks a direct connection on the default port', async () => {
      mocks.lookup.mockResolvedValue([{ address: '10.0.0.4' }, { address: '10.0.0.5' }]);

      await diagnoseMongoConnectivity('mongodb://user:pass@db.example/status');

      expect(log).toHaveBeenCalledWith('[Mongo diagnostic] Connection type: mongodb');
      expect(log).toHaveBeenCalledWith('[Mongo diagnostic] DNS: 10.0.0.4, 10.0.0.5');
      expect(mocks.createConnection).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'db.example', port: 27017 })
      );
    });

    it('stops when the direct host does not resolve', async () => {
      mocks.lookup.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));

      await diagnoseMongoConnectivity('mongodb://db.example:27017');

      expect(error).toHaveBeenCalledWith('[Mongo diagnostic] DNS failed: ENOTFOUND - not found');
      expect(mocks.createConnection).not.toHaveBeenCalled();
    });

    it('reports UNKNOWN when the direct lookup error has no code', async () => {
      mocks.lookup.mockRejectedValue(new Error('dns down'));

      await diagnoseMongoConnectivity('mongodb://db.example:27017');

      expect(error).toHaveBeenCalledWith('[Mongo diagnostic] DNS failed: UNKNOWN - dns down');
    });

    it('checks every SRV target of a mongodb+srv url', async () => {
      mocks.resolveSrv.mockResolvedValue([
        { name: 'shard-00.example.', port: 27017 },
        { name: 'shard-01.example', port: 27018 }
      ]);
      mocks.lookup.mockResolvedValue([{ address: '10.0.0.4' }]);

      await diagnoseMongoConnectivity('mongodb+srv://user:pass@cluster.example/status');

      expect(log).toHaveBeenCalledWith('[Mongo diagnostic] Connection type: mongodb+srv');
      expect(mocks.resolveSrv).toHaveBeenCalledWith('_mongodb._tcp.cluster.example');
      expect(log).toHaveBeenCalledWith('[Mongo diagnostic] SRV target: shard-00.example:27017');
      expect(log).toHaveBeenCalledWith('[Mongo diagnostic] Target DNS: 10.0.0.4');
      expect(mocks.createConnection).toHaveBeenCalledTimes(2);
    });

    it('stops when the SRV lookup fails', async () => {
      mocks.resolveSrv.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }));

      await diagnoseMongoConnectivity('mongodb+srv://cluster.example');

      expect(error).toHaveBeenCalledWith('[Mongo diagnostic] SRV lookup failed: ETIMEOUT - timeout');
    });

    it('reports UNKNOWN when the SRV lookup error has no code', async () => {
      mocks.resolveSrv.mockRejectedValue(new Error('srv down'));

      await diagnoseMongoConnectivity('mongodb+srv://cluster.example');

      expect(error).toHaveBeenCalledWith('[Mongo diagnostic] SRV lookup failed: UNKNOWN - srv down');
    });

    it('stops when the SRV lookup returns no servers', async () => {
      mocks.resolveSrv.mockResolvedValue([]);

      await diagnoseMongoConnectivity('mongodb+srv://cluster.example');

      expect(error).toHaveBeenCalledWith('[Mongo diagnostic] SRV lookup returned no servers');
    });

    it('skips an SRV target whose host does not resolve and keeps checking the rest', async () => {
      mocks.resolveSrv.mockResolvedValue([
        { name: 'broken.example', port: 27017 },
        { name: 'healthy.example', port: 27017 }
      ]);
      mocks.lookup
        .mockRejectedValueOnce(new Error('no such host'))
        .mockResolvedValueOnce([{ address: '10.0.0.6' }]);

      await diagnoseMongoConnectivity('mongodb+srv://cluster.example');

      expect(error).toHaveBeenCalledWith(
        '[Mongo diagnostic] Target DNS failed for broken.example: UNKNOWN - no such host'
      );
      expect(mocks.createConnection).toHaveBeenCalledTimes(1);
      expect(mocks.createConnection).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'healthy.example' })
      );
    });

    it('reports the code when an SRV target lookup fails with one', async () => {
      mocks.resolveSrv.mockResolvedValue([{ name: 'broken.example', port: 27017 }]);
      mocks.lookup.mockRejectedValue(Object.assign(new Error('gone'), { code: 'ENOTFOUND' }));

      await diagnoseMongoConnectivity('mongodb+srv://cluster.example');

      expect(error).toHaveBeenCalledWith(
        '[Mongo diagnostic] Target DNS failed for broken.example: ENOTFOUND - gone'
      );
    });
  });
});
