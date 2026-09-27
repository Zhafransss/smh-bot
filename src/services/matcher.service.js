const { matchOperationalInfo, matchServiceInquiry } = require('../matchers/operationalMatcher');
const { matchUnitSales } = require('../matchers/unitSalesMatcher');
const logger = require('../utils/logger');

/**
 * Rule-based layers (no AI). Complaint → jenis kerusakan diagnosis lives in diagnosis.service.
 *
 * Message pipeline (see message.handler):
 *   Layer C  jual-beli unit non-harga        → escalate to admin
 *   Layer B  info (sapaan, lokasi, jam, …)   → fixed answer
 *   Diagnosis keluhan (Gemini → jenis kerusakan website)
 *   Layer B  service inquiry (mau servis/home service/harga, tanpa keluhan) → invite complaint
 *   Layer D  fallback                          → escalate to admin
 *
 * Layer A (item_services keyword matching) was removed in PRD v1.2 — estimates now come
 * exclusively from the website's jenis kerusakan data.
 */

/**
 * Standard admin escalation message (PRD Bagian 7.4)
 */
const ADMIN_ESCALATION_REPLY =
  `Pesan Anda telah kami teruskan ke admin / teknisi Selis Molis Hoki. ` +
  `Admin kami akan segera membalas pesan Anda secara manual. Mohon ditunggu ya kak! 🙏`;

/**
 * Layers checked before complaint diagnosis: C (escalate) then B info.
 * @param {string} messageText
 * @returns {object|null} match result, or null when no rule applies
 */
function matchRules(messageText) {
  const unitSalesResult = matchUnitSales(messageText);
  if (unitSalesResult && unitSalesResult.isEscalated) {
    logger.info({ reason: unitSalesResult.escalationReason }, 'Matched Layer C (Unit Sales Non-Price) -> Escalate to admin');
    return {
      matched: false,
      layer: 'LAYER_C',
      isEscalated: true,
      escalationReason: unitSalesResult.escalationReason,
      reply: ADMIN_ESCALATION_REPLY,
    };
  }

  const infoResult = matchOperationalInfo(messageText);
  if (infoResult) {
    logger.info({ subIntent: infoResult.subIntent }, 'Matched Layer B (Operational Info)');
    return { ...infoResult, isEscalated: false };
  }

  return null;
}

/**
 * Layer B service inquiry — only used after diagnosis found no complaint.
 * @param {string} messageText
 */
function matchServiceIntent(messageText) {
  const result = matchServiceInquiry(messageText);
  return result ? { ...result, isEscalated: false } : null;
}

/**
 * Layer D fallback result.
 * @param {string} [reason]
 */
function buildFallback(reason = 'no_match') {
  return {
    matched: false,
    layer: 'LAYER_D_FALLBACK',
    isEscalated: true,
    escalationReason: reason,
    reply: ADMIN_ESCALATION_REPLY,
  };
}

module.exports = {
  ADMIN_ESCALATION_REPLY,
  matchRules,
  matchServiceIntent,
  buildFallback,
};
