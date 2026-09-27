const websiteService = require('./website.service');
const complaintClassifier = require('./complaintClassifier.service');
const { looksLikeVehicleComplaint } = require('../matchers/operationalMatcher');
const { normalizeText } = require('../utils/textNormalizer');
const logger = require('../utils/logger');

/**
 * Complaint → jenis kerusakan (website) diagnosis (PRD v1.2).
 *
 * The AI classifier (Gemini, backup Groq) only picks an id from the website's list; the name & estimated cost shown to the
 * customer always come from that list. When nothing fits, the configured DEFAULT jenis
 * (e.g. "Pengecekan Umum") is used — DEFAULT_JENIS_KERUSAKAN_ID in .env.
 */

/** "sepeda" / "motor" when the text says so unambiguously, otherwise null. */
function detectVehicle(text) {
  const norm = normalizeText(text); // molis → motor listrik, selis → sepeda listrik
  const sepeda = /\bsepeda\b/.test(norm);
  const motor = /\bmotor\b/.test(norm);
  if (sepeda && !motor) return 'sepeda';
  if (motor && !sepeda) return 'motor';
  return null;
}

/** Jenis kerusakan whose name is specific to one vehicle type (price differs per vehicle). */
function isVehicleSpecific(jenis) {
  // No \b: names use underscores ("Error kode M_Sepeda listrik"), and "_" counts as a word char
  return /sepeda|motor/i.test(jenis.nama);
}

function getDefaultJenisId() {
  const id = parseInt(process.env.DEFAULT_JENIS_KERUSAKAN_ID, 10);
  return Number.isInteger(id) ? id : null;
}

/**
 * @param {{ complaint: string, vehicle?: 'sepeda'|'motor'|null, expectComplaint?: boolean }} input
 *   expectComplaint: the bot explicitly asked for a complaint, so the message is treated as one
 *   even when it cannot be verified (e.g. every AI provider unavailable)
 * @returns {Promise<
 *   { status: 'matched'|'default', jenis: object, vehicle: string|null, summary: string, geminiFailed?: boolean }
 *   | { status: 'need_vehicle', summary: string }
 *   | { status: 'not_complaint', intent?: string }   (intent only when an AI classified the message)
 *   | { status: 'unavailable', reason: string }
 * >}
 */
async function diagnoseComplaint({ complaint, vehicle = null, expectComplaint = false }) {
  const knownVehicle = vehicle || detectVehicle(complaint);

  let options;
  try {
    options = await websiteService.getJenisKerusakan();
  } catch (err) {
    logger.error({ err: err.message }, 'Diagnosis: jenis kerusakan list unavailable');
    if (!expectComplaint && !looksLikeVehicleComplaint(complaint)) return { status: 'not_complaint' };
    return { status: 'unavailable', reason: 'jenis_kerusakan_api_unavailable' };
  }

  const defaultId = getDefaultJenisId();
  const defaultJenis = defaultId !== null ? options.find((o) => o.id === defaultId) || null : null;
  if (defaultId !== null && !defaultJenis) {
    logger.warn({ defaultId }, 'DEFAULT_JENIS_KERUSAKAN_ID not found in website jenis kerusakan list');
  }
  const candidates = options.filter((o) => o.id !== defaultId); // the AI must never "choose" the fallback

  const useDefault = (extra) =>
    defaultJenis
      ? { status: 'default', jenis: defaultJenis, vehicle: knownVehicle, ...extra }
      : { status: 'unavailable', reason: 'default_jenis_not_configured' };

  let result;
  try {
    result = await complaintClassifier.classifyComplaint({ complaint, vehicle: knownVehicle, options: candidates });
  } catch (err) {
    logger.error({ err: err.message }, 'Diagnosis: all AI providers failed');
    if (!expectComplaint && !looksLikeVehicleComplaint(complaint)) return { status: 'not_complaint' };
    return useDefault({ summary: '', geminiFailed: true });
  }

  if (!result.isComplaint && !expectComplaint) return { status: 'not_complaint', intent: result.intent };
  if (!result.isComplaint && expectComplaint && !looksLikeVehicleComplaint(complaint)) {
    return { status: 'not_complaint', intent: result.intent };
  }

  // Only trust a vehicle type the customer actually wrote (or answered). AI models tend to guess
  // one even when the message does not say it — and sepeda/motor variants differ in price.
  const resolvedVehicle = knownVehicle;
  const jenis = result.jenisId !== null ? candidates.find((o) => o.id === result.jenisId) : null;

  if (jenis) {
    // Price differs per vehicle type and we don't know which one → ask instead of guessing
    if (!resolvedVehicle && isVehicleSpecific(jenis)) {
      return { status: 'need_vehicle', summary: result.summary };
    }
    return { status: 'matched', jenis, vehicle: resolvedVehicle, summary: result.summary };
  }

  return useDefault({ vehicle: resolvedVehicle, summary: result.summary });
}

module.exports = {
  detectVehicle,
  diagnoseComplaint,
};
