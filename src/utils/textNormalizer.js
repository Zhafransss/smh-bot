/**
 * Text normalizer for customer chat messages (used by the rule-based matchers)
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

module.exports = { normalizeText };
