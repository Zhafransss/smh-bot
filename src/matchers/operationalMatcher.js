const { normalizeText } = require('../utils/textNormalizer');

const OPERATIONAL_DATA = {
  store1: {
    name: 'Bengkel (Pusat)',
    city: 'Purwokerto',
    address: 'Jl. Jend Sudirman No. 32, Kebontebu Berkoh, Purwokerto Selatan, Jawa Tengah.',
  },
  store2: {
    name: 'Bengkel 2 (Cadangan)',
    city: 'Cirebon',
    address: 'Jl. Sultan Agung Sumber Sumber, Cirebon, Jawa Barat.',
  },
  workshopHours: 'Senin–Sabtu, 09.00–17.00 WIB (Minggu & hari libur nasional tutup)',
  homeServiceHours: 'Senin–Sabtu, 09.00–20.00 WIB',
  homeServiceStartHour: 9,
  homeServiceEndHour: 20,
};

/**
 * Check if the message contains outside-hours indicator for home service
 * (e.g. jam 8 pagi, jam 7, jam 21, jam 22, jam 9 malam)
 * @param {string} text
 * @returns {boolean}
 */
function isHomeServiceOutsideHours(text) {
  if (!text) return false;

  // Explicit Sunday request ("hari minggu", "minggu pagi", "ahad") — not "minggu depan/ini/lalu" (= week)
  const sundayPattern = /\b(?:ahad|hari\s+minggu|minggu(?!\s*(?:depan|ini|lalu|kemarin|ke|an)\b))\b/;
  if (sundayPattern.test(text)) return true;

  // "jam 8", "jam 1 siang", "pukul 19 30", "jam 10an malam".
  // Text is already normalized, so "19.30" / "8:30" arrive as "19 30" / "8 30".
  const timePattern = /\b(?:jam|pukul)\s*(\d{1,2})(?:an)?(?:\s+(\d{2}))?(?:\s+(pagi|siang|sore|malam|subuh|dini hari))?\b/g;
  const startMinutes = OPERATIONAL_DATA.homeServiceStartHour * 60;
  const endMinutes = OPERATIONAL_DATA.homeServiceEndHour * 60;
  const isWithinHours = (hour24, minute) => {
    const t = hour24 * 60 + minute;
    return t >= startMinutes && t < endMinutes;
  };

  for (const match of text.matchAll(timePattern)) {
    const hour = parseInt(match[1], 10);
    const minute = match[2] && parseInt(match[2], 10) <= 59 ? parseInt(match[2], 10) : 0;
    const period = match[3];
    if (hour > 24) continue;

    const candidates = toHour24Candidates(hour, period);
    // Only reject when EVERY plausible reading is outside hours ("jam 3" could be 15.00 → accept)
    if (!candidates.some((h) => isWithinHours(h, minute))) return true;
  }

  return false;
}

/**
 * Convert a spoken Indonesian hour (+ optional period word) into possible 24h hours.
 * Without a period word, 1–11 is ambiguous (pagi or sore/malam) so both readings are returned.
 * @param {number} hour
 * @param {string} [period]
 * @returns {number[]}
 */
function toHour24Candidates(hour, period) {
  const h = hour % 24;
  switch (period) {
    case 'pagi':
    case 'subuh':
    case 'dini hari':
      return [h === 12 ? 0 : h];
    case 'siang':
      return [h >= 10 ? h : h + 12]; // "jam 11 siang" = 11, "jam 1 siang" = 13
    case 'sore':
      return [h < 12 ? h + 12 : h];
    case 'malam':
      if (h === 12) return [0];
      return [h >= 6 ? h + 12 : h]; // "jam 9 malam" = 21, "jam 1 malam" = 01
    default:
      return h >= 1 && h <= 11 ? [h, h + 12] : [h];
  }
}

const COMPLAINT_INVITE =
  `Silakan *ceritakan keluhan/kendala* sepeda listrik atau motor listrik kakak ya (misal: "motor listrik tidak bisa dicas", "rem sepeda bunyi"). ` +
  `Kami akan bantu cek jenis kerusakannya beserta *estimasi biayanya*. 😊`;

const GREETING_WORDS = [
  'halo', 'hai', 'hi', 'hey', 'p', 'tes', 'test',
  'assalamualaikum', 'assalamu alaikum', 'assalamu alaikom',
  'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam',
  'pagi', 'siang', 'sore', 'malam', 'permisi',
];

const GREETING_REPLY =
  `Halo kak! Selamat datang di *Selis Molis Hoki (SMH)* 🛵⚡\n` +
  `Bengkel spesialis servis, perawatan, dan suku cadang sepeda listrik & motor listrik.\n\n` +
  `${COMPLAINT_INVITE}\n\n` +
  `Kakak juga bisa menanyakan *jam operasional* atau *lokasi toko* kami (Purwokerto & Cirebon).`;

// ── Small talk (terima kasih / oke / pamit / tawa / emoji) ──
// Short social messages never need the admin. Replies are fixed templates (no AI text).
const SMALL_TALK_REPLIES = {
  thanks:
    `Sama-sama kak! 🙏 Senang bisa membantu. Jika ada kendala lain pada sepeda/motor listriknya, silakan chat kami kapan saja ya. 😊`,
  ack:
    `Siap kak! 👍 Jika ada yang ingin ditanyakan lagi atau ada keluhan pada kendaraannya, silakan chat kami kapan saja ya. 😊`,
  bye: `Terima kasih sudah menghubungi Selis Molis Hoki, kak! Sampai jumpa 🙏`,
  emoji: `😊 Ada lagi yang bisa kami bantu, kak? Silakan ceritakan keluhan kendaraannya, atau tanyakan jam operasional & lokasi toko kami.`,
};

// Compared after collapsing repeated letters ("siappp" → "siap", "okee" → "oke", "makasihh" → "makasih")
const SMALL_TALK_WORDS = {
  thanks: [
    'makasih', 'makasi', 'maksih', 'mksh', 'mks', 'mkasih', 'trims', 'trimakasih', 'terimakasih', 'terimakasi',
    'trimaksih', 'terima', 'trima', 'kasih', 'kasi', 'thanks', 'thank', 'thanku', 'thankyou', 'you', 'thx', 'tq', 'ty',
    'tks', 'tengkyu', 'tenkyu', 'suwun', 'nuwun', 'matur', 'hatur', 'nuhun',
  ],
  bye: ['bye', 'dadah', 'dah', 'sampai', 'jumpa', 'wassalam', 'wassalamualaikum', 'pamit'],
  ack: [
    'ok', 'oke', 'okey', 'okay', 'okeh', 'okie', 'sip', 'siap', 'baik', 'baiklah', 'noted', 'mantap', 'mantab',
    'mantul', 'good', 'nice', 'cool', 'betul', 'benar', 'iya', 'ya', 'yup', 'yoi', 'beres', 'aman', 'done', 'paham',
    'mengerti', 'ngerti', 'oh', 'o', 'owh', 'hm', 'gpp', 'tunggu', 'ditunggu', 'nunggu', 'kabar', 'selanjutnya',
    'tidak', 'gak', 'ga', 'nggak', 'ngga', 'engga', 'enggak', 'belum', 'no', 'cukup', 'itu', 'aja', 'saja',
  ],
};
const SMALL_TALK_FILLERS = [
  'kak', 'ka', 'kk', 'kakak', 'min', 'admin', 'mas', 'mb', 'mba', 'mbak', 'gan', 'bang', 'pak', 'bu', 'om', 'sis',
  'ya', 'yah', 'deh', 'dong', 'sih', 'nih', 'lah', 'juga', 'jg', 'saya', 'aku', 'sy', 'sudah', 'udah', 'udh', 'sdh',
  'banyak', 'byk', 'bnyk', 'sekali', 'bgt', 'banget', 'atas', 'info', 'infonya', 'informasinya', 'bantuannya',
  'nya', 'ku', 'kalau', 'klo', 'gitu', 'begitu', 'kabarnya', 'selalu', 'semua',
];
const LAUGH_PATTERN = /^(?:w?k(?:wk)+w?|(?:ha)+h?|(?:he)+h?|(?:hi)+h?|(?:xi)+x?|lol)$/;

function collapseRepeats(word) {
  return word.replace(/(.)\1+/g, '$1');
}
const SMALL_TALK_LOOKUP = Object.fromEntries(
  Object.entries(SMALL_TALK_WORDS).map(([category, words]) => [category, new Set(words.map(collapseRepeats))])
);
const FILLER_LOOKUP = new Set(SMALL_TALK_FILLERS.map(collapseRepeats));

/**
 * Recognize a short social message (thanks / ok / bye / laughter / emoji only).
 * Every word must be small talk or filler, so "oke motor saya mogok" is NOT small talk.
 * @param {string} rawMessage
 * @returns {'thanks'|'bye'|'ack'|'emoji'|null}
 */
function detectSmallTalk(rawMessage) {
  if (!rawMessage || typeof rawMessage !== 'string') return null;
  if (rawMessage.includes('[')) return null; // photo / location markers are never small talk

  const norm = normalizeText(rawMessage);
  if (!norm) {
    // Only emoji / punctuation ("👍", "🙏🙏", "?")
    return rawMessage.trim() ? 'emoji' : null;
  }

  const tokens = norm.split(' ').map(collapseRepeats);
  if (tokens.length > 8) return null;

  const found = new Set();
  for (const token of tokens) {
    if (FILLER_LOOKUP.has(token)) continue;
    if (LAUGH_PATTERN.test(token)) {
      found.add('emoji');
      continue;
    }
    const category = Object.keys(SMALL_TALK_LOOKUP).find((c) => SMALL_TALK_LOOKUP[c].has(token));
    if (!category) return null; // a real word we don't know → not small talk
    found.add(category);
  }

  for (const category of ['thanks', 'bye', 'ack', 'emoji']) {
    if (found.has(category)) return category;
  }
  return null;
}

const GREETING_LOOKUP = new Set(GREETING_WORDS.map(collapseRepeats));

function isGreetingOnly(norm) {
  // "hallo kakk", "haiii" → same as "halo kak", "hai"
  const collapsed = norm.split(' ').map(collapseRepeats);
  if (GREETING_LOOKUP.has(collapsed.join(' '))) return true;
  return collapsed.length <= 2 && GREETING_LOOKUP.has(collapsed[0]);
}

/**
 * Layer B (info): questions answered from fixed operational data — greeting, remote area,
 * store location, opening hours. Checked BEFORE complaint diagnosis.
 * @param {string} rawMessage
 * @returns {{ matched: true, layer: 'LAYER_B', subIntent: string, reply: string, invitesComplaint?: boolean } | null}
 */
function matchOperationalInfo(rawMessage) {
  // Basa-basi singkat (terima kasih, oke, pamit, emoji) → balasan template, tanpa admin
  const smallTalk = detectSmallTalk(rawMessage);
  if (smallTalk) {
    return { matched: true, layer: 'LAYER_B', subIntent: `SMALL_TALK_${smallTalk.toUpperCase()}`, reply: SMALL_TALK_REPLIES[smallTalk] };
  }

  const norm = normalizeText(rawMessage);
  if (!norm) return null;

  // Sapaan pembuka → persilakan konsumen menceritakan keluhan
  if (isGreetingOnly(norm)) {
    return {
      matched: true,
      layer: 'LAYER_B',
      subIntent: 'GREETING',
      invitesComplaint: true,
      reply: GREETING_REPLY,
    };
  }

  // Outside Area / Remote Consultation (Bengkel belum buka di kota tertentu)
  const remotePatterns = [
    'belum buka di',
    'buka di kota',
    'di luar kota',
    'luar kota',
    'kota lain',
    'kirim part',
    'kirim sparepart',
    'konsultasi jarak jauh',
    'konsultasi remote',
  ];
  if (remotePatterns.some((p) => norm.includes(p))) {
    return {
      matched: true,
      layer: 'LAYER_B',
      subIntent: 'REMOTE_CONSULTATION',
      reply:
        `Halo kak! Untuk saat ini cabang fisik bengkel kami berada di Purwokerto dan Cirebon.\n\n` +
        `Jika Anda berdomisili di luar kota tersebut, kami tetap dapat melayani:\n` +
        `1. 📱 *Konsultasi Teknis & Diagnosa Kendala Jarak Jauh (Remote)*\n` +
        `2. 📦 *Pengiriman Sparepart / Komponen Pengganti* langsung ke alamat Anda\n\n` +
        `Silakan infokan merk/tipe kendaraan dan gejala kendala yang dialami ya kak. Kami siap membantu! 😊`,
    };
  }

  // Lokasi / Alamat Toko (Eksplisit bertanya alamat / cabang)
  const locationKeywords = [
    'alamat',
    'lokasi',
    'di mana bengkel',
    'dimana bengkel',
    'posisi bengkel',
    'toko di mana',
    'toko dimana',
    'tempat bengkel',
    'bengkelnya dimana',
    'bengkelnya di mana',
    'sharelock',
    'share lock',
    'share loc',
    'patokan bengkel',
    'alamat toko',
    'cabang cirebon',
    'cabang purwokerto',
  ];
  if (locationKeywords.some((kw) => norm.includes(kw))) {
    return {
      matched: true,
      layer: 'LAYER_B',
      subIntent: 'STORE_LOCATION',
      reply:
        `Halo kak! Selis Molis Hoki memiliki 2 lokasi bengkel:\n\n` +
        `📍 *Bengkel 1 (Pusat - Purwokerto):*\n` +
        `${OPERATIONAL_DATA.store1.address}\n\n` +
        `📍 *Bengkel 2 (Cirebon):*\n` +
        `${OPERATIONAL_DATA.store2.address}\n\n` +
        `⏰ Jam buka: Senin–Sabtu, 09.00–17.00 WIB (Minggu tutup).\n\n` +
        `Silakan kunjungi bengkel kami atau kabari jika ingin layanan home service ya kak! 😊`,
    };
  }

  // Jam Operasional / Jam Tutup / Jam Buka
  const hoursKeywords = [
    'tutup jam berapa',
    'buka jam berapa',
    'jam buka',
    'jam tutup',
    'jam operasional',
    'jam berapa buka',
    'jam berapa tutup',
    'hari apa buka',
    'hari apa saja buka',
    'minggu buka',
    'hari minggu buka',
    'jadwal bengkel',
    'jam kerja',
  ];
  if (hoursKeywords.some((kw) => norm.includes(kw))) {
    return {
      matched: true,
      layer: 'LAYER_B',
      subIntent: 'OPERATIONAL_HOURS',
      reply:
        `Halo kak! Berikut jadwal operasional Selis Molis Hoki:\n\n` +
        `🔧 *Bengkel:*\n` +
        `Senin–Sabtu: 09.00–17.00 WIB (Minggu tutup)\n\n` +
        `🛵 *Home Service (Panggilan ke Rumah):*\n` +
        `Senin–Sabtu: 09.00–20.00 WIB\n\n` +
        `Bot WhatsApp kami tetap siap menerima pesan Anda 24 jam. Ada yang ingin ditanyakan lagi kak? 😊`,
    };
  }

  return null;
}

/**
 * Layer B (service inquiry): the customer wants service / home service / a price but has not
 * described a problem yet. Checked AFTER complaint diagnosis found no complaint.
 * Prices are never quoted here — estimates come only from the website's jenis kerusakan data.
 * @param {string} rawMessage
 * @returns {{ matched: true, layer: 'LAYER_B', subIntent: string, reply: string, invitesComplaint: true } | null}
 */
function matchServiceInquiry(rawMessage) {
  const norm = normalizeText(rawMessage);
  if (!norm) return null;

  const homeServiceKeywords = [
    'home service', 'homeservice', 'home servis', 'homeservis',
    'panggilan ke rumah', 'servis panggil', 'servis ke rumah', 'servis di rumah',
    'datang ke rumah', 'panggil ke rumah', 'panggil montir', 'panggil teknisi',
    'mekanik ke rumah', 'teknisi ke rumah',
  ];
  if (homeServiceKeywords.some((kw) => norm.includes(kw))) {
    const outsideHours = isHomeServiceOutsideHours(norm);
    return {
      matched: true,
      layer: 'LAYER_B',
      subIntent: outsideHours ? 'HOME_SERVICE_OUTSIDE_HOURS' : 'HOME_SERVICE_GENERAL',
      invitesComplaint: true,
      reply:
        (outsideHours
          ? `Halo kak! Mohon maaf, kunjungan Home Service hanya beroperasi pada *Senin–Sabtu, pukul 09.00–20.00 WIB* (Minggu tutup). ` +
            `Kakak tetap bisa mendaftar untuk jadwal di jam operasional ya.\n\n`
          : `Halo kak! Layanan *Home Service (teknisi datang ke rumah)* Selis Molis Hoki siap melayani Anda. 🛵⚡\n` +
            `⏰ Senin–Sabtu, 09.00–20.00 WIB.\n\n`) + COMPLAINT_INVITE,
    };
  }

  const serviceKeywords = [
    'ingin servis', 'mau servis', 'bisa servis', 'butuh servis', 'perlu servis', 'minta servis',
    'harga servis', 'biaya servis', 'ongkos servis', 'tarif servis', 'daftar harga', 'price list',
    'pricelist', 'berapa biaya', 'berapa harga', 'biayanya berapa', 'harganya berapa', 'ongkosnya berapa',
    'kisaran biaya',
  ];
  const isBareService = ['servis', 'servis motor listrik', 'servis sepeda listrik'].includes(norm);
  if (isBareService || serviceKeywords.some((kw) => norm.includes(kw))) {
    return {
      matched: true,
      layer: 'LAYER_B',
      subIntent: 'SERVICE_INQUIRY',
      invitesComplaint: true,
      reply: `Halo kak! Kami siap membantu servis sepeda & motor listrik kakak, di *Bengkel* maupun via *Home Service*. 🛵⚡\n\n${COMPLAINT_INVITE}`,
    };
  }

  return null;
}

/**
 * Offline heuristic used ONLY when the Gemini diagnosis is unavailable: does the message look
 * like a description of a vehicle problem?
 * @param {string} rawMessage
 * @returns {boolean}
 */
function looksLikeVehicleComplaint(rawMessage) {
  const norm = normalizeText(rawMessage);
  if (!norm) return false;
  const issueKeywords = [
    'rusak', 'mati total', 'mati', 'mogok', 'ngempos', 'blong', 'bocor', 'korslet',
    'gak nyala', 'tidak nyala', 'ga nyala', 'tidak mau jalan', 'gak mau jalan', 'ga mau jalan',
    'tidak bisa jalan', 'bunyi', 'macet', 'habis baterai', 'baterai drop', 'aki drop',
    'tidak bisa dicas', 'tidak mengisi', 'gak mengisi', 'kempes', 'putus', 'patah', 'goyang',
    'error', 'tidak mau digas', 'tidak bisa digas', 'lemah', 'seret', 'retak', 'pecah', 'kode',
  ];
  const componentKeywords = [
    'cas', 'aki', 'baterai', 'rem', 'ban', 'rantai', 'dinamo', 'gas', 'kabel', 'mesin',
    'sepeda', 'motor', 'unit', 'kelistrikan', 'kontroller', 'speedometer', 'alarm', 'shock',
    'spion', 'lampu', 'layar', 'stang',
  ];
  const hasIssue = issueKeywords.some((w) => norm.includes(w));
  const hasComponent = componentKeywords.some((c) => norm.includes(c));
  return hasIssue && (hasComponent || norm.includes('kendala') || norm.includes('masalah'));
}

module.exports = {
  OPERATIONAL_DATA,
  COMPLAINT_INVITE,
  GREETING_REPLY,
  SMALL_TALK_REPLIES,
  detectSmallTalk,
  isHomeServiceOutsideHours,
  toHour24Candidates,
  matchOperationalInfo,
  matchServiceInquiry,
  looksLikeVehicleComplaint,
};
