const express = require('express');
const router = express.Router();
const { getConnectionStatus } = require('../services/whatsapp.service');
const { getRedisClient } = require('../config/redis');
const { sequelize } = require('../models');

/**
 * GET /api/health
 * System health check — DB, Redis, WhatsApp status
 */
router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {},
  };

  // Check Database
  try {
    await sequelize.authenticate();
    health.services.database = { status: 'connected' };
  } catch (err) {
    health.services.database = { status: 'disconnected', error: err.message };
    health.status = 'degraded';
  }

  // Check Redis
  try {
    const redis = getRedisClient();
    await redis.ping();
    health.services.redis = { status: 'connected' };
  } catch (err) {
    health.services.redis = { status: 'disconnected', error: err.message };
    health.status = 'degraded';
  }

  // Check WhatsApp
  const waStatus = getConnectionStatus();
  health.services.whatsapp = { status: waStatus };
  if (waStatus !== 'connected') {
    health.status = 'degraded';
  }

  const httpStatus = health.status === 'ok' ? 200 : 503;
  res.status(httpStatus).json(health);
});

module.exports = router;
