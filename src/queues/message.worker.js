const { Worker } = require('bullmq');
const { getRedisClient } = require('../config/redis');
const { handleMessage } = require('../handlers/message.handler');
const { sendMessage, sendPresence, markAsRead } = require('../services/whatsapp.service');
const {
  RATE_LIMIT_MAX,
  RATE_LIMIT_DURATION_MS,
  TYPING_DURATION_MS,
} = require('../config/constants');
const { BUFFER_KEY_PREFIX } = require('./message.queue');
const logger = require('../utils/logger');

let worker = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start the BullMQ message worker for processing aggregated WhatsApp messages
 */
function startWorker() {
  worker = new Worker(
    'incoming-messages',
    async (job) => {
      const { phoneNumber, remoteJid } = job.data;
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
      const reply = await handleMessage(phoneNumber, aggregatedText, lastWaMessageId);

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
