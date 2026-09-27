const logger = require('../utils/logger');
const { INTENTS, SYSTEM_INSTRUCTION, buildUserPrompt, parseClassification } = require('../utils/complaintPrompt');

/**
 * Gemini API client — used ONLY as a classifier (PRD v1.2 Bagian 8):
 * it maps a customer's complaint to one id from the website's jenis kerusakan list.
 * Its output is structured JSON that is validated by the caller; no Gemini-generated
 * text is ever sent to the customer.
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 15000;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_complaint: { type: 'BOOLEAN' },
    intent: { type: 'STRING', enum: INTENTS },
    vehicle: { type: 'STRING', enum: ['sepeda', 'motor', 'tidak_diketahui'] },
    jenis_id: { type: 'INTEGER', nullable: true },
    ringkasan: { type: 'STRING' },
  },
  required: ['is_complaint', 'intent', 'vehicle', 'jenis_id', 'ringkasan'],
};

// ── API key pool ──
// GEMINI_API_KEYS="key1,key2,…" (or a single GEMINI_API_KEY). Keys are used round-robin; a key that
// hits its quota (HTTP 429) is skipped until Google's retry delay has passed. NOTE: quotas are per
// Google Cloud *project* — keys from the same project share one quota.
const DEFAULT_COOLDOWN_MS = 60 * 1000;
const INVALID_KEY_COOLDOWN_MS = 30 * 60 * 1000;
const ANY_MODEL = '*';

const cooldowns = new Map(); // "keyIndex|model" → timestamp until which the key is skipped
let roundRobinCursor = 0;

function getApiKeys() {
  const raw = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k && !k.startsWith('your-'));
}

function getModels() {
  return [
    process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    process.env.GEMINI_FALLBACK_MODEL === undefined ? 'gemini-3.1-flash-lite' : process.env.GEMINI_FALLBACK_MODEL,
  ].filter((m, i, all) => m && all.indexOf(m) === i);
}

/** Label for logs — never log the key itself. */
function keyLabel(index) {
  return `key#${index + 1}`;
}

function isCoolingDown(keyIndex, model, now) {
  return (cooldowns.get(`${keyIndex}|${model}`) || 0) > now || (cooldowns.get(`${keyIndex}|${ANY_MODEL}`) || 0) > now;
}

/** Retry delay Google sends with a 429 (RetryInfo "35s" or "retry in 35.6s"), else 60s. */
function parseRetryDelayMs(body) {
  const retryInfo = body?.error?.details?.find((d) => String(d['@type'] || '').includes('RetryInfo'));
  const fromInfo = /^(\d+(?:\.\d+)?)s$/.exec(retryInfo?.retryDelay || '');
  if (fromInfo) return Math.ceil(parseFloat(fromInfo[1]) * 1000);
  const fromMessage = /retry in (\d+(?:\.\d+)?)s/i.exec(body?.error?.message || '');
  return fromMessage ? Math.ceil(parseFloat(fromMessage[1]) * 1000) : DEFAULT_COOLDOWN_MS;
}

function isKeyProblem(status, body) {
  if (status === 401 || status === 403) return true;
  return status === 400 && /api key/i.test(body?.error?.message || '');
}

function isConfigured() {
  return getApiKeys().length > 0;
}

/** Status of every key (for logs / health checks). */
function getKeyPoolStatus() {
  const now = Date.now();
  return getApiKeys().map((_, i) => ({
    key: keyLabel(i),
    coolingDown: getModels().filter((m) => isCoolingDown(i, m, now)),
  }));
}

/**
 * Classify a complaint against the given jenis kerusakan options.
 * @param {{ complaint: string, vehicle: 'sepeda'|'motor'|null, options: Array<{ id: number, nama: string }> }} input
 * @returns {Promise<{ isComplaint: boolean, vehicle: 'sepeda'|'motor'|null, jenisId: number|null, summary: string }>}
 * @throws when Gemini is not configured, times out, or returns an invalid response
 */
async function classifyComplaint({ complaint, vehicle, options }) {
  if (!isConfigured()) throw new Error('GEMINI_API_KEYS / GEMINI_API_KEY belum dikonfigurasi');

  const prompt = buildUserPrompt({ complaint, vehicle, options });

  const requestBody = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 }, // classification only — keep latency low
    },
  });

  const keys = getApiKeys();
  const models = getModels();
  const firstKey = roundRobinCursor++ % keys.length;
  const keyOrder = keys.map((_, i) => (firstKey + i) % keys.length);

  // For each model (primary → fallback), try every key that is not cooling down.
  //   429 quota        → cool this key down for this model, try the next key
  //   invalid key      → cool this key down for all models, try the next key
  //   503/500/timeout  → the MODEL is overloaded for everyone → go to the fallback model
  //   404 model        → go to the fallback model
  //   other 4xx        → request problem, no point retrying
  const startedAt = Date.now();
  let body;
  let model;
  let usedKey = null;
  let lastError = null;
  let skippedCooling = 0;

  modelLoop: for (model of models) {
    for (const keyIndex of keyOrder) {
      if (isCoolingDown(keyIndex, model, Date.now())) {
        skippedCooling++;
        continue;
      }
      const label = keyLabel(keyIndex);
      try {
        const response = await fetch(`${GEMINI_BASE_URL}/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': keys[keyIndex], // header, so the key never appears in URLs/logs
          },
          body: requestBody,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        body = await response.json().catch(() => null);

        if (response.ok) {
          usedKey = label;
          lastError = null;
          break modelLoop;
        }

        lastError = new Error(`Gemini API HTTP ${response.status} (${model}, ${label}): ${body?.error?.message || 'unknown error'}`);

        if (response.status === 429) {
          const delayMs = parseRetryDelayMs(body);
          cooldowns.set(`${keyIndex}|${model}`, Date.now() + delayMs);
          logger.warn({ key: label, model, cooldownSec: Math.round(delayMs / 1000) }, 'Gemini key hit its quota, switching to next key');
          continue;
        }
        if (isKeyProblem(response.status, body)) {
          cooldowns.set(`${keyIndex}|${ANY_MODEL}`, Date.now() + INVALID_KEY_COOLDOWN_MS);
          logger.error({ key: label, status: response.status }, 'Gemini key rejected (invalid/permission) — disabled for 30 minutes');
          continue;
        }
        if ([404, 500, 503].includes(response.status)) {
          logger.warn({ key: label, model, status: response.status }, 'Gemini model unavailable, trying fallback model');
          continue modelLoop;
        }
        break modelLoop; // other 4xx: the request itself is wrong
      } catch (err) {
        lastError = new Error(`Gemini API ${model} (${label}): ${err.message}`); // timeout / network
        logger.warn({ key: label, model, err: err.message }, 'Gemini request failed, trying fallback model');
        continue modelLoop;
      }
    }
  }

  if (!usedKey) {
    throw lastError || new Error(`Semua API key Gemini sedang terkena limit (${skippedCooling} kombinasi key/model dilewati)`);
  }

  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  const { result, rejectedId } = parseClassification(text, options);
  if (rejectedId !== undefined) {
    logger.warn({ returnedId: rejectedId }, 'Gemini returned an id outside the jenis kerusakan list — ignored');
  }
  logger.info({ ...result, model, key: usedKey, latencyMs: Date.now() - startedAt }, 'Gemini complaint classification');
  return result;
}

module.exports = {
  isConfigured,
  classifyComplaint,
  getKeyPoolStatus,
};
