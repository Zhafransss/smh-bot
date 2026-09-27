const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');

const REGISTRATION_PREFIX = 'service_reg:';
const REGISTRATION_TTL = 7200; // 2 hours

/**
 * Service Registration Manager
 * Handles parsing, validation, multi-step collection (form -> photo -> location),
 * and structures the payload for future external API dispatch.
 */

/**
 * Check if the text matches the registration form structure
 * @param {string} text
 * @returns {boolean}
 */
function isRegistrationForm(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  
  // Must match at least "atas nama" and "alamat" or "kendala"
  const hasName = lower.includes('atas nama') || /\bnama\s*[:=]/.test(lower);
  const hasAddress = lower.includes('alamat') || lower.includes('alamat:');
  const hasProblem = lower.includes('kendala') || lower.includes('kendala:') || lower.includes('keluhan:');

  return (hasName && hasAddress) || (hasName && hasProblem);
}

// Marker injected by whatsapp.service when the customer actually sends an image.
// This is the ONLY reliable signal that a photo exists — typed text never counts as a photo.
const PHOTO_MARKER = '[FOTO_UNIT]';

/**
 * Check whether the (aggregated) message contains a real image attachment
 * @param {string} text
 * @returns {boolean}
 */
function hasPhotoAttachment(text) {
  return typeof text === 'string' && text.includes(PHOTO_MARKER);
}

/**
 * Map a free-form label (e.g. "Alamat Lengkap & Patokan", "Kendala yang Dialami")
 * to a registration field. The bot sends several template variants (Layer A,
 * Layer B home service, outside-hours), so labels are matched by keyword, not exact text.
 * Order matters: "Jenis Kendaraan" must not fall into "nama", etc.
 * @param {string} label
 * @returns {string|null} field key, or null if the label is not recognized
 */
function resolveFormField(label) {
  const l = label.toLowerCase();
  if (l.includes('alamat')) return 'alamat';
  if (l.includes('foto')) return 'fotoUnit';
  if (l.includes('kendala') || l.includes('keluhan')) return 'kendala';
  if (l.includes('kendaraan') || l.includes('merk')) return 'kendaraan';
  if (/\b(whatsapp|wa|hp|telp|telepon)\b/.test(l)) return 'noWhatsapp';
  if (/\b(hari|jam|jadwal|kunjungan)\b/.test(l)) return 'rencanaJadwal';
  if (/\bnama\b/.test(l)) return 'nama';
  return null;
}

/**
 * Parse fields from the registration form text
 * @param {string} text
 * @returns {object} Extracted fields
 */
function parseRegistrationForm(text) {
  if (!text) return {};

  const result = {
    nama: '',
    alamat: '',
    fotoUnit: '',
    kendala: '',
    kendaraan: '',
    noWhatsapp: '',
    rencanaJadwal: '',
    hasPhoto: hasPhotoAttachment(text),
  };

  // Photo marker may sit on its own line (aggregated image message) — never treat it as field content
  const lines = text.split(PHOTO_MARKER).join('\n').split('\n');
  let currentKey = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // "- Atas nama: Budi", "• Alamat Lengkap & Patokan: Jl. ...", "Kendala yang Dialami = mati total"
    const match = line.match(/^[-*•]?\s*([^:=]{1,60}?)\s*[:=]\s*(.*)$/);
    // Template labels never contain digits; "sejak kemarin jam 10:00" is a continuation, not a label
    const field = match && !/\d/.test(match[1]) ? resolveFormField(match[1]) : null;

    if (field) {
      currentKey = field;
      result[field] = match[2].trim();
    } else if (currentKey) {
      // Continuation of previous multi-line value (also covers values containing ':' like "jam 10:00")
      result[currentKey] += ` ${line}`;
    }
  }

  return result;
}

/**
 * Parse location data from incoming location marker
 * e.g. [LOCATION: lat=-7.4243, lng=109.2301, label=Rumah]
 * @param {string} text
 * @returns {object|null}
 */
function parseLocationMessage(text) {
  if (!text || typeof text !== 'string') return null;

  const locMatch = text.match(/\[LOCATION:\s*lat=([-\d.]+),\s*lng=([-\d.]+)(?:,\s*label=([^\]]+))?\]/i);
  if (locMatch) {
    return {
      latitude: parseFloat(locMatch[1]),
      longitude: parseFloat(locMatch[2]),
      label: locMatch[3] ? locMatch[3].trim() : null,
      raw: text,
    };
  }

  // Google Maps link pattern
  const gmapMatch = text.match(/https?:\/\/(?:maps\.google\.com|goo\.gl|maps\.app\.goo\.gl)\/[^\s]+/i);
  if (gmapMatch) {
    return {
      latitude: null,
      longitude: null,
      label: 'Google Maps Link',
      raw: gmapMatch[0],
    };
  }

  return null;
}

/**
 * Get active registration draft from Redis
 * @param {string} phoneNumber
 * @returns {Promise<object|null>}
 */
async function getRegistration(phoneNumber) {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(`${REGISTRATION_PREFIX}${phoneNumber}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    logger.error({ err, phoneNumber }, 'Failed to get registration from Redis');
    return null;
  }
}

/**
 * Save / update registration draft in Redis
 * @param {string} phoneNumber
 * @param {object} data
 */
async function saveRegistration(phoneNumber, data) {
  try {
    const redis = getRedisClient();
    const payload = JSON.stringify({
      phoneNumber,
      ...data,
      updatedAt: new Date().toISOString(),
    });
    await redis.setex(`${REGISTRATION_PREFIX}${phoneNumber}`, REGISTRATION_TTL, payload);
    logger.info({ phoneNumber, data }, 'Registration draft updated in Redis');
  } catch (err) {
    logger.error({ err, phoneNumber }, 'Failed to save registration to Redis');
  }
}

/**
 * Clear registration draft
 * @param {string} phoneNumber
 */
async function clearRegistration(phoneNumber) {
  try {
    const redis = getRedisClient();
    await redis.del(`${REGISTRATION_PREFIX}${phoneNumber}`);
  } catch (err) {
    logger.error({ err, phoneNumber }, 'Failed to clear registration');
  }
}

/**
 * Build the form fields for POST /api/home-service (website PublicServiceController@storeHomeService).
 * The photo file (`gambar`) is attached separately by website.service.
 * @param {object} regData - completed registration draft
 * @returns {Record<string, string>}
 */
function buildHomeServicePayload(regData) {
  // Customer's own words first; the rest are internal notes for the admin
  const deskripsiParts = [regData.complaint || regData.kendala];
  if (regData.vehicle) deskripsiParts.push(`Jenis kendaraan: ${regData.vehicle === 'motor' ? 'Motor listrik' : 'Sepeda listrik'}`);
  if (regData.kendaraan) deskripsiParts.push(`Kendaraan: ${regData.kendaraan}`);
  if (regData.aiSummary) deskripsiParts.push(`Ringkasan AI (internal): ${regData.aiSummary}`);
  if (regData.diagnosis?.isDefault) deskripsiParts.push('Catatan: jenis kerusakan belum spesifik, perlu pengecekan teknisi.');
  if (regData.diagnosis?.geminiFailed) deskripsiParts.push('Catatan: analisis otomatis gagal, estimasi perlu dikonfirmasi admin.');
  if (regData.jadwal?.raw) deskripsiParts.push(`Permintaan jadwal konsumen: "${regData.jadwal.raw}"`);
  deskripsiParts.push('(Didaftarkan via chatbot WhatsApp)');

  return {
    namaLengkap: regData.nama,
    noTelp: regData.contactPhone,
    alamatLengkap: regData.alamat,
    latitude: String(regData.location.latitude),
    longitude: String(regData.location.longitude),
    idJenisKerusakan: String(regData.diagnosis.jenis.id),
    deskripsi: deskripsiParts.join('\n'),
    tanggal: regData.jadwal.tanggal,
    waktuMulai: regData.jadwal.waktuMulai,
    waktuSelesai: regData.jadwal.waktuSelesai,
  };
}

module.exports = {
  PHOTO_MARKER,
  hasPhotoAttachment,
  isRegistrationForm,
  parseRegistrationForm,
  parseLocationMessage,
  getRegistration,
  saveRegistration,
  clearRegistration,
  buildHomeServicePayload,
};
