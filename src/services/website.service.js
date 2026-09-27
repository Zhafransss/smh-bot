const fs = require('fs/promises');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Client for the Selis Molis Hoki website public API (Laravel, routes/api.php).
 * Auth: X-API-KEY header (middleware `api.key`) — api route group, no CSRF/session.
 */

const REQUEST_TIMEOUT_MS = 10000;
const UPLOAD_TIMEOUT_MS = 30000; // photo upload + reservation transaction + web push on the website
const JENIS_KERUSAKAN_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let jenisKerusakanCache = null;
let jenisKerusakanCachedAt = 0;

function getConfig() {
  const baseUrl = (process.env.WEBSITE_API_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.WEBSITE_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('WEBSITE_API_URL / WEBSITE_API_KEY belum dikonfigurasi di .env');
  }
  return { baseUrl, apiKey };
}

/**
 * Call a website API endpoint and return the parsed JSON body.
 * Throws on network error, timeout, non-2xx status or `success: false`.
 * @param {string} path - e.g. "/jenis-kerusakan"
 * @param {RequestInit} [options]
 */
async function request(path, options = {}) {
  const { baseUrl, apiKey } = getConfig();
  const url = `${baseUrl}${path}`;
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;

  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      'X-API-KEY': apiKey,
      Accept: 'application/json',
      ...fetchOptions.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON response (e.g. HTML 404 page when the API is not deployed)
  }

  if (!response.ok || !body || body.success === false) {
    const err = new Error(
      `Website API ${options.method || 'GET'} ${path} gagal: HTTP ${response.status}` +
        (body?.message ? ` - ${body.message}` : '')
    );
    err.status = response.status;
    err.body = body;
    throw err;
  }

  return body;
}

/**
 * GET /api/jenis-kerusakan — damage types with estimated cost (the source of truth for
 * `idJenisKerusakan` when creating a home service reservation).
 * Cached briefly; on API failure a stale cache is used if available.
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<Array<{ id: number, nama: string, biaya_estimasi: number|null }>>}
 */
async function getJenisKerusakan({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && jenisKerusakanCache && now - jenisKerusakanCachedAt < JENIS_KERUSAKAN_CACHE_TTL_MS) {
    return jenisKerusakanCache;
  }

  try {
    const body = await request('/jenis-kerusakan');
    const items = (Array.isArray(body.data) ? body.data : [])
      .filter((item) => item && item.id && item.nama)
      .map((item) => ({
        id: Number(item.id),
        nama: String(item.nama).trim(),
        biaya_estimasi: item.biaya_estimasi !== null && item.biaya_estimasi !== undefined ? Number(item.biaya_estimasi) : null,
      }));

    if (items.length === 0) throw new Error('Website API mengembalikan daftar jenis kerusakan kosong');

    jenisKerusakanCache = items;
    jenisKerusakanCachedAt = now;
    logger.debug({ count: items.length }, 'Jenis kerusakan loaded from website API');
    return items;
  } catch (err) {
    if (jenisKerusakanCache) {
      logger.warn({ err: err.message }, 'Website API unavailable, using stale jenis kerusakan cache');
      return jenisKerusakanCache;
    }
    throw err;
  }
}

/**
 * POST /api/home-service — create a Home Service reservation (multipart, photo required).
 * NOT retried automatically: a timeout may still have created the reservation on the website,
 * and a retry would create a duplicate. The caller escalates failures to the admin instead.
 * @param {Record<string, string>} fields - from registration.service.buildHomeServicePayload
 * @param {string} photoPath - local image file downloaded from WhatsApp
 * @returns {Promise<object>} response `data` (no_resi, biaya_perjalanan, jarak_km, ...)
 */
async function createHomeService(fields, photoPath) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }

  const buffer = await fs.readFile(photoPath);
  const ext = path.extname(photoPath).slice(1).toLowerCase() || 'jpg';
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  form.append('gambar', new Blob([buffer], { type: mime }), `foto_unit.${ext}`);

  // Content-Type (with multipart boundary) is set by fetch from the FormData body
  const body = await request('/home-service', { method: 'POST', body: form, timeoutMs: UPLOAD_TIMEOUT_MS });
  return body.data;
}

module.exports = {
  request,
  getJenisKerusakan,
  createHomeService,
};
