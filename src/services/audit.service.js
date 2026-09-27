const { BotChatLog, ItemService } = require('../models');
const logger = require('../utils/logger');

/**
 * Log a chat interaction to the MySQL database (bot_chat_logs)
 * @param {object} params
 * @param {string} params.phoneNumber
 * @param {string} params.incomingMessage
 * @param {string} [params.matchedLayer]
 * @param {number|null} [params.matchedItemId]
 * @param {number} [params.rawScore]
 * @param {number} [params.thresholdUsed]
 * @param {string|null} [params.replyMessage]
 * @param {boolean} [params.isEscalated]
 * @param {string|null} [params.escalationReason]
 * @returns {Promise<BotChatLog>}
 */
async function logChatInteraction({
  phoneNumber,
  incomingMessage,
  matchedLayer = null,
  matchedItemId = null,
  rawScore = 0,
  thresholdUsed = 2,
  replyMessage = null,
  isEscalated = false,
  escalationReason = null,
}) {
  try {
    const log = await BotChatLog.create({
      phone_number: phoneNumber,
      incoming_message: incomingMessage,
      matched_layer: matchedLayer,
      matched_item_id: matchedItemId,
      raw_score: rawScore,
      threshold_used: thresholdUsed,
      reply_message: replyMessage,
      is_escalated: isEscalated,
      escalation_reason: escalationReason,
    });

    logger.debug(
      {
        logId: log.id,
        phoneNumber,
        matchedLayer,
        isEscalated,
        escalationReason,
      },
      'Chat interaction logged to database'
    );

    return log;
  } catch (err) {
    logger.error({ err, phoneNumber }, 'Failed to write chat log to database');
    return null;
  }
}

/**
 * Get recent chat logs for admin inspection & threshold tuning
 * @param {number} [limit=50]
 * @param {number} [offset=0]
 * @param {object} [where={}]
 */
async function getRecentLogs(limit = 50, offset = 0, where = {}) {
  return BotChatLog.findAll({
    where,
    limit,
    offset,
    order: [['created_at', 'DESC']],
    include: [
      {
        model: ItemService,
        as: 'matchedItem',
        attributes: ['id', 'name', 'price', 'category'],
      },
    ],
  });
}

/**
 * Get statistical summary of escalations for threshold evaluation
 */
async function getEscalationStats() {
  const { sequelize } = require('../models');

  const [reasonBreakdown] = await sequelize.query(`
    SELECT 
      is_escalated,
      escalation_reason,
      matched_layer,
      COUNT(*) as count
    FROM bot_chat_logs
    GROUP BY is_escalated, escalation_reason, matched_layer
    ORDER BY count DESC
  `);

  return {
    breakdown: reasonBreakdown,
  };
}

module.exports = {
  logChatInteraction,
  getRecentLogs,
  getEscalationStats,
};
