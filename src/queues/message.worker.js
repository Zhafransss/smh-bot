const { Worker } = require('bullmq');
const { getRedisClient } = require('../config/redis');
const { handleMessage } = require('../handlers/message.handler');
const { sendMessage, sendPresence, markAsRead } = require('../services/whatsapp.service');
const {
  RATE_LIMIT_MAX,
  RATE_LIMIT_DURATION_MS,
  TYPING_DURATION_MS,
  MESSAGE_DEBOUNCE_DELAY_MS,
} = require('../config/constants');
const { BUFFER_KEY_PREFIX, LAST_RECEIVED_KEY_PREFIX, scheduleProcessing } = require('./message.queue');
const logger = require('../utils/logger');

let worker = null;

const PROCESSING_LOCK_PREFIX = 'msg_processing_lock:';
// Must exceed the longest processing path (typing delay up to TYPING_DURATION_MS + DB + send)
const PROCESSING_LOCK_TTL_MS = 60000;
const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start the BullMQ message worker for processing aggregated WhatsApp messages
 */
function startWorker() {
  worker = new Worker(
    'incoming-messages',
    async (job) => {
      const { phoneNumber, remoteJid, enqueuedAt, delayMs } = job.data;
      const redis = getRedisClient();

      // 0a. Debounce: a newer message arrived after this job was scheduled → its own job
      //     will handle the whole buffer, so this one steps aside.
      const lastReceivedAt = parseInt(await redis.get(`${LAST_RECEIVED_KEY_PREFIX}${phoneNumber}`), 10);
      if (enqueuedAt && lastReceivedAt && lastReceivedAt > enqueuedAt) {
        logger.debug({ jobId: job.id, phoneNumber }, 'Debounce job superseded by newer message');
        return { processed: false, reason: 'superseded' };
      }

      // 0b. One conversation at a time per phone number (worker concurrency is 5 across numbers).
      //     If another job for this number is still replying, retry later instead of dropping.
      const lockKey = `${PROCESSING_LOCK_PREFIX}${phoneNumber}`;
      const lockAcquired = await redis.set(lockKey, job.id, 'PX', PROCESSING_LOCK_TTL_MS, 'NX');
      if (!lockAcquired) {
        await scheduleProcessing(
          { phoneNumber, remoteJid, enqueuedAt, delayMs },
          delayMs || MESSAGE_DEBOUNCE_DELAY_MS
        );
        logger.debug({ jobId: job.id, phoneNumber }, 'Phone number busy, aggregation job rescheduled');
        return { processed: false, reason: 'rescheduled_locked' };
      }

      try {
        return await processAggregatedMessages(job, phoneNumber, remoteJid);
      } finally {
        // Release only our own lock (it may have expired and been taken by another job)
        await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, job.id);
      }
    },
    {
      connection: getRedisClient(),
      concurrency: 5,
      limiter: {
        max: RATE_LIMIT_MAX, // 10 messages
        duration: RATE_LIMIT_DURATION_MS, // per 60,000 ms (1 minute)
      },
    }
  );

  worker.on('completed', (job, result) => {
    logger.debug({ jobId: job.id, result }, 'Aggregated message job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err: err.message, attempts: job?.attemptsMade },
      'Aggregated message job failed'
    );
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Worker internal error');
  });

  logger.info(
    `👷 Message worker started (concurrency: 5, rate limit: ${RATE_LIMIT_MAX} msgs / ${RATE_LIMIT_DURATION_MS / 1000}s)`
  );
  return worker;
}

/**
 * Drain the buffer for a phone number, run the chatbot pipeline and send the reply.
 * Caller must hold the per-phone processing lock.
 */
async function processAggregatedMessages(job, phoneNumber, remoteJid) {
  const redis = getRedisClient();
  const bufferKey = `${BUFFER_KEY_PREFIX}${phoneNumber}`;

  // 1. Drain the buffer list for this phone number
  const rawItems = await redis.lrange(bufferKey, 0, -1);
  await redis.del(bufferKey);

  if (!rawItems || rawItems.length === 0) {
    logger.debug({ phoneNumber }, 'No pending messages in buffer for job');
    return { processed: false, reason: 'empty_buffer' };
  }

  const parsedItems = rawItems.map((r) => {
    try {
      return JSON.parse(r);
    } catch {
      return { messageText: r };
    }
  });

  // 2. Aggregate consecutive messages into a single text context (PRD Bagian 5 & 9)
  const aggregatedText = parsedItems.map((item) => item.messageText).join('\n');
  const lastItem = parsedItems[parsedItems.length - 1];
  const lastWaMessageId = lastItem.waMessageId;
  const lastMsgKey = lastItem.msgKey;
  const messageContext = {
    mediaPaths: parsedItems.map((item) => item.mediaPath).filter(Boolean),
    // Older buffered items (before LID handling) have no flag → treat as resolved
    phoneResolved: parsedItems.every((item) => item.phoneResolved !== false),
  };

  logger.info(
    {
      jobId: job.id,
      from: phoneNumber,
      messageCount: parsedItems.length,
      aggregatedText,
    },
    'Worker processing aggregated customer message'
  );

  // 3. Send typing presence animation ('composing' -> 'sedang mengetik...')
  if (remoteJid) {
    await sendPresence(remoteJid, 'composing');
  }

  // 4. Natural typing simulation delay
  const typingDuration =
    process.env.NODE_ENV === 'test'
      ? 50
      : Math.min(TYPING_DURATION_MS, Math.max(1500, aggregatedText.length * 35));

  logger.info({ from: phoneNumber, typingDurationMs: typingDuration }, 'Typing presence active...');
  await sleep(typingDuration);

  // 5. Run chatbot pipeline (state machine & keyword matcher)
  const reply = await handleMessage(phoneNumber, aggregatedText, lastWaMessageId, messageContext);

  // 6. Send reply via WhatsApp
  if (reply && remoteJid) {
    await sendMessage(remoteJid, reply);
  }

  // 7. Stop typing presence
  if (remoteJid) {
    await sendPresence(remoteJid, 'paused');
  }

  // 8. Mark last message as read (blue ticks)
  if (lastMsgKey) {
    await markAsRead(lastMsgKey);
  }

  return {
    processed: true,
    messageCount: parsedItems.length,
    replied: !!reply,
  };
}

/**
 * Stop worker gracefully
 */
async function stopWorker() {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Message worker stopped');
  }
}

module.exports = {
  startWorker,
  stopWorker,
};
