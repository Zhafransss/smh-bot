const { ItemService } = require('../models');
const { formatRupiah } = require('../utils/formatter');
const logger = require('../utils/logger');

// Known Standard vs Custom SKU pairs (PRD Bagian 6.2)
// When both match or tie occurs, standard MUST be prioritized.
const STANDARD_CUSTOM_PAIRS = [
  { standardId: 1, customId: 2 }, // Biaya Servis Elektris (35k) vs Custom (50k)
  { standardId: 3, customId: 227 }, // Biaya Servis Mekanis (25k) vs Custom (50k)
];

// In-memory catalog cache for Layer A items (category IN ('service', 'trade'))
let catalogCache = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load service & trade items from MySQL database
 * @param {boolean} forceRefresh - If true, bypass cache and reload from DB
 * @returns {Promise<Array>}
 */
async function getServiceCatalog(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && catalogCache && now - lastCacheTime < CACHE_TTL_MS) {
    return catalogCache;
  }

  try {
    const items = await ItemService.findAll({
      where: {
        category: ['service', 'trade'],
      },
      order: [['id', 'ASC']],
    });

    catalogCache = items;
    lastCacheTime = now;
    logger.debug({ count: items.length }, 'Layer A service catalog loaded from DB');
    return catalogCache;
  } catch (err) {
    logger.error({ err }, 'Failed to load service catalog from DB');
    if (catalogCache) return catalogCache; // Fallback to stale cache if available
    throw err;
  }
}

/**
 * Text normalizer for customer chat messages
 * - Lowercase
 * - Normalize symbols & extra whitespace
 * - Map common Indonesian workshop variants
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  let normalized = text.toLowerCase();

  // Replace punctuation/symbols with spaces, keep alphanumeric and hyphens
  normalized = normalized.replace(/[^\w\s-]/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Normalize common variations in Indonesian workshop queries
  normalized = normalized
    .replace(/\bservice\b/g, 'servis')
    .replace(/\bmolis\b/g, 'motor listrik')
    .replace(/\bselis\b/g, 'sepeda listrik')
    .replace(/\bdi cas\b/g, 'dicas')
    .replace(/\bdi charge\b/g, 'dicas')
    .replace(/\bcharge\b/g, 'cas')
    .replace(/\bcharger\b/g, 'cas')
    .replace(/\bgak bisa\b/g, 'tidak bisa')
    .replace(/\bga bisa\b/g, 'tidak bisa')
    .replace(/\bgabisa\b/g, 'tidak bisa')
    .replace(/\bgak masuk\b/g, 'tidak bisa masuk')
    .replace(/\bga masuk\b/g, 'tidak bisa masuk')
    .replace(/\bgabisa masuk\b/g, 'tidak bisa dicas')
    .replace(/\btidak bisa masuk\b/g, 'tidak bisa dicas')
    .replace(/\bngampas\b/g, 'kampas')
    .replace(/\bkonslet\b/g, 'korslet')
    .replace(/\bkonsleting\b/g, 'korslet')
    .replace(/\bkoslet\b/g, 'korslet')
    .replace(/\bkosleting\b/g, 'korslet')
    .replace(/\bkorsleting\b/g, 'korslet');

  return normalized;
}

/**
 * Helper to escape regex special characters
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if a single keyword pattern matches the normalized message
 * @param {string} messageNorm - Normalized message text
 * @param {string} keyword - Keyword from meta.keywords
 * @returns {boolean}
 */
function checkKeywordMatch(messageNorm, keyword) {
  const kwNorm = normalizeText(keyword);
  if (!kwNorm) return false;

  // Single word keyword: match with word boundary
  if (!kwNorm.includes(' ')) {
    const regex = new RegExp(`(?:^|\\s)${escapeRegex(kwNorm)}(?:$|\\s)`);
    return regex.test(messageNorm);
  }

  // Exact phrase match
  if (messageNorm.includes(kwNorm)) {
    return true;
  }

  // Token-set match: all individual content words must be present in message
  const words = kwNorm.split(' ').filter((w) => w.length > 1);
  if (words.length === 0) return false;

  return words.every((w) => {
    const regex = new RegExp(`(?:^|\\s)${escapeRegex(w)}(?:$|\\s)`);
    return regex.test(messageNorm);
  });
}

/**
 * Resolve ties between candidates (Standard vs Custom, Checking vs Replacement, Vehicle Hint)
 * @param {Array} topItems
 * @param {string} normalizedMessage
 * @param {Array} allScoredItems
 * @returns {Array}
 */
function resolveTies(topItems, normalizedMessage = '', allScoredItems = []) {
  if (topItems.length === 0) return topItems;

  // 1. Pengecekan ("cek", "pengecekan", "periksa", "diagnosa")
  // User Rule: "jika ada kalimat cek itu sama dengan service elektris karena masuk kedalam pengecekan"
  const isCheckingQuery =
    normalizedMessage.includes('cek') ||
    normalizedMessage.includes('pengecekan') ||
    normalizedMessage.includes('periksa') ||
    normalizedMessage.includes('diagnosa');

  if (isCheckingQuery) {
    // Cari Item ID 1 (Biaya Servis Elektris)
    const elektrisTop = topItems.find((t) => t.item.id === 1);
    if (elektrisTop) {
      logger.info('Checking query detected -> prioritizing Biaya Servis Elektris (ID 1)');
      return [elektrisTop];
    }
    const elektrisAll = allScoredItems.find((t) => t.item.id === 1);
    if (elektrisAll) {
      logger.info('Checking query detected in all items -> resolving to Biaya Servis Elektris (ID 1)');
      return [elektrisAll];
    }
  }

  if (topItems.length <= 1) return topItems;

  // 2. Standard vs Custom conflict resolution (PRD Bagian 6.2)
  for (const pair of STANDARD_CUSTOM_PAIRS) {
    const hasStandard = topItems.some((t) => t.item.id === pair.standardId);
    const hasCustom = topItems.some((t) => t.item.id === pair.customId);

    if (hasStandard && hasCustom) {
      logger.info(
        { standardId: pair.standardId, customId: pair.customId },
        'Standard vs Custom conflict detected. Defaulting to Standard as per PRD 6.2'
      );
      const resolved = topItems.filter((t) => t.item.id !== pair.customId);
      if (resolved.length === 1) {
        return resolved;
      }
    }
  }

  // 3. Vehicle Hint Resolution (Sepeda vs Motor)
  const isSepeda =
    normalizedMessage.includes('sepeda') ||
    normalizedMessage.includes('selis') ||
    normalizedMessage.includes('sepedah');
  const isMotor =
    normalizedMessage.includes('motor') ||
    normalizedMessage.includes('molis');

  if (isSepeda && !isMotor) {
    const sepedaItems = topItems.filter(
      (t) =>
        t.item.meta?.vehicle_hint?.includes('sepeda') ||
        t.item.name.toLowerCase().includes('sepeda')
    );
    if (sepedaItems.length === 1) return sepedaItems;
  } else if (isMotor && !isSepeda) {
    const motorItems = topItems.filter(
      (t) =>
        t.item.meta?.vehicle_hint?.includes('motor') ||
        t.item.name.toLowerCase().includes('motor')
    );
    if (motorItems.length === 1) return motorItems;
  }

  return topItems;
}

/**
 * Build formal, polite customer reply message for Layer A (Service & Price)
 * Includes workshop vs home service options and service registration format.
 * @param {object} item - ItemService record
 * @param {string} [contextMessage] - Original customer query for contextual enrichment
 * @returns {string}
 */
function buildLayerAReply(item, contextMessage = '') {
  const priceFormatted = formatRupiah(item.price);
  const unitStr = item.unit ? ` / ${item.unit}` : '';
  const normCtx = normalizeText(contextMessage);

  let reply = `Halo kak! Untuk penanganan kendala *${item.name}*, estimasi biayanya mulai dari *${priceFormatted}${unitStr}*.\n\n`;

  if (item.id === 1) {
    reply += `ℹ️ *Cakupan Servis Elektris:* Meliputi pengecekan dan perbaikan dinamo, baterai & pengisian (cas), sistem penerangan (lampu depan/belakang/rem), lampu sein (riting), klakson, sensor gas, saklar, dan jalur kabel kelistrikan.\n\n`;
    if (normCtx.includes('kabel')) {
      reply += `ℹ️ *Catatan Kabel Body:* Biaya pengecekan kabel & diagnosa jalur kelistrikan adalah Rp35.000. Jika setelah dicek ternyata kabel body terbakar/rusak parah dan membutuhkan penggantian kabel body baru (custom full), estimasi biayanya adalah Rp150.000 (Sepeda Listrik) atau Rp300.000 (Motor Listrik).\n\n`;
    }
  } else if (item.keterangan && item.keterangan.trim()) {
    reply += `ℹ️ *Keterangan:* ${item.keterangan.trim()}\n\n`;
  }

  reply += `⚠️ _Catatan: Biaya akhir dapat disesuaikan tergantung tingkat kerumitan setelah dicek oleh teknisi._\n\n`;
  reply += `🛵⚡ Layanan ini dapat kami tangani langsung di *Bengkel* maupun melalui *Home Service (teknisi datang ke rumah)*.\n\n`;
  reply += `Untuk pendaftaran dan penjadwalan servis, silakan balas dengan mengisi format berikut ya kak:\n` +
    `- Atas nama:\n` +
    `- Alamat:\n` +
    `- Foto unit:\n` +
    `- Kendala:\n\n` +
    `_Contoh: Jika belum sempat foto, ketikkan nama kendaraan pada kolom foto unit lalu kirimkan fotonya setelah ini._ 😊`;

  return reply;
}

/**
 * Build multi-item reply from database when query matches multiple valid options (e.g. Kabel Body Sepeda vs Motor)
 * @param {Array} items
 * @returns {string}
 */
function buildMultiItemReply(items) {
  let reply = `Halo kak! Untuk layanan terkait kabel body, berikut pilihan estimasi biayanya dari database kami: 🛵⚡\n\n`;
  for (const it of items) {
    reply += `• *${it.name}:* ${formatRupiah(it.price)}${it.unit ? ` / ${it.unit}` : ''}\n`;
    if (it.keterangan && it.keterangan.trim()) {
      reply += `  _${it.keterangan.trim()}_\n`;
    }
  }
  reply += `\n⚠️ _Catatan: Biaya akhir dapat disesuaikan tergantung tingkat kerumitan setelah dicek oleh teknisi._\n\n`;
  reply += `🛵⚡ Layanan ini dapat kami tangani langsung di *Bengkel* maupun melalui *Home Service (teknisi datang ke rumah)*.\n\n`;
  reply += `Untuk pendaftaran dan penjadwalan servis, silakan balas dengan mengisi format berikut ya kak:\n` +
    `- Atas nama:\n` +
    `- Alamat:\n` +
    `- Foto unit:\n` +
    `- Kendala:\n\n` +
    `_Contoh: Jika belum sempat foto, ketikkan nama kendaraan pada kolom foto unit lalu kirimkan fotonya setelah ini._ 😊`;
  return reply;
}

/**
 * Match incoming message against Layer A (Service & Price from DB item_services)
 * @param {string} messageText - Incoming customer message
 * @param {object} [options] - Optional settings { threshold, forceRefresh }
 * @returns {Promise<object>} Match result object
 */
async function matchLayerA(messageText, options = {}) {
  const threshold =
    options.threshold !== undefined
      ? options.threshold
      : parseInt(process.env.MATCHER_THRESHOLD, 10) || 2;

  const items = await getServiceCatalog(options.forceRefresh);
  const normalizedMessage = normalizeText(messageText);

  if (!normalizedMessage) {
    return {
      matched: false,
      layer: 'LAYER_A',
      item: null,
      score: 0,
      threshold,
      matchedKeywords: [],
      reason: 'no_match',
      reply: null,
    };
  }

  const scoredItems = [];

  for (const item of items) {
    const meta = item.meta;
    const keywords = meta && Array.isArray(meta.keywords) ? [...meta.keywords] : [];

    // Sertakan nama item dari database (item.name) agar pencarian di database selalu komprehensif
    if (item.name) {
      const nameNorm = normalizeText(item.name);
      if (nameNorm && !keywords.includes(nameNorm)) {
        keywords.push(nameNorm);
      }
      // Ekstrak kata kunci penting dari nama item
      const importantNameWords = nameNorm
        .split(' ')
        .filter((w) => w.length > 2 && !['biaya', 'sepeda', 'motor', 'listrik', 'custom'].includes(w));
      for (const w of importantNameWords) {
        if (!keywords.includes(w)) {
          keywords.push(w);
        }
      }
    }

    if (keywords.length === 0) continue;

    const matchedKeywords = [];
    for (const kw of keywords) {
      if (checkKeywordMatch(normalizedMessage, kw)) {
        matchedKeywords.push(kw);
      }
    }

    if (matchedKeywords.length > 0) {
      scoredItems.push({
        item,
        score: matchedKeywords.length,
        matchedKeywords,
      });
    }
  }

  // Sort descending by score
  scoredItems.sort((a, b) => b.score - a.score);

  if (scoredItems.length === 0) {
    return {
      matched: false,
      layer: 'LAYER_A',
      item: null,
      score: 0,
      threshold,
      matchedKeywords: [],
      reason: 'no_match',
      reply: null,
    };
  }

  const maxScore = scoredItems[0].score;

  // Check confidence threshold
  if (maxScore < threshold) {
    return {
      matched: false,
      layer: 'LAYER_A',
      item: scoredItems[0].item,
      score: maxScore,
      threshold,
      matchedKeywords: scoredItems[0].matchedKeywords,
      reason: 'low_score',
      reply: null,
    };
  }

  // Find all items with maxScore
  let topItems = scoredItems.filter((s) => s.score === maxScore);

  // Apply tie-breaking rules (Checking priority, Standard vs Custom, Vehicle Hint)
  topItems = resolveTies(topItems, normalizedMessage, scoredItems);

  if (topItems.length > 1) {
    // Cek apakah tie ini adalah opsi Kabel Body (Item 5 Sepeda & Item 6 Motor)
    const hasKabelBodySepeda = topItems.some((t) => t.item.id === 5);
    const hasKabelBodyMotor = topItems.some((t) => t.item.id === 6);

    if (hasKabelBodySepeda && hasKabelBodyMotor) {
      logger.info('Tie between Kabel Body Sepeda and Motor -> displaying both options from database');
      const kabelItems = topItems.filter((t) => t.item.id === 5 || t.item.id === 6).map((t) => t.item);
      return {
        matched: true,
        layer: 'LAYER_A',
        item: kabelItems[0],
        items: kabelItems,
        score: maxScore,
        threshold,
        matchedKeywords: topItems.flatMap((t) => t.matchedKeywords),
        reason: null,
        reply: buildMultiItemReply(kabelItems),
      };
    }

    return {
      matched: false,
      layer: 'LAYER_A',
      item: null,
      score: maxScore,
      threshold,
      matchedKeywords: topItems.flatMap((t) => t.matchedKeywords),
      reason: 'tie_score',
      topItems: topItems.map((t) => ({ id: t.item.id, name: t.item.name, score: t.score })),
      reply: null,
    };
  }

  const winner = topItems[0];
  return {
    matched: true,
    layer: 'LAYER_A',
    item: winner.item,
    score: winner.score,
    threshold,
    matchedKeywords: winner.matchedKeywords,
    reason: null,
    reply: buildLayerAReply(winner.item, messageText),
  };
}

module.exports = {
  getServiceCatalog,
  normalizeText,
  checkKeywordMatch,
  resolveTies,
  buildLayerAReply,
  matchLayerA,
};
