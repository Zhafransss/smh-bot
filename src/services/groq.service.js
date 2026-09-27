const logger = require('../utils/logger');
const { SYSTEM_INSTRUCTION, JSON_SCHEMA, buildUserPrompt, parseClassification } = require('../utils/complaintPrompt');

/**
 * Groq API client (OpenAI-compatible) — backup complaint classifier when Gemini is unavailable.
 * Same contract as gemini.service: picks one id from the jenis kerusakan list, validated by
 * the shared parser; nothing it generates is sent to the customer.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = parseInt(process.env.GROQ_TIMEOUT_MS, 10) || 15000;

function isConfigured() {
  const key = process.env.GROQ_API_KEY;
  return !!key && !key.startsWith('your-');
}

function getModels() {
  return [
    process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    process.env.GROQ_FALLBACK_MODEL === undefined ? 'openai/gpt-oss-20b' : process.env.GROQ_FALLBACK_MODEL,
  ].filter((m, i, all) => m && all.indexOf(m) === i);
}

/**
 * @param {{ complaint: string, vehicle: 'sepeda'|'motor'|null, options: Array<{ id: number, nama: string }> }} input
 * @returns {Promise<{ isComplaint: boolean, vehicle: 'sepeda'|'motor'|null, jenisId: number|null, summary: string }>}
 */
async function classifyComplaint({ complaint, vehicle, options }) {
  if (!isConfigured()) throw new Error('GROQ_API_KEY belum dikonfigurasi');

  const messages = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    { role: 'user', content: buildUserPrompt({ complaint, vehicle, options }) },
  ];

  const startedAt = Date.now();
  let lastError = null;
  for (const model of getModels()) {
    try {
      const response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages,
          response_format: { type: 'json_schema', json_schema: { name: 'klasifikasi_keluhan', schema: JSON_SCHEMA, strict: true } },
          // gpt-oss models reason before answering; a short classification needs little of it
          ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        lastError = new Error(`Groq API HTTP ${response.status} (${model}): ${body?.error?.message || 'unknown error'}`);
        // 429 limit / 5xx overload / 404 model gone → next model; other errors (bad key, bad request) → stop
        if ([404, 429, 500, 502, 503].includes(response.status)) {
          logger.warn({ model, status: response.status }, 'Groq model unavailable, trying fallback model');
          continue;
        }
        break;
      }

      const { result, rejectedId } = parseClassification(body?.choices?.[0]?.message?.content, options);
      if (rejectedId !== undefined) {
        logger.warn({ returnedId: rejectedId }, 'Groq returned an id outside the jenis kerusakan list — ignored');
      }
      logger.info({ ...result, provider: 'groq', model, latencyMs: Date.now() - startedAt }, 'Groq complaint classification');
      return result;
    } catch (err) {
      lastError = err.message.startsWith('AI provider') ? err : new Error(`Groq API ${model}: ${err.message}`);
      logger.warn({ model, err: lastError.message }, 'Groq request failed, trying fallback model');
    }
  }

  throw lastError || new Error('Groq API: tidak ada model yang tersedia');
}

module.exports = {
  isConfigured,
  classifyComplaint,
};
