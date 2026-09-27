/**
 * Release WhatsApp numbers from the "admin-handled" state so the bot replies to them again
 * (and clear their conversation state / registration draft).
 *
 * Usage:
 *   npm run release -- 6281234567890              one number (08…, +62…, 62… all accepted)
 *   npm run release -- 081234567890 6289876543210 several numbers
 *   npm run release -- --list                     show numbers currently handled by the admin
 */
require('dotenv').config({ quiet: true });
const Redis = require('ioredis');

const ADMIN_HANDLED_PREFIX = 'admin_handled:';
const KEY_PREFIXES = [ADMIN_HANDLED_PREFIX, 'conv_state:', 'service_reg:'];

/** Same format the bot uses as its id: digits only, Indonesian numbers as 62… */
function normalizeNumber(input) {
  const digits = String(input).replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

function formatTtl(seconds) {
  if (seconds < 0) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}j ${m}m`;
}

async function listAdminHandled(redis) {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${ADMIN_HANDLED_PREFIX}*`, 'COUNT', 200);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');

  if (keys.length === 0) {
    console.log('Tidak ada nomor yang sedang ditangani admin.');
    return;
  }
  console.log(`${keys.length} nomor sedang ditangani admin (bot diam):\n`);
  for (const key of keys.sort()) {
    const [raw, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
    let reason = '-';
    try {
      reason = JSON.parse(raw).reason || '-';
    } catch {
      // keep "-"
    }
    console.log(`  ${key.slice(ADMIN_HANDLED_PREFIX.length).padEnd(16)} alasan: ${reason.padEnd(28)} sisa: ${formatTtl(ttl)}`);
  }
  console.log('\nLepas dengan: npm run release -- <nomor>');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Pemakaian:\n  npm run release -- 6281234567890\n  npm run release -- --list');
    process.exit(1);
  }

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    retryStrategy: () => null, // fail fast instead of retrying forever
  });

  try {
    await redis.connect();
  } catch (err) {
    console.error(`Gagal terhubung ke Redis (${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}): ${err.message}`);
    console.error('Pastikan Redis menyala (npm run dev menyalakan Redis otomatis).');
    process.exit(1);
  }

  if (args.includes('--list')) {
    await listAdminHandled(redis);
  } else {
    for (const arg of args) {
      const number = normalizeNumber(arg);
      if (!number) continue;
      const wasHandled = (await redis.exists(`${ADMIN_HANDLED_PREFIX}${number}`)) === 1;
      const removed = await redis.del(...KEY_PREFIXES.map((p) => `${p}${number}`));
      console.log(
        wasHandled
          ? `✅ ${number} dilepas — bot akan membalas nomor ini lagi.`
          : `ℹ️  ${number} tidak sedang ditangani admin${removed ? ' (status percakapan/draft dibersihkan)' : ''}.`
      );
    }
  }

  await redis.quit();
}

main();
