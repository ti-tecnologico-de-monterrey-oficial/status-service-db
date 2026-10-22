import http from 'node:http';
import https from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfig } from './config.js';
import status from './status.js';

const mocks = vi.hoisted(() => ({ diagnoseMongoConnectivity: vi.fn() }));

vi.mock('./mongoDiagnostic.js', () => ({
  diagnoseMongoConnectivity: mocks.diagnoseMongoConnectivity
}));

const { createServer, start } = await import('./server.js');

describe('server', () => {
  let server;
  let once;

  beforeEach(async () => {
    // Puerto 0: el sistema asigna uno libre y la prueba no choca con otro proceso.
    vi.stubEnv('PORT', '0');
    vi.stubEnv('ENABLE_HTTPS_FOR_DEV', 'false');
    resetConfig();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Las señales se registran sobre el proceso real; aquí solo se comprueba
    // que se pidan, para no dejar listeners colgados en el runner.
    once = vi.spyOn(process, 'once').mockImplementation(() => process);
    await status.initializeStatusManager({});
  });

  afterEach(async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    server = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetConfig();
  });

  it('creates an http server when https for dev is disabled', () => {
    const created = createServer(() => {}, false);

    expect(created).toBeInstanceOf(http.Server);
    expect(created).not.toBeInstanceOf(https.Server);
  });

  it('creates an https server with the dev certificate when enabled', () => {
    expect(createServer(() => {}, true)).toBeInstanceOf(https.Server);
  });

  it('diagnoses MongoDB, listens and registers the shutdown signals', async () => {
    ({ server } = await start());

    expect(mocks.diagnoseMongoConnectivity).toHaveBeenCalledOnce();
    expect(server.listening).toBe(true);
    expect(once).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(once).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  });

  it('prints the service version in the startup banner', async () => {
    vi.stubEnv('SERVICE_VERSION', '0.2.2-test');

    ({ server } = await start());

    expect(console.log).toHaveBeenCalledWith('Version: 0.2.2-test');
  });

  it('starts an https server when https for dev is enabled', async () => {
    vi.stubEnv('ENABLE_HTTPS_FOR_DEV', 'true');
    resetConfig();

    ({ server } = await start());

    expect(server).toBeInstanceOf(https.Server);
  });

  it('returns a shutdown that closes the server', async () => {
    let shutdown;
    ({ server, shutdown } = await start());
    const exitCode = process.exitCode;

    try {
      await shutdown('SIGTERM');
    } finally {
      process.exitCode = exitCode;
    }

    expect(server.listening).toBe(false);
  });
});
