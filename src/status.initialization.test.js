import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// status.js guarda el manager en el módulo, así que cada caso lo carga de nuevo
// para partir sin estado.
const mocks = vi.hoisted(() => ({
  createStatusManager: vi.fn(),
  ensureStatusIndexes: vi.fn()
}));

vi.mock('@digitalcredentials/credential-status-manager-db', () => ({
  createStatusManager: mocks.createStatusManager
}));

vi.mock('./ensureStatusIndexes.js', () => ({
  ensureStatusIndexes: mocks.ensureStatusIndexes
}));

async function loadStatus() {
  vi.resetModules();
  const { default: status } = await import('./status.js');
  return status;
}

describe('status manager initialization', () => {
  beforeEach(() => {
    mocks.ensureStatusIndexes.mockResolvedValue();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    mocks.createStatusManager.mockReset();
    mocks.ensureStatusIndexes.mockReset();
  });

  it('creates the MongoDB manager from the configuration and verifies its indexes', async () => {
    const manager = {};
    mocks.createStatusManager.mockResolvedValue(manager);
    const status = await loadStatus();

    expect(await status.getStatusManager()).toBe(manager);
    expect(mocks.ensureStatusIndexes).toHaveBeenCalledWith(manager);
    expect(mocks.createStatusManager).toHaveBeenCalledWith(expect.objectContaining({
      databaseService: 'mongodb',
      statusCredentialSiteOrigin: 'https://credentials.example.edu',
      didMethod: 'key',
      autoDeployDatabase: true,
      signStatusCredential: true,
      signUserCredential: false
    }));
  });

  it('shares a single initialization between concurrent callers', async () => {
    let finish;
    mocks.createStatusManager.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const status = await loadStatus();

    const first = status.getStatusManager();
    const second = status.getStatusManager();
    finish({});

    expect(await first).toBe(await second);
    expect(mocks.createStatusManager).toHaveBeenCalledOnce();
  });

  it('does not publish the manager when its indexes cannot be verified, and retries later', async () => {
    const manager = {};
    mocks.createStatusManager.mockResolvedValue(manager);
    mocks.ensureStatusIndexes
      .mockRejectedValueOnce(new Error('duplicate index'))
      .mockResolvedValueOnce();
    const status = await loadStatus();

    await expect(status.getStatusManager()).rejects.toThrow('duplicate index');
    expect(await status.getStatusManager()).toBe(manager);
    expect(mocks.createStatusManager).toHaveBeenCalledTimes(2);
  });

  it('lets every concurrent caller see a failed initialization and retries once', async () => {
    const manager = {};
    mocks.createStatusManager
      .mockRejectedValueOnce(new Error('database offline'))
      .mockResolvedValueOnce(manager);
    const status = await loadStatus();

    const results = await Promise.allSettled([status.getStatusManager(), status.getStatusManager()]);

    expect(results.map(result => result.reason?.message)).toEqual(['database offline', 'database offline']);
    expect(await status.getStatusManager()).toBe(manager);
    expect(mocks.createStatusManager).toHaveBeenCalledTimes(2);
  });

  it('keeps the newer initialization when an older one fails afterwards', async () => {
    let failFirst;
    mocks.createStatusManager
      .mockReturnValueOnce(new Promise((resolve, reject) => { failFirst = reject; }))
      .mockResolvedValueOnce({});
    const status = await loadStatus();

    const first = status.getStatusManager();
    // Una inyección en medio de la inicialización publica otro manager.
    const injected = {};
    await status.initializeStatusManager(injected);
    failFirst(new Error('late failure'));

    await expect(first).rejects.toThrow('late failure');
    expect(await status.getStatusManager()).toBe(injected);
  });

  it('rejects an unsupported credential status service', async () => {
    vi.stubEnv('CRED_STATUS_SERVICE', 'postgres');
    const status = await loadStatus().catch(error => error);

    expect(status).toBeInstanceOf(Error);
    expect(status.message).toBe('Encountered unsupported credential status service: postgres');
  });

  describe('closeStatusManager', () => {
    it('does nothing before the manager exists', async () => {
      const status = await loadStatus();

      await expect(status.closeStatusManager()).resolves.toBeUndefined();
    });

    it('closes the shared MongoDB client', async () => {
      vi.spyOn(console, 'info').mockImplementation(() => {});
      const closeSharedDatabaseClient = vi.fn().mockResolvedValue();
      const status = await loadStatus();
      await status.initializeStatusManager({ closeSharedDatabaseClient });

      await status.closeStatusManager();

      expect(closeSharedDatabaseClient).toHaveBeenCalledOnce();
      expect(console.info).toHaveBeenCalledWith('[STATUS_POOL] MongoDB shared client closed.');
    });

    it('skips managers without a shared client', async () => {
      const status = await loadStatus();
      await status.initializeStatusManager({});

      await expect(status.closeStatusManager()).resolves.toBeUndefined();
    });
  });
});
