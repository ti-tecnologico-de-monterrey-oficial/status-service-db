import { afterEach, describe, expect, it, vi } from 'vitest';

// El nivel y los transports se calculan al importar el módulo, así que cada
// caso lo vuelve a cargar con el entorno ya fijado.
async function loadLogger(env) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  const { default: logger } = await import('./logger.js');
  return logger;
}

describe('logger', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses LOG_LEVEL when it is set', async () => {
    expect((await loadLogger({ LOG_LEVEL: 'info' })).level).toBe('info');
  });

  it('logs everything in development when LOG_LEVEL is empty', async () => {
    expect((await loadLogger({ LOG_LEVEL: '', NODE_ENV: 'development' })).level).toBe('silly');
  });

  it('treats a missing NODE_ENV as development', async () => {
    expect((await loadLogger({ LOG_LEVEL: '', NODE_ENV: undefined })).level).toBe('silly');
  });

  it('only logs warnings and errors outside development', async () => {
    expect((await loadLogger({ LOG_LEVEL: '', NODE_ENV: 'production' })).level).toBe('warn');
  });
});
