const geminiService = require('./gemini.service');
const groqService = require('./groq.service');
const logger = require('../utils/logger');

/**
 * Complaint classifier with provider failover.
 * Order comes from CLASSIFIER_PROVIDERS (default "gemini,groq"): if a provider fails
 * (all its keys/models limited, overloaded, timed out, invalid output) the next one is tried.
 * Every provider uses the same prompt and the same output validation (utils/complaintPrompt).
 */

const PROVIDERS = {
  gemini: geminiService,
  groq: groqService,
};

function getProviderOrder() {
  const names = (process.env.CLASSIFIER_PROVIDERS || 'gemini,groq')
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter((n, i, all) => n && all.indexOf(n) === i);

  const unknown = names.filter((n) => !PROVIDERS[n]);
  if (unknown.length) logger.warn({ unknown }, 'Unknown CLASSIFIER_PROVIDERS entries ignored');

  return names.filter((n) => PROVIDERS[n] && PROVIDERS[n].isConfigured());
}

function isConfigured() {
  return getProviderOrder().length > 0;
}

/**
 * @param {{ complaint: string, vehicle: 'sepeda'|'motor'|null, options: Array<{ id: number, nama: string }> }} input
 * @returns {Promise<{ isComplaint: boolean, vehicle: 'sepeda'|'motor'|null, jenisId: number|null, summary: string, provider: string }>}
 * @throws when no provider is configured or every provider failed
 */
async function classifyComplaint(input) {
  const order = getProviderOrder();
  if (order.length === 0) throw new Error('Tidak ada AI provider yang dikonfigurasi (GEMINI_API_KEY / GROQ_API_KEY)');

  const errors = [];
  for (const name of order) {
    try {
      const result = await PROVIDERS[name].classifyComplaint(input);
      if (errors.length) logger.warn({ provider: name, failed: errors }, 'Complaint classified by backup AI provider');
      return { ...result, provider: name };
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      logger.warn({ provider: name, err: err.message }, 'AI provider failed, trying next provider');
    }
  }
  throw new Error(`Semua AI provider gagal → ${errors.join(' | ')}`);
}

module.exports = {
  isConfigured,
  classifyComplaint,
};
