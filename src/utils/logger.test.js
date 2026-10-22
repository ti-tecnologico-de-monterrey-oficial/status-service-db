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

  it('writes to the console and both log files when they are configured', async () => {
    const logger = await loadLogger({
      CONSOLE_LOG_LEVEL: 'info',
      ERROR_LOG_FILE: 'logs/error.log',
      ALL_LOG_FILE: 'logs/all.log'
    });
    expect(logger.transports.map(transport => transport.name)).toEqual(['console', 'file', 'file']);
  });

  it('has no transports when the console is disabled and no files are set', async () => {
    const logger = await loadLogger({ CONSOLE_LOG_LEVEL: 'none', ERROR_LOG_FILE: '', ALL_LOG_FILE: '' });
    expect(logger.transports).toHaveLength(0);
  });
});
