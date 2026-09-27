const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const path = require('path');
const logger = require('../utils/logger');
const alertService = require('./alert.service');
const { normalizePhone } = require('../utils/formatter');
const { addToQueue } = require('../queues/message.queue');
const mediaService = require('./media.service');

const PHOTO_MARKER = '[FOTO_UNIT]';
const PHOTO_FAILED_MARKER = '[FOTO_GAGAL]';

let sock = null;
let connectionState = 'disconnected'; // 'connecting' | 'open' | 'disconnected'
let reconnectAttempts = 0;
let reconnectTimer = null;
let isShuttingDown = false;
let outageAlertSent = false;

// The bot must run 24/7: it NEVER gives up reconnecting. After this many consecutive
// failures the IT team is alerted once per outage, while retries continue in the background.
const ALERT_AFTER_ATTEMPTS = 5;
const RECONNECT_DELAYS = [2000, 5000, 10000, 30000, 60000]; // Backoff; the last value repeats indefinitely

// Disconnects that retrying cannot fix — reconnecting would loop forever or fight another session
const TERMINAL_DISCONNECTS = {
  [DisconnectReason.loggedOut]: 'Sesi WhatsApp logout. Perlu scan QR code ulang.',
  [DisconnectReason.forbidden]: 'Nomor WhatsApp bot ditolak/diblokir oleh WhatsApp (403).',
  [DisconnectReason.connectionReplaced]:
    'Sesi WhatsApp diambil alih oleh koneksi lain (kemungkinan bot berjalan ganda atau WhatsApp Web dibuka di tempat lain).',
};

/**
 * Schedule a reconnect with backoff. Retries forever until connected or shutting down.
 * @param {string} reason
 */
function scheduleReconnect(reason) {
  if (isShuttingDown || reconnectTimer) return;

  reconnectAttempts++;
  const delay = RECONNECT_DELAYS[Math.min(reconnectAttempts - 1, RECONNECT_DELAYS.length - 1)];
  logger.info({ attempt: reconnectAttempts, delayMs: delay, reason }, 'Reconnecting WhatsApp...');

  if (reconnectAttempts >= ALERT_AFTER_ATTEMPTS && !outageAlertSent) {
    outageAlertSent = true;
    alertService.sendConnectionAlert(
      `Koneksi WhatsApp gagal ${reconnectAttempts}x berturut-turut (terakhir: ${reason}). ` +
        `Bot tetap mencoba reconnect otomatis setiap ${RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1] / 1000} detik.`
    );
  }

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await startWhatsApp();
    } catch (err) {
      // e.g. network down while fetching Baileys version / opening socket — keep retrying
      logger.error({ err }, 'Failed to restart WhatsApp socket');
      scheduleReconnect('start_failed');
    }
  }, delay);
}

/**
 * Initialize WhatsApp connection using Baileys
 */
async function startWhatsApp() {
  const sessionPath = process.env.WA_SESSION_PATH || './auth_state';
  const absolutePath = path.resolve(sessionPath);

  const { state, saveCreds } = await useMultiFileAuthState(absolutePath);
  const { version } = await fetchLatestBaileysVersion();

  connectionState = 'connecting';
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

    if (connection === 'connecting') {
      connectionState = 'connecting';
    }

    if (connection === 'close') {
      connectionState = 'disconnected';
      if (isShuttingDown) return; // Closed by closeWhatsApp() — do not reconnect

      const boom = lastDisconnect?.error;
      const statusCode = boom instanceof Boom ? boom.output?.statusCode : null;
      const terminalReason = TERMINAL_DISCONNECTS[statusCode];

      logger.warn({ statusCode, willReconnect: !terminalReason }, 'WhatsApp connection closed');

      if (terminalReason) {
        logger.error({ statusCode }, `${terminalReason} Manual action required.`);
        await alertService.sendConnectionAlert(`${terminalReason} (status code: ${statusCode})`);
        return;
      }

      scheduleReconnect(`status_${statusCode}`);
    }

    if (connection === 'open') {
      connectionState = 'open';
      if (reconnectAttempts > 0) {
        logger.info({ attempts: reconnectAttempts }, 'WhatsApp connection recovered');
      }
      reconnectAttempts = 0;
      outageAlertSent = false;
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

        const { phoneNumber, phoneResolved } = await resolveSenderPhone(msg.key);
        const waMessageId = msg.key.id;

        // Unit photo: download now (media URLs expire) so it can be uploaded to the website later
        let mediaPath = null;
        if (msg.message.imageMessage) {
          mediaPath = await downloadImage(msg, phoneNumber);
        }

        // Extract text content
        const text = extractTextFromMessage(msg, { photoSaved: !!mediaPath });
        if (!text) continue; // Skip non-text messages (media, etc.)

        logger.info({ from: phoneNumber, phoneResolved, messageId: waMessageId, hasMedia: !!mediaPath }, 'Incoming message');

        // Add to BullMQ queue for background processing
        await addToQueue({
          phoneNumber,
          phoneResolved,
          messageText: text,
          waMessageId,
          remoteJid: msg.key.remoteJid, // replies always go to the original JID (LID or PN)
          msgKey: msg.key,
          mediaPath,
        });
      } catch (err) {
        logger.error({ err, msgKey: msg.key }, 'Error processing incoming message event');
      }
    }
  });

  return sock;
}

/**
 * Resolve the sender's real phone number.
 * Baileys v7 addresses many chats by LID ("94450709712963@lid"), which is an internal WhatsApp id,
 * NOT a phone number. The real number comes from `key.remoteJidAlt` or the LID→PN mapping store.
 * @param {object} key - Baileys message key
 * @returns {Promise<{ phoneNumber: string, phoneResolved: boolean }>}
 *   phoneResolved=false → phoneNumber is only the LID digits (usable as an id, not as a contact number)
 */
async function resolveSenderPhone(key) {
  const jid = key.remoteJid || '';
  if (!jid.endsWith('@lid')) {
    return { phoneNumber: normalizePhone(jid), phoneResolved: true };
  }

  if (key.remoteJidAlt && key.remoteJidAlt.endsWith('@s.whatsapp.net')) {
    return { phoneNumber: normalizePhone(key.remoteJidAlt), phoneResolved: true };
  }

  try {
    const pnJid = await sock?.signalRepository?.lidMapping?.getPNForLID(jid);
    if (pnJid) return { phoneNumber: normalizePhone(pnJid), phoneResolved: true };
  } catch (err) {
    logger.warn({ err, jid }, 'LID → phone number lookup failed');
  }

  logger.warn({ jid }, 'Phone number for LID sender could not be resolved');
  return { phoneNumber: normalizePhone(jid), phoneResolved: false };
}

/**
 * Download an incoming image and store it temporarily.
 * @returns {Promise<string|null>} absolute file path, or null if the download failed
 */
async function downloadImage(msg, phoneNumber) {
  try {
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: require('pino')({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
    );
    return await mediaService.saveImage(buffer, {
      phoneNumber,
      messageId: msg.key.id,
      mimetype: msg.message.imageMessage.mimetype,
    });
  } catch (err) {
    logger.error({ err, messageId: msg.key.id }, 'Failed to download image from WhatsApp');
    return null;
  }
}

/**
 * Extract text content from various message types
 * @param {object} msg
 * @param {{ photoSaved?: boolean }} [options] - photo marker is only added when the image file was saved,
 *   so the bot never believes it has a photo it cannot upload
 */
function extractTextFromMessage(msg, { photoSaved = false } = {}) {
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

  // Image with or without caption — always keep the marker so a form sent as a photo caption
  // is recognized as having its photo attached
  if (m.imageMessage) {
    const caption = m.imageMessage.caption || '';
    // Download failed → bot asks for the photo again (never silently drop the customer's message)
    if (!photoSaved) return caption ? `${caption}\n${PHOTO_FAILED_MARKER}` : PHOTO_FAILED_MARKER;
    return caption ? `${caption}\n${PHOTO_MARKER}` : PHOTO_MARKER;
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
  // Report the real socket state; a non-null socket can still be closed/reconnecting
  return connectionState === 'open' ? 'connected' : connectionState;
}

/**
 * Close WhatsApp connection gracefully
 */
async function closeWhatsApp() {
  isShuttingDown = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
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
