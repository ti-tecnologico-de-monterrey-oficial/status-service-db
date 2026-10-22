import logger from '../utils/logger.js';
import sanitizeForLog from '../utils/sanitizeForLog.js';

// Fallback middleware for undefined paths
const invalidPathHandler = (req, res) => {
  res.status(404).send({code: 404, message: `Route Not Found in status-service-db: ${req.originalUrl}`});
  logger.error(sanitizeForLog(`404 || ${res.statusMessage} - ${req.originalUrl} - ${req.method} - ${req.ip}`));
};

export default invalidPathHandler;
