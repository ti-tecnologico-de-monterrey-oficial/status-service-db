const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25000;

export function resolveShutdownTimeout(value) {
  const configuredTimeout = Number(value);

  return Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_SHUTDOWN_TIMEOUT_MS;
}

/**
 * Cierre ordenado: deja de aceptar conexiones HTTP, espera las solicitudes en
 * curso y después cierra el pool de MongoDB. Si no termina dentro del plazo,
 * fuerza la salida para que Container Apps no espere indefinidamente.
 */
export function createShutdown({
  server,
  closeStatusManager,
  logger,
  timeoutMs,
  exit = code => process.exit(code)
}) {
  let shuttingDown = false;

  return async function shutdown(signal) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    logger.info(
      `[SHUTDOWN] Received ${signal}. Starting graceful shutdown.`
    );

    const shutdownTimer = setTimeout(() => {
      logger.error(
        `[SHUTDOWN] Timeout after ${timeoutMs}ms. Forcing exit.`
      );

      exit(1);
    }, timeoutMs);

    shutdownTimer.unref();

    try {
      await new Promise((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      logger.info('[SHUTDOWN] HTTP server closed.');

      await closeStatusManager();

      logger.info('[SHUTDOWN] MongoDB pool closed.');
      logger.info('[SHUTDOWN] Graceful shutdown completed.');

      process.exitCode = 0;
    } catch (error) {
      logger.error(`[SHUTDOWN] Error: ${error.message}`);

      process.exitCode = 1;
    } finally {
      clearTimeout(shutdownTimer);
    }
  };
}

/**
 * Azure Container Apps detiene el contenedor con SIGTERM; SIGINT cubre Ctrl+C
 * en desarrollo.
 */
export function registerShutdownSignals(shutdown, target = process) {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    target.once(signal, () => {
      void shutdown(signal);
    });
  }
}
