const nodemailer = require('nodemailer');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');

let transporter = null;

const THROTTLE_KEY = 'alert_throttle:email_escalation';
const PENDING_ALERTS_KEY = 'alert_pending:escalations';
const DEFAULT_THROTTLE_SECONDS = parseInt(process.env.EMAIL_ALERT_THROTTLE_SECONDS, 10) || 300; // 5 minutes

/**
 * Initialize Gmail / SMTP transporter
 */
function initTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
}

/**
 * Send alert email to IT team when WhatsApp connection is lost
 * @param {string} reason - Description of what happened
 */
async function sendConnectionAlert(reason) {
  try {
    const mail = initTransporter();
    const recipients = process.env.ALERT_RECIPIENTS || '';

    if (!recipients || !process.env.SMTP_USER || process.env.SMTP_PASS === 'your-app-password-here') {
      logger.warn('Email alert skipped: SMTP credentials not configured');
      return;
    }

    await mail.sendMail({
      from: `"SMH Support Bot Alert" <${process.env.SMTP_USER}>`,
      to: recipients,
      subject: '⚠️ SMH Support Bot — Koneksi WhatsApp Terputus',
      html: `
        <h2>⚠️ Alert: Koneksi WhatsApp Chatbot Terputus</h2>
        <p><strong>Waktu:</strong> ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</p>
        <p><strong>Alasan:</strong> ${reason}</p>
        <hr>
        <p>Tindakan yang perlu dilakukan:</p>
        <ol>
          <li>Cek status server chatbot</li>
          <li>Jika perlu scan QR ulang, akses terminal server dan restart aplikasi</li>
          <li>Pastikan HP yang terhubung dalam keadaan online</li>
        </ol>
        <p><em>Email ini dikirim otomatis oleh sistem SMH Support Bot.</em></p>
      `,
    });

    logger.info({ recipients }, 'Connection alert email sent');
  } catch (err) {
    logger.error({ err }, 'Failed to send connection alert email');
  }
}

/**
 * Send alert when QR code needs to be rescanned
 */
async function sendQRScanAlert() {
  await sendConnectionAlert(
    'Sesi WhatsApp expired. Perlu scan QR code ulang untuk menghubungkan kembali chatbot.'
  );
}

/**
 * Send throttled / batched email notification for admin escalation (PRD Bagian 7.4)
 * @param {object} escalationData
 * @param {string} escalationData.phoneNumber
 * @param {string} escalationData.incomingMessage
 * @param {string} escalationData.escalationReason
 * @param {string} [escalationData.matchedLayer]
 */
async function sendEscalationAlert(escalationData) {
  try {
    const redis = getRedisClient();
    const recipients = process.env.ALERT_RECIPIENTS || '';

    if (!recipients || !process.env.SMTP_USER || process.env.SMTP_PASS === 'your-app-password-here') {
      logger.debug('Escalation email alert skipped: SMTP credentials not configured');
      return { sent: false, reason: 'smtp_not_configured' };
    }

    const item = {
      ...escalationData,
      timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
    };

    // Check if throttle is currently active in Redis
    const isThrottled = (await redis.exists(THROTTLE_KEY)) === 1;

    if (isThrottled) {
      // Push to pending alerts batch in Redis
      await redis.rpush(PENDING_ALERTS_KEY, JSON.stringify(item));
      logger.debug(
        { phoneNumber: escalationData.phoneNumber, reason: escalationData.escalationReason },
        'Escalation email throttled (added to pending batch)'
      );
      return { sent: false, throttled: true };
    }

    // Set throttle lock in Redis
    await redis.setex(THROTTLE_KEY, DEFAULT_THROTTLE_SECONDS, 'active');

    // Drain any previously pending alerts from Redis
    const pendingRaw = await redis.lrange(PENDING_ALERTS_KEY, 0, -1);
    await redis.del(PENDING_ALERTS_KEY);

    const allAlerts = [item];
    if (pendingRaw && pendingRaw.length > 0) {
      for (const p of pendingRaw) {
        try {
          allAlerts.push(JSON.parse(p));
        } catch {
          // ignore parsing error
        }
      }
    }

    // Build email HTML
    const mail = initTransporter();
    const subject =
      allAlerts.length === 1
        ? `🔔 Eskalasi Chatbot SMH: ${item.phoneNumber} (${item.escalationReason})`
        : `🔔 [Batch x${allAlerts.length}] Eskalasi Chatbot SMH Memerlukan Bantuan Admin`;

    const rowsHtml = allAlerts
      .map(
        (a, idx) => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px; font-weight: bold;">${idx + 1}</td>
          <td style="padding: 10px;">${a.phoneNumber}</td>
          <td style="padding: 10px; color: #b91c1c; font-weight: bold;">${a.escalationReason}</td>
          <td style="padding: 10px; font-style: italic;">"${a.incomingMessage}"</td>
          <td style="padding: 10px; font-size: 12px; color: #64748b;">${a.timestamp}</td>
        </tr>
      `
      )
      .join('');

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; color: #1e293b;">
        <h2 style="color: #ea580c; border-bottom: 2px solid #fed7aa; padding-bottom: 8px;">
          🛵 Selis Molis Hoki — Notifikasi Eskalasi Admin
        </h2>
        <p>Halo Tim Admin,</p>
        <p>Konsumen berikut memerlukan bantuan manual dari teknisi/admin karena pertanyaan tidak dapat dijawab otomatis oleh bot (status chat diset <strong>admin-handled</strong> selama 24 jam):</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc; border: 1px solid #cbd5e1;">
          <thead>
            <tr style="background: #e2e8f0; text-align: left;">
              <th style="padding: 8px;">#</th>
              <th style="padding: 8px;">No. WhatsApp</th>
              <th style="padding: 8px;">Alasan</th>
              <th style="padding: 8px;">Pesan Konsumen</th>
              <th style="padding: 8px;">Waktu</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <div style="background: #fef3c7; padding: 12px; border-left: 4px solid #f59e0b; margin: 16px 0;">
          📌 <em>Catatan: Notifikasi ini di-throttle setiap ${DEFAULT_THROTTLE_SECONDS / 60} menit untuk mencegah banjir email.</em>
        </div>

        <p>Silakan segera follow up konsumen melalui WhatsApp Web toko.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin-top: 24px;" />
        <p style="font-size: 12px; color: #94a3b8;">Email otomatis dari Selis Molis Hoki WhatsApp Chatbot System.</p>
      </div>
    `;

    await mail.sendMail({
      from: `"SMH Chatbot Alert" <${process.env.SMTP_USER}>`,
      to: recipients,
      subject,
      html,
    });

    logger.info(
      { recipients, count: allAlerts.length },
      'Throttled escalation email alert sent successfully'
    );

    return { sent: true, count: allAlerts.length };
  } catch (err) {
    logger.error({ err }, 'Failed to send escalation email alert');
    return { sent: false, error: err.message };
  }
}

module.exports = {
  sendConnectionAlert,
  sendQRScanAlert,
  sendEscalationAlert,
  initTransporter,
};
