const { getRedisClient } = require('../config/redis');
const { CONVERSATION_TTL } = require('../config/constants');
const logger = require('../utils/logger');

const ADMIN_HANDLED_PREFIX = 'admin_handled:';
const CONV_STATE_PREFIX = 'conv_state:';

/**
 * Check if a phone number is currently in 'admin-handled' status
 * @param {string} phoneNumber
 * @returns {Promise<boolean>}
 */
async function isAdminHandled(phoneNumber) {
  try {
    const redis = getRedisClient();
    const exists = await redis.exists(`${ADMIN_HANDLED_PREFIX}${phoneNumber}`);
    return exists === 1;
  } catch (err) {
    logger.error({ err, phoneNumber }, 'Error checking admin-handled status in Redis');
    return false; // Fail-open: allow processing if Redis check fails temporarily
  }
}

/**
 * Set conversation status to 'admin-handled' with 24-hour TTL (PRD Bagian 5 & 7.4)
 * @param {string} phoneNumber
 * @param {object} metadata - Additional info (e.g. reason, lastMessage)
 * @param {number} [ttlSeconds] - Optional override, default 24h (86400s)
 */
async function setAdminHandled(phoneNumber, metadata = {}, ttlSeconds = CONVERSATION_TTL) {
  try {
    const redis = getRedisClient();
    const payload = JSON.stringify({
      status: 'admin-handled',
      phoneNumber,
      reason: metadata.reason || 'unspecified',
      lastMessage: metadata.lastMessage || null,
      escalatedAt: new Date().toISOString(),
    });

    await redis.setex(`${ADMIN_HANDLED_PREFIX}${phoneNumber}`, ttlSeconds, payload);
    logger.info(
      { phoneNumber, reason: metadata.reason, ttlSeconds },
      'Conversation set to admin-handled in Redis (24-hour auto-reset)'
    );
  } catch (err) {
    logger.error({ err, phoneNumber }, 'Failed to set admin-handled status in Redis');
  }
}

/**
 * Get details about admin-handled state for a phone number
 * @param {string} phoneNumber
 * @returns {Promise<object|null>}
 */
async function getAdminHandledInfo(phoneNumber) {
  try {
    const redis = getRedisClient();
    const [raw, ttl] = await Promise.all([
      redis.get(`${ADMIN_HANDLED_PREFIX}${phoneNumber}`),
      redis.ttl(`${ADMIN_HANDLED_PREFIX}${phoneNumber}`),
    ]);

    if (!raw) return null;

    const data = JSON.parse(raw);
    return {
      ...data,
      remainingTtlSeconds: ttl,
    };
  } catch (err) {
    logger.error({ err, phoneNumber }, 'Failed to get admin-handled info from Redis');
    return null;
  }
}

/**
 * Release / clear admin-handled status manually (unblock bot for this user)
 * @param {string} phoneNumber
 */
async function releaseAdminHandled(phoneNumber) {
  try {
    const redis = getRedisClient();
    await redis.del(`${ADMIN_HANDLED_PREFIX}${phoneNumber}`);
    logger.info({ phoneNumber }, 'Admin-handled status released manually in Redis');
  } catch (err) {
    logger.error({ err, phoneNumber }, 'Failed to release admin-handled status');
  }
}

// ── Generic conversation state methods (retained for backward compatibility) ──

async function getState(phoneNumber) {
  const redis = getRedisClient();
  const raw = await redis.get(`${CONV_STATE_PREFIX}${phoneNumber}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    await resetState(phoneNumber);
    return null;
  }
}

async function setState(phoneNumber, state, data = {}) {
  const redis = getRedisClient();
  const payload = JSON.stringify({
    state,
    data,
    updated_at: new Date().toISOString(),
  });
  await redis.setex(`${CONV_STATE_PREFIX}${phoneNumber}`, CONVERSATION_TTL, payload);
}

async function resetState(phoneNumber) {
  const redis = getRedisClient();
  await redis.del(`${CONV_STATE_PREFIX}${phoneNumber}`);
}

module.exports = {
  isAdminHandled,
  setAdminHandled,
  getAdminHandledInfo,
  releaseAdminHandled,
  getState,
  setState,
  resetState,
};
