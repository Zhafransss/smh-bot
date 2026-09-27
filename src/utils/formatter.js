/**
 * Formatting utilities for SMH Support
 */

/**
 * Normalize WhatsApp JID to plain phone number.
 * Example: "6281234567890@s.whatsapp.net" → "6281234567890"
 */
function normalizePhone(jid) {
  if (!jid) return null;
  // Strip server part and multi-device suffix ("628123:12@s.whatsapp.net" → "628123")
  return jid.replace(/@.*$/, '').replace(/:\d+$/, '').replace(/[^0-9]/g, '');
}

/**
 * Convert an international Indonesian number to the local format used by the website
 * (data_pelanggans.noHP is stored as typed in web forms, e.g. "081234567890").
 * Example: "6281234567890" → "081234567890". Non-Indonesian numbers are returned with "+".
 */
function toLocalPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.startsWith('62')) return `0${digits.slice(2)}`;
  if (digits.startsWith('0')) return digits;
  return `+${digits}`;
}

/**
 * Generate ticket number with format SMH-YYYYMMDD-XXXX
 * @param {number} sequenceToday - The sequential count for today
 */
function generateTicketNumber(sequenceToday) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const seq = String(sequenceToday).padStart(4, '0');
  return `SMH-${y}${m}${d}-${seq}`;
}

/**
 * Format date to Indonesian locale string
 */
function formatDateID(date) {
  return new Date(date).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Get start of today (WIB) as Date object
 */
function startOfTodayWIB() {
  const now = new Date();
  const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  wib.setHours(0, 0, 0, 0);
  return wib;
}

/**
 * Format number to Indonesian Rupiah currency string.
 * Example: 35000 -> "Rp35.000"
 */
function formatRupiah(amount) {
  if (amount === null || amount === undefined) return 'Rp0';
  const num = Number(amount);
  return 'Rp' + num.toLocaleString('id-ID');
}

module.exports = {
  normalizePhone,
  toLocalPhone,
  generateTicketNumber,
  formatDateID,
  startOfTodayWIB,
  formatRupiah,
};
