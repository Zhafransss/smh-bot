const { Queue } = require('bullmq');
const { getRedisClient } = require('../config/redis');
const { MESSAGE_DEBOUNCE_DELAY_MS } = require('../config/constants');
const logger = require('../utils/logger');

let messageQueue = null;
const BUFFER_KEY_PREFIX = 'msg_buffer:';

/**
 * Get or create the BullMQ message queue
 */
function getQueue() {
  if (messageQueue) return messageQueue;

  messageQueue = new Queue('incoming-messages', {
    connection: getRedisClient(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        age: 86400, // 24 hours
        count: 1000,
      },
      removeOnFail: {
        age: 604800, // 7 days
      },
    },
  });

  logger.info('📬 Message queue initialized');
  return messageQueue;
}

/**
 * Enqueue message with debounce mechanism to aggregate consecutive messages (PRD Bagian 5 & 9)
 * @param {{ phoneNumber: string, messageText: string, waMessageId: string, remoteJid: string, msgKey: object }} data
 * @param {number} [customDelay] - Optional delay override in milliseconds
 */
async function enqueueMessage(data, customDelay) {
  const redis = getRedisClient();
  const queue = getQueue();
  const { phoneNumber, messageText, waMessageId, remoteJid, msgKey } = data;

  const delayMs = customDelay !== undefined ? customDelay : MESSAGE_DEBOUNCE_DELAY_MS;
  const bufferKey = `${BUFFER_KEY_PREFIX}${phoneNumber}`;

  const itemPayload = JSON.stringify({
    waMessageId,
    messageText,
    remoteJid,
    msgKey,
    receivedAt: Date.now(),
  });

  // 1. Append message into Redis list buffer
  await redis.rpush(bufferKey, itemPayload);
  await redis.expire(bufferKey, 300); // 5 minutes safety expiry

  // 2. Schedule or refresh delayed job in BullMQ
  const jobId = `debounce_${phoneNumber}`;
  const existingJob = await queue.getJob(jobId);

  if (existingJob) {
    const state = await existingJob.getState();
    if (state === 'delayed') {
      try {
        await existingJob.remove();
        logger.debug({ phoneNumber }, 'Refreshed debounce timer for consecutive message');
      } catch (err) {
        logger.debug({ err, phoneNumber }, 'Notice removing existing delayed job');
      }
    }
  }

  const job = await queue.add(
    'process-aggregated-messages',
    { phoneNumber, remoteJid },
    {
      jobId,
      delay: delayMs,
      removeOnComplete: true,
      removeOnFail: true,
    }
  );

  logger.debug(
    { jobId: job.id, phoneNumber, delayMs },
    'Added message to buffer and scheduled BullMQ debounce job'
  );

  return job;
}

/**
 * Alias for backward compatibility
 */
async function addToQueue(data) {
  return enqueueMessage(data);
}

/**
 * Close queue gracefully
 */
async function closeQueue() {
  if (messageQueue) {
    await messageQueue.close();
    messageQueue = null;
    logger.info('Message queue closed');
  }
}

module.exports = {
  getQueue,
  enqueueMessage,
  addToQueue,
  closeQueue,
  BUFFER_KEY_PREFIX,
};
