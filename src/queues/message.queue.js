const { Queue } = require('bullmq');
const { getRedisClient } = require('../config/redis');
const { MESSAGE_DEBOUNCE_DELAY_MS } = require('../config/constants');
const logger = require('../utils/logger');

let messageQueue = null;
const BUFFER_KEY_PREFIX = 'msg_buffer:';
const LAST_RECEIVED_KEY_PREFIX = 'msg_last_received:';
const LAST_JOB_KEY_PREFIX = 'msg_last_job:';
const BUFFER_TTL_SECONDS = 300; // 5 minutes safety expiry

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
 * @param {{ phoneNumber: string, phoneResolved?: boolean, messageText: string, waMessageId: string, remoteJid: string, msgKey: object, mediaPath?: string|null }} data
 * @param {number} [customDelay] - Optional delay override in milliseconds
 */
async function enqueueMessage(data, customDelay) {
  const redis = getRedisClient();
  const queue = getQueue();
  const { phoneNumber, phoneResolved = true, messageText, waMessageId, remoteJid, msgKey, mediaPath = null } = data;

  const delayMs = customDelay !== undefined ? customDelay : MESSAGE_DEBOUNCE_DELAY_MS;
  const bufferKey = `${BUFFER_KEY_PREFIX}${phoneNumber}`;
  const lastJobKey = `${LAST_JOB_KEY_PREFIX}${phoneNumber}`;
  const receivedAt = Date.now();

  const itemPayload = JSON.stringify({
    waMessageId,
    messageText,
    remoteJid,
    msgKey,
    mediaPath,
    phoneResolved,
    receivedAt,
  });

  // 1. Append message into Redis list buffer & remember the newest arrival time
  await redis.rpush(bufferKey, itemPayload);
  await redis.expire(bufferKey, BUFFER_TTL_SECONDS);
  await redis.set(`${LAST_RECEIVED_KEY_PREFIX}${phoneNumber}`, receivedAt, 'EX', BUFFER_TTL_SECONDS);

  // 2. Best-effort: drop the previous still-delayed job so superseded jobs don't burn
  //    rate-limiter tokens. Correctness does NOT depend on this — the worker skips
  //    superseded jobs and serializes per phone number with a lock.
  const previousJobId = await redis.get(lastJobKey);
  if (previousJobId) {
    const previousJob = await queue.getJob(previousJobId);
    if (previousJob && (await previousJob.getState()) === 'delayed') {
      try {
        await previousJob.remove();
        logger.debug({ phoneNumber }, 'Refreshed debounce timer for consecutive message');
      } catch (err) {
        logger.debug({ err, phoneNumber }, 'Notice removing existing delayed job');
      }
    }
  }

  // 3. Always schedule a NEW job (unique id). A fixed jobId was silently ignored by BullMQ
  //    while the previous job was still active, leaving the new message stuck in the buffer.
  const job = await scheduleProcessing({ phoneNumber, remoteJid, enqueuedAt: receivedAt, delayMs }, delayMs);
  await redis.set(lastJobKey, job.id, 'EX', BUFFER_TTL_SECONDS);

  logger.debug(
    { jobId: job.id, phoneNumber, delayMs },
    'Added message to buffer and scheduled BullMQ debounce job'
  );

  return job;
}

/**
 * Schedule a delayed aggregation job for a phone number
 * @param {{ phoneNumber: string, remoteJid: string, enqueuedAt: number, delayMs: number }} data
 * @param {number} delayMs
 */
async function scheduleProcessing(data, delayMs) {
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return getQueue().add('process-aggregated-messages', data, {
    jobId: `debounce_${data.phoneNumber}_${uniqueSuffix}`,
    delay: delayMs,
    removeOnComplete: true,
    removeOnFail: true,
  });
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
  scheduleProcessing,
  addToQueue,
  closeQueue,
  BUFFER_KEY_PREFIX,
  LAST_RECEIVED_KEY_PREFIX,
};
