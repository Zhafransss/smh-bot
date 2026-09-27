const { matchOperationalInfo } = require('../matchers/operationalMatcher');
const { matchUnitSales } = require('../matchers/unitSalesMatcher');
const { matchLayerA } = require('../matchers/keywordMatcher');
const logger = require('../utils/logger');

/**
 * Standard admin escalation message (PRD Bagian 7.4)
 */
const ADMIN_ESCALATION_REPLY =
  `Pesan Anda telah kami teruskan ke admin / teknisi Selis Molis Hoki. ` +
  `Admin kami akan segera membalas pesan Anda secara manual. Mohon ditunggu ya kak! 🙏`;

/**
 * Main matcher service to process incoming messages across Layer A, Layer B, and Layer C
 * @param {string} messageText - Incoming text from customer
 * @param {object} [options] - Optional configurations { threshold, forceRefresh }
 * @returns {Promise<object>} Matcher result object
 */
async function matchIntent(messageText, options = {}) {
  const threshold =
    options.threshold !== undefined
      ? options.threshold
      : parseInt(process.env.MATCHER_THRESHOLD, 10) || 2;

  logger.debug({ messageText, threshold }, 'Processing intent match');

  // 1. Layer C: Check for Unit Sales Non-Price queries (Used units, stock, nego)
  // Per PRD 7.3: Automatically escalates to admin without generic answers
  const unitSalesResult = matchUnitSales(messageText);
  if (unitSalesResult && unitSalesResult.isEscalated) {
    logger.info(
      { reason: unitSalesResult.escalationReason },
      'Matched Layer C (Unit Sales Non-Price) -> Escalate to admin'
    );
    return {
      matched: false,
      layer: 'LAYER_C',
      item: null,
      score: 0,
      threshold,
      isEscalated: true,
      escalationReason: unitSalesResult.escalationReason,
      reply: ADMIN_ESCALATION_REPLY,
    };
  }

  // 2. Layer A: PRIORITASKAN Pengecekan ke Database (item_services)
  // Semua pesan servis/harga/kendala harus dicek terhadap katalog database terlebih dahulu
  const layerAResult = await matchLayerA(messageText, { threshold, ...options });
  if (layerAResult.matched) {
    logger.info(
      {
        matchedItem: layerAResult.item.name,
        score: layerAResult.score,
        threshold: layerAResult.threshold,
      },
      'Matched Layer A (Service & Price from Database)'
    );
    return {
      matched: true,
      layer: 'LAYER_A',
      item: layerAResult.item,
      score: layerAResult.score,
      threshold: layerAResult.threshold,
      matchedKeywords: layerAResult.matchedKeywords,
      isEscalated: false,
      escalationReason: null,
      reply: layerAResult.reply,
    };
  }

  // 3. Layer B: Check for Operational Info (Greeting, Store Location, Hours, General Pricing/Complaint Guidance)
  const operationalResult = matchOperationalInfo(messageText);
  if (operationalResult && operationalResult.matched) {
    logger.info(
      { subIntent: operationalResult.subIntent },
      'Matched Layer B (Operational Info / General Service Guidance)'
    );
    return {
      matched: true,
      layer: 'LAYER_B',
      item: null,
      subIntent: operationalResult.subIntent,
      score: 0,
      threshold,
      isEscalated: false,
      escalationReason: null,
      reply: operationalResult.reply,
    };
  }

  // 4. Layer D: Fallback / Escalation to Admin
  // (Triggered by low_score, tie_score, or no_match yang bukan keluhan/servis)
  logger.info(
    {
      reason: layerAResult.reason,
      score: layerAResult.score,
      threshold: layerAResult.threshold,
    },
    'No direct match in Layer A/B/C -> Triggering admin fallback'
  );

  return {
    matched: false,
    layer: 'LAYER_D_FALLBACK',
    item: layerAResult.item || null,
    score: layerAResult.score,
    threshold: layerAResult.threshold,
    matchedKeywords: layerAResult.matchedKeywords || [],
    isEscalated: true,
    escalationReason: layerAResult.reason || 'no_match',
    topItems: layerAResult.topItems || [],
    reply: ADMIN_ESCALATION_REPLY,
  };
}

module.exports = {
  ADMIN_ESCALATION_REPLY,
  matchIntent,
  matchOperationalInfo,
  matchUnitSales,
  matchLayerA,
};
