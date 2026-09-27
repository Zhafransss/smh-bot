const { HistoryChat } = require('../models');
const { CHAT_DIRECTION } = require('../config/constants');
const logger = require('../utils/logger');

/**
 * Save incoming message from pelanggan
 */
async function saveIncoming(userId, ticketId, isiPesan, waMessageId) {
  try {
    return await HistoryChat.create({
      user_id: userId,
      ticket_id: ticketId || null,
      wa_message_id: waMessageId || null,
      isi_pesan: isiPesan,
      arah: CHAT_DIRECTION.MASUK,
    });
  } catch (err) {
    // Duplicate wa_message_id — already processed
    if (err.name === 'SequelizeUniqueConstraintError') {
      logger.warn({ waMessageId }, 'Duplicate message ignored');
      return null;
    }
    throw err;
  }
}

/**
 * Save outgoing message (bot reply)
 */
async function saveOutgoing(userId, ticketId, isiPesan) {
  return HistoryChat.create({
    user_id: userId,
    ticket_id: ticketId || null,
    wa_message_id: null, // Outgoing messages don't have WA message ID from Baileys
    isi_pesan: isiPesan,
    arah: CHAT_DIRECTION.KELUAR,
  });
}

/**
 * Check if message was already processed (deduplication)
 */
async function isDuplicate(waMessageId) {
  if (!waMessageId) return false;
  const existing = await HistoryChat.findOne({
    where: { wa_message_id: waMessageId },
  });
  return !!existing;
}

module.exports = {
  saveIncoming,
  saveOutgoing,
  isDuplicate,
};
