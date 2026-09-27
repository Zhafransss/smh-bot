const { normalizeText } = require('./keywordMatcher');

/**
 * Patterns that indicate unit sales inquiry (especially second-hand / stock / negotiation)
 */
const USED_UNIT_PATTERNS = [
  'seken',
  'bekas',
  'second',
  'secon',
  '2nd',
];

const UNIT_ENTITY_PATTERNS = [
  'molis',
  'motor listrik',
  'sepeda listrik',
  'unit',
  'kendaraan',
];

const SALES_TRANSACTION_PATTERNS = [
  'jual',
  'beli',
  'stok',
  'ready',
  'kondisi',
  'nego',
  'surat',
  'tawar',
  'kelengkapan',
];

/**
 * Check if the query is a Unit Sales (Jual-Beli Unit) inquiry
 * and specifically if it falls into non-price / used unit scope (PRD Bagian 7.3)
 * @param {string} rawMessage
 * @returns {object|null}
 */
function matchUnitSales(rawMessage) {
  const norm = normalizeText(rawMessage);
  if (!norm) return null;

  const hasUsedKeyword = USED_UNIT_PATTERNS.some((u) => {
    const regex = new RegExp(`(?:^|\\s)${u}(?:$|\\s)`);
    return regex.test(norm);
  });

  const hasUnitKeyword = UNIT_ENTITY_PATTERNS.some((u) => norm.includes(u));
  const hasSalesKeyword = SALES_TRANSACTION_PATTERNS.some((s) => {
    const regex = new RegExp(`(?:^|\\s)${s}(?:$|\\s)`);
    return regex.test(norm);
  });

  // Direct check: "Ada jual molis seken?", "unit bekas ready?", "stok motor listrik seken"
  if (hasUsedKeyword && (hasUnitKeyword || hasSalesKeyword)) {
    return {
      matched: false,
      layer: 'LAYER_C',
      isEscalated: true,
      escalationReason: 'jual_beli_non_harga',
      explanation: 'Pertanyaan jual-beli unit seken/bekas otomatis dialihkan ke admin (PRD 7.3)',
    };
  }

  // Stock, condition, or negotiation for whole vehicles (without being a service/trade item)
  const isAskingStockOrCondition =
    (norm.includes('stok') || norm.includes('ready unit') || norm.includes('kondisi unit') || norm.includes('nego')) &&
    hasUnitKeyword;

  if (isAskingStockOrCondition) {
    return {
      matched: false,
      layer: 'LAYER_C',
      isEscalated: true,
      escalationReason: 'jual_beli_non_harga',
      explanation: 'Pertanyaan stok/kondisi/nego unit dialihkan ke admin (PRD 7.3)',
    };
  }

  return null;
}

module.exports = {
  matchUnitSales,
};
