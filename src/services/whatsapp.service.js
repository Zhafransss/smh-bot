const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const path = require('path');
const logger = require('../utils/logger');
const alertService = require('./alert.service');
const { normalizePhone } = require('../utils/formatter');
const { addToQueue } = require('../queues/message.queue');

let sock = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAYS = [2000, 5000, 10000, 30000, 60000]; // Exponential backoff

/**
 * Initialize WhatsApp connection using Baileys
 */
async function startWhatsApp() {
  const sessionPath = process.env.WA_SESSION_PATH || './auth_state';
  const absolutePath = path.resolve(sessionPath);

  const { state, saveCreds } = await useMultiFileAuthState(absolutePath);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false, // We handle QR ourselves
    logger: require('pino')({ level: 'silent' }), // Suppress Baileys internal logs
    browser: ['SMH Support Bot', 'Chrome', '1.0.0'],
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 30000,
    markOnlineOnConnect: false,
  });

  // ── Connection Events ──

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // QR Code display
    if (qr) {
      logger.info('📱 Scan QR Code berikut dengan WhatsApp Anda:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const boom = lastDisconnect?.error;
      const statusCode = boom instanceof Boom ? boom.output?.statusCode : null;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn({ statusCode, shouldReconnect }, 'WhatsApp connection closed');

      if (shouldReconnect) {
        reconnectAttempts++;

        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          logger.error('Max reconnection attempts reached. Sending alert...');
          await alertService.sendConnectionAlert(
            `Koneksi WhatsApp gagal setelah ${MAX_RECONNECT_ATTEMPTS} percobaan reconnect. Status code: ${statusCode}`
          );
          return;
        }

        const delay = RECONNECT_DELAYS[Math.min(reconnectAttempts - 1, RECONNECT_DELAYS.length - 1)];
        logger.info(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

        setTimeout(() => startWhatsApp(), delay);
      } else {
        // Logged out — need QR rescan
        logger.error('WhatsApp logged out. QR rescan needed.');
        await alertService.sendQRScanAlert();
      }
    }

    if (connection === 'open') {
      reconnectAttempts = 0; // Reset on successful connection
      logger.info('✅ WhatsApp connected successfully!');
    }
  });

  // Save credentials on update
  sock.ev.on('creds.update', saveCreds);

  // ── Message Events ──

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return; // Only process new messages

    for (const msg of messages) {
      try {
        // Skip non-personal messages
        if (!msg.message) continue;
        if (msg.key.fromMe) continue; // Skip own messages
        if (msg.key.remoteJid.endsWith('@g.us')) continue; // Skip group messages
        if (msg.key.remoteJid === 'status@broadcast') continue; // Skip status updates

        // Extract text content
        const text = extractTextFromMessage(msg);
        if (!text) continue; // Skip non-text messages (media, etc.)

        const phoneNumber = normalizePhone(msg.key.remoteJid);
        const waMessageId = msg.key.id;

        logger.info({ from: phoneNumber, messageId: waMessageId }, 'Incoming message');

        // Add to BullMQ queue for background processing
        await addToQueue({
          phoneNumber,
          messageText: text,
          waMessageId,
          remoteJid: msg.key.remoteJid,
          msgKey: msg.key,
        });
      } catch (err) {
        logger.error({ err, msgKey: msg.key }, 'Error processing incoming message event');
      }
    }
  });

  return sock;
}

/**
 * Extract text content from various message types
 */
function extractTextFromMessage(msg) {
  const m = msg.message;
  if (!m) return null;

  // WhatsApp Location Pin (Share Lokasi)
  if (m.locationMessage) {
    const { degreesLatitude, degreesLongitude, name, address } = m.locationMessage;
    const label = name || address || '';
    return `[LOCATION: lat=${degreesLatitude}, lng=${degreesLongitude}${label ? `, label=${label}` : ''}]`;
  }
  if (m.liveLocationMessage) {
    const { degreesLatitude, degreesLongitude } = m.liveLocationMessage;
    return `[LOCATION: lat=${degreesLatitude}, lng=${degreesLongitude}]`;
  }

  // Image with or without caption
  if (m.imageMessage) {
    return m.imageMessage.caption ? m.imageMessage.caption : '[FOTO_UNIT]';
  }

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.videoMessage?.caption ||
    null
  );
}

/**
 * Send presence update (e.g. 'composing' for typing animation, 'paused' to stop)
 * @param {string} jid - Recipient JID
 * @param {'composing'|'recording'|'paused'|'available'|'unavailable'} presence
 */
async function sendPresence(jid, presence = 'composing') {
  if (!sock) return;
  try {
    await sock.sendPresenceUpdate(presence, jid);
    logger.debug({ to: jid, presence }, 'Presence updated');
  } catch (err) {
    logger.warn({ err, to: jid }, 'Failed to send presence update');
  }
}

/**
 * Mark messages as read (ceklis 2 biru)
 * @param {object|object[]} keys - Baileys message key or array of keys
 */
async function markAsRead(keys) {
  if (!sock) return;
  try {
    const keyList = Array.isArray(keys) ? keys : [keys];
    await sock.readMessages(keyList);
    logger.debug({ keys: keyList }, 'Message marked as read (ceklis 2 biru)');
  } catch (err) {
    logger.warn({ err }, 'Failed to mark message as read');
  }
}

/**
 * Send a text message via WhatsApp
 * @param {string} jid - Recipient JID (e.g. "6281234567890@s.whatsapp.net")
 * @param {string} text - Message text
 */
async function sendMessage(jid, text) {
  if (!sock) {
    logger.error('Cannot send message: WhatsApp not connected');
    return null;
  }

  try {
    const result = await sock.sendMessage(jid, { text });
    logger.debug({ to: jid }, 'Message sent');
    return result;
  } catch (err) {
    logger.error({ err, to: jid }, 'Failed to send message');
    throw err;
  }
}

/**
 * Get current connection status
 */
function getConnectionStatus() {
  if (!sock) return 'disconnected';
  return 'connected';
}

/**
 * Close WhatsApp connection gracefully
 */
async function closeWhatsApp() {
  if (sock) {
    sock.end();
    sock = null;
    logger.info('WhatsApp connection closed');
  }
}

module.exports = {
  startWhatsApp,
  sendMessage,
  sendPresence,
  markAsRead,
  getConnectionStatus,
  closeWhatsApp,
};
