require('dotenv').config();

const app = require('./app');
const logger = require('./utils/logger');
const { testConnection, sequelize } = require('./models');
const { getRedisClient, closeRedis } = require('./config/redis');
const { startWhatsApp, closeWhatsApp } = require('./services/whatsapp.service');
const { startWorker, stopWorker } = require('./queues/message.worker');
const { closeQueue } = require('./queues/message.queue');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    logger.info('🚀 Starting Selis Molis Hoki (SMH) WhatsApp Support System...');

    // 1. Connect Database
    await testConnection();
    if (process.env.NODE_ENV !== 'production' || process.env.DB_SYNC === 'true') {
      await sequelize.sync();
      logger.info('✅ Database models synchronized');
    } else {
      logger.info('ℹ️ Skipping sequelize.sync() in production (use migrations)');
    }

    // 2. Connect Redis
    const redis = getRedisClient();
    await redis.ping();
    logger.info('✅ Redis connected');

    // 3. Start BullMQ Worker
    startWorker();

    // 4. Start WhatsApp (Baileys)
    await startWhatsApp();

    // 5. Start HTTP Server
    app.listen(PORT, () => {
      logger.info(`✅ HTTP server listening on port ${PORT}`);
      logger.info('──────────────────────────────────────');
      logger.info('  SMH Support System is ready!');
      logger.info(`  API: http://localhost:${PORT}`);
      logger.info(`  Health: http://localhost:${PORT}/api/health`);
      logger.info('──────────────────────────────────────');
    });
  } catch (err) {
    logger.error({ err }, '❌ Failed to start application');
    process.exit(1);
  }
}

// ── Graceful Shutdown ──

async function shutdown(signal) {
  logger.info(`\n${signal} received. Shutting down gracefully...`);

  try {
    // Stop accepting new messages
    await closeWhatsApp();

    // Wait for current jobs to finish
    await stopWorker();
    await closeQueue();

    // Close connections
    await closeRedis();
    await sequelize.close();

    logger.info('✅ All connections closed. Goodbye!');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle unhandled errors
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled Promise Rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught Exception');
  shutdown('UNCAUGHT_EXCEPTION');
});

// Start the application
start();
