import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createShutdown,
  registerShutdownSignals,
  resolveShutdownTimeout
} from './shutdown.js';

function fakeLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

function fakeServer(closeError) {
  return { close: vi.fn(callback => callback(closeError)) };
}

describe('shutdown', () => {
  let previousExitCode;

  beforeEach(() => {
    previousExitCode = process.exitCode;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    vi.useRealTimers();
  });

  describe('resolveShutdownTimeout', () => {
    it('uses a positive configured value', () => {
      expect(resolveShutdownTimeout('5000')).toBe(5000);
    });

    it.each([undefined, '', 'abc', '0', '-10'])('falls back to 25000 for %s', value => {
      expect(resolveShutdownTimeout(value)).toBe(25000);
    });
  });

  describe('createShutdown', () => {
    it('closes the server and then the MongoDB pool', async () => {
      const calls = [];
      const server = { close: vi.fn(callback => { calls.push('server'); callback(); }) };
      const closeStatusManager = vi.fn(async () => { calls.push('mongo'); });
      const logger = fakeLogger();

      await createShutdown({ server, closeStatusManager, logger, timeoutMs: 1000 })('SIGTERM');

      expect(calls).toEqual(['server', 'mongo']);
      expect(process.exitCode).toBe(0);
      expect(logger.info).toHaveBeenCalledWith('[SHUTDOWN] Received SIGTERM. Starting graceful shutdown.');
      expect(logger.info).toHaveBeenCalledWith('[SHUTDOWN] Graceful shutdown completed.');
    });

    it('runs only once even if several signals arrive', async () => {
      const server = fakeServer();
      const shutdown = createShutdown({
        server,
        closeStatusManager: vi.fn(),
        logger: fakeLogger(),
        timeoutMs: 1000
      });

      await shutdown('SIGTERM');
      await shutdown('SIGINT');

      expect(server.close).toHaveBeenCalledTimes(1);
    });

    it('sets a failing exit code when the server cannot close', async () => {
      const logger = fakeLogger();
      const closeStatusManager = vi.fn();

      await createShutdown({
        server: fakeServer(new Error('not running')),
        closeStatusManager,
        logger,
        timeoutMs: 1000
      })('SIGTERM');

      expect(process.exitCode).toBe(1);
      expect(logger.error).toHaveBeenCalledWith('[SHUTDOWN] Error: not running');
      expect(closeStatusManager).not.toHaveBeenCalled();
    });

    it('sets a failing exit code when the pool cannot close', async () => {
      const logger = fakeLogger();

      await createShutdown({
        server: fakeServer(),
        closeStatusManager: vi.fn().mockRejectedValue(new Error('pool busy')),
        logger,
        timeoutMs: 1000
      })('SIGTERM');

      expect(process.exitCode).toBe(1);
      expect(logger.error).toHaveBeenCalledWith('[SHUTDOWN] Error: pool busy');
    });

    it('forces the exit when shutdown takes longer than the timeout', async () => {
      vi.useFakeTimers();
      const exit = vi.fn();
      const logger = fakeLogger();
      const server = { close: vi.fn() };

      void createShutdown({
        server,
        closeStatusManager: vi.fn(),
        logger,
        timeoutMs: 500,
        exit
      })('SIGTERM');

      await vi.advanceTimersByTimeAsync(500);

      expect(exit).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith('[SHUTDOWN] Timeout after 500ms. Forcing exit.');
    });

    it('exits the process by default when the timeout expires', async () => {
      vi.useFakeTimers();
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {});

      try {
        void createShutdown({
          server: { close: vi.fn() },
          closeStatusManager: vi.fn(),
          logger: fakeLogger(),
          timeoutMs: 10
        })('SIGTERM');

        await vi.advanceTimersByTimeAsync(10);

        expect(exit).toHaveBeenCalledWith(1);
      } finally {
        exit.mockRestore();
      }
    });
  });

  describe('registerShutdownSignals', () => {
    it.each(['SIGTERM', 'SIGINT'])('runs the shutdown once on %s', signal => {
      const target = new EventEmitter();
      const shutdown = vi.fn();

      registerShutdownSignals(shutdown, target);
      target.emit(signal);
      target.emit(signal);

      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(shutdown).toHaveBeenCalledWith(signal);
    });
  });
});
