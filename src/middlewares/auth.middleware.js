const logger = require('../utils/logger');

/**
 * Middleware autentikasi menggunakan API Key
 * Mendukung autentikasi via header:
 * - 'x-api-key': '<API_KEY>'
 * - 'Authorization': 'Bearer <API_KEY>'
 */
function apiKeyAuth(req, res, next) {
  const configuredApiKey = process.env.API_KEY;

  if (!configuredApiKey) {
    logger.error('API_KEY belum dikonfigurasi pada environment variables (.env)');
    return res.status(500).json({
      success: false,
      message: 'Server security error: API_KEY is not configured',
    });
  }

  // Ambil API key dari header x-api-key atau Bearer authorization
  let providedKey = req.header('x-api-key');

  if (!providedKey) {
    const authHeader = req.header('authorization') || req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      providedKey = authHeader.substring(7).trim();
    }
  }

  if (!providedKey) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: API Key diperlukan. Gunakan header "x-api-key" atau "Authorization: Bearer <API_KEY>"',
    });
  }

  if (providedKey !== configuredApiKey) {
    logger.warn({ ip: req.ip, path: req.originalUrl }, 'Akses ditolak: API Key tidak valid');
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: API Key tidak valid',
    });
  }

  next();
}

module.exports = {
  apiKeyAuth,
};
