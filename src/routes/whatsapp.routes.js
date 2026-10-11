const express = require('express');
const router = express.Router();
const { getSessionInfo, logoutWhatsApp, connectWhatsApp } = require('../services/whatsapp.service');
const logger = require('../utils/logger');

// The QR code links a WhatsApp account to this bot — never let proxies or browsers cache it
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/**
 * GET /api/whatsapp/status
 * Pairing state. While status = "waiting_qr", `qr` is the raw string emitted by Baileys and
 * `qrImage` is that same string rendered as a PNG data URL.
 */
router.get('/status', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getSessionInfo() });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/whatsapp/logout
 * Unlink the bot from WhatsApp, wipe auth_state and begin a new pairing (fresh QR).
 */
router.post('/logout', async (req, res, next) => {
  try {
    logger.warn({ ip: req.ip }, 'WhatsApp logout requested via API');
    await logoutWhatsApp();
    res.json({ success: true, message: 'WhatsApp berhasil logout. Silakan scan QR code baru.' });
  } catch (err) {
    if (err.message === 'Proses logout sedang berjalan') {
      return res.status(409).json({ success: false, message: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/whatsapp/connect
 * Retry the connection after automatic retries stopped (status "blocked").
 */
router.post('/connect', async (req, res, next) => {
  try {
    const started = await connectWhatsApp();
    res.json({
      success: true,
      message: started ? 'Mencoba menyambungkan WhatsApp...' : 'WhatsApp sudah terhubung atau sedang menyambung.',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
