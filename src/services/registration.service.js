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
  const hasName = lower.includes('atas nama') || lower.includes('nama:');
  const hasAddress = lower.includes('alamat') || lower.includes('alamat:');
  const hasProblem = lower.includes('kendala') || lower.includes('kendala:') || lower.includes('keluhan:');

  return (hasName && hasAddress) || (hasName && hasProblem);
}

/**
 * Parse fields from the registration form text
 * @param {string} text
 * @returns {object} Extracted fields
 */
function parseRegistrationForm(text) {
  if (!text) return {};

  const lines = text.split('\n');
  const result = {
    nama: '',
    alamat: '',
    fotoUnit: '',
    kendala: '',
    hasPhoto: false,
  };

  let currentKey = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Pattern matching: - Atas nama: Budi or Atas nama : Budi
    const match = line.match(/^[-*•]?\s*(atas\s+nama|nama|alamat|foto\s*(?:unit)?|kendala|keluhan)\s*[:=]\s*(.*)$/i);

    if (match) {
      const field = match[1].toLowerCase().replace(/\s+/g, '');
      const value = match[2].trim();

      if (field.includes('nama')) {
        currentKey = 'nama';
        result.nama = value;
      } else if (field.includes('alamat')) {
        currentKey = 'alamat';
        result.alamat = value;
      } else if (field.includes('foto')) {
        currentKey = 'fotoUnit';
        result.fotoUnit = value;
        if (value && !['-', '--', 'belum', 'nanti', 'tidak ada', 'tdk ada'].includes(value.toLowerCase())) {
          result.hasPhoto = true;
        }
      } else if (field.includes('kendala') || field.includes('keluhan')) {
        currentKey = 'kendala';
        result.kendala = value;
      }
    } else if (currentKey) {
      // Continuation of previous multi-line value
      result[currentKey] += ` ${line}`;
    }
  }

  // Check if message itself contained an attached photo marker [FOTO_UNIT]
  if (text.includes('[FOTO_UNIT]')) {
    result.hasPhoto = true;
    if (!result.fotoUnit) result.fotoUnit = '[FOTO_UNIT TERLAMPIR]';
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
 * Structure standardized API Request Body for external endpoint dispatch
 * @param {object} regData
 * @returns {object}
 */
function buildApiRequestBody(regData) {
  return {
    customer_phone: regData.phoneNumber,
    customer_name: regData.nama || '',
    service_type: regData.serviceType || 'home_service_or_workshop',
    address: regData.alamat || '',
    problem_description: regData.kendala || '',
    unit_photo: {
      has_photo: !!regData.hasPhoto,
      media_info: regData.fotoUnit || (regData.hasPhoto ? '[FOTO_UNIT]' : null),
    },
    location: {
      latitude: regData.location?.latitude || null,
      longitude: regData.location?.longitude || null,
      label: regData.location?.label || null,
      raw: regData.location?.raw || null,
    },
    status: 'pending_verification',
    registered_at: regData.registeredAt || new Date().toISOString(),
  };
}

/**
 * Stub function to dispatch registration data to external API endpoint
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function dispatchRegistrationToEndpoint(payload) {
  logger.info({ payload }, '📦 [DISPATCH READY] Registration data prepared for external API endpoint');
  
  // TODO: Hubungkan ke endpoint API tujuan ketika URL & auth sudah disediakan:
  // const response = await axios.post(process.env.SERVICE_REGISTRATION_ENDPOINT, payload);
  // return response.data;

  return {
    success: true,
    dispatched: false,
    message: 'Data successfully formatted and buffered. Ready for external endpoint integration.',
    payload,
  };
}

module.exports = {
  isRegistrationForm,
  parseRegistrationForm,
  parseLocationMessage,
  getRegistration,
  saveRegistration,
  clearRegistration,
  buildApiRequestBody,
  dispatchRegistrationToEndpoint,
};
