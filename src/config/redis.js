const Redis = require('ioredis');
const logger = require('../utils/logger');

let redisClient = null;

/**
 * Get or create Redis connection
 */
function getRedisClient() {
  if (redisClient) return redisClient;

  redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    maxRetriesPerRequest: null, // Required by BullMQ
    retryStrategy(times) {
      const delay = Math.min(times * 500, 5000);
      logger.warn(`Redis reconnecting... attempt ${times}, delay ${delay}ms`);
      return delay;
    },
  });

  redisClient.on('connect', () => {
    logger.info('✅ Redis connected');
  });

  redisClient.on('error', (err) => {
    logger.error({ err }, '❌ Redis error');
  });

  return redisClient;
}

/**
 * Close Redis connection gracefully
 */
async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
}

module.exports = { getRedisClient, closeRedis };
