const { normalizeText } = require('./keywordMatcher');

const OPERATIONAL_DATA = {
  store1: {
    name: 'Toko 1 (Pusat)',
    city: 'Purwokerto',
    address: 'Jl. Jend Sudirman No. 32, Kebontebu Berkoh, Purwokerto Selatan, Jawa Tengah.',
  },
  store2: {
    name: 'Toko 2 (Cadangan)',
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
  // Pattern: jam 5, 6, 7, 8 pagi, or jam 21, 22, 23, 24, jam 9 malam, jam 10 malam
  const outsidePatterns = [
    /\bjam\s*(?:[1-8]|0[1-8])(?:\.00|:00)?\s*(?:pagi)?\b/,
    /\bjam\s*(?:2[1-4])(?:\.00|:00)?\b/,
    /\bjam\s*(?:9|10|11|12)\s*malam\b/,
    /\bpukul\s*(?:[1-8]|0[1-8])(?:\.00|:00)?\b/,
    /\bpukul\s*(?:2[1-4])(?:\.00|:00)?\b/,
  ];
  return outsidePatterns.some((pattern) => pattern.test(text));
}

/**
 * Match operational info queries (Layer B)
 * @param {string} rawMessage
 * @returns {object|null}
 */
function matchOperationalInfo(rawMessage) {
  const norm = normalizeText(rawMessage);
  if (!norm) return null;

  // 0. Sapaan Pembuka (Greetings: Halo, Hai, Assalamualaikum, Pagi, Siang, dll)
  const greetingWords = [
    'halo',
    'hai',
    'hi',
    'hey',
    'p',
    'tes',
    'test',
    'assalamualaikum',
    'assalamu alaikum',
    'assalamu alaikom',
    'selamat pagi',
    'selamat siang',
    'selamat sore',
    'selamat malam',
    'pagi',
    'siang',
    'sore',
    'malam',
    'permisi',
  ];

  const isGreetingOnly = () => {
    if (greetingWords.includes(norm)) return true;
    const tokens = norm.split(' ');
    if (tokens.length <= 2 && greetingWords.includes(tokens[0])) return true;
    return false;
  };

  if (isGreetingOnly()) {
    return {
      matched: true,
      layer: 'LAYER_B',
      subIntent: 'GREETING',
      reply:
        `Halo kak! Selamat datang di *Selis Molis Hoki (SMH)* 🛵⚡\n` +
        `Bengkel spesialis servis, perawatan, dan suku cadang sepeda listrik & motor listrik.\n\n` +
        `Ada yang bisa kami bantu? Anda bisa menanyakan:\n` +
        `• 🔧 *Biaya Servis* (Kelistrikan, baterai/cas, ban bocor, rem, dinamo BLDC, dll.)\n` +
        `• ⏰ *Jam Operasional Bengkel & Layanan Home Service*\n` +
        `• 📍 *Lokasi Toko* (Purwokerto & Cirebon)\n` +
        `• 🛵 *Panggilan ke Rumah (Home Service)*\n\n` +
        `Silakan ceritakan kendala atau kebutuhan kendaraan listrik Anda ya kak. 😊`,
    };
  }

  // 0.1 Permintaan Servis Umum tanpa rincian kendala (misal: "saya ingin service molis")
  const isGeneralServiceInquiry = () => {
    const hasServiceIntent =
      norm.includes('ingin servis') ||
      norm.includes('mau servis') ||
      norm.includes('bisa servis') ||
      norm.includes('butuh servis') ||
      norm.includes('perlu servis') ||
      norm.includes('minta servis') ||
      norm === 'servis' ||
      norm === 'servis molis' ||
      norm === 'servis selis' ||
      norm === 'servis motor listrik' ||
      norm === 'servis sepeda listrik';

    const specificSymptoms = ['bocor', 'cas', 'charger', 'rem', 'rantai', 'aki', 'baterai', 'kontak', 'kabel', 'ban', 'las', 'jok', 'shock'];
    const hasSpecificSymptom = specificSymptoms.some((s) => norm.includes(s));

    return hasServiceIntent && !hasSpecificSymptom;
  };

  if (isGeneralServiceInquiry()) {
    return {
      matched: true,
      layer: 'LAYER_B',
      subIntent: 'SERVICE_MENU_GUIDANCE',
      reply:
        `Halo kak! Kami siap membantu servis sepeda & motor listrik Anda di *Bengkel* maupun via *Home Service (panggilan ke rumah)*. 🛵⚡\n\n` +
        `Layanan servis kami meliputi:\n` +
        `1. ⚡ *Kelistrikan:* Pengecekan mati total, tidak mau digas, korslet, custom kabel body\n` +
        `2. 🔋 *Baterai & Charger:* Servis aki SLA, balancing lithium, colokan/cas rusak, tukar tambah aki\n` +
        `3. 🛠️ *Mekanis & Roda:* Tambal ban bocor, rem blong/ngempos, rantai/vanbelt macet, shockbreaker\n` +
        `4. ⚙️ *Dinamo & Kontroller:* Servis dinamo BLDC recoil, turun mesin, tuning\n` +
        `5. 🛵 *Home Service:* Kunjungan teknisi langsung ke rumah Anda\n\n` +
        `Untuk pendaftaran dan penjadwalan servis, silakan balas dengan mengisi format berikut ya kak:\n` +
        `- Atas nama:\n` +
        `- Alamat:\n` +
        `- Foto unit:\n` +
        `- Kendala:\n\n` +
        `_Contoh: Jika belum sempat foto, tuliskan merk/tipe kendaraan pada kolom foto unit lalu kirimkan fotonya setelah ini._ 😊`,
    };
  }

  // 0.2 Deteksi Keluhan / Laporan Masalah Kendaraan Spesifik
  const isVehicleComplaint = () => {
    const issueKeywords = [
      'rusak', 'mati total', 'mati', 'mogok', 'ngempos', 'blong', 'bocor', 'korslet',
      'gak nyala', 'tidak nyala', 'ga nyala', 'tidak mau jalan', 'gak mau jalan', 'ga mau jalan',
      'tidak bisa jalan', 'gak bisa jalan', 'ga bisa jalan', 'bunyi', 'macet', 'habis baterai',
      'baterai drop', 'aki drop', 'cas tidak masuk', 'tidak bisa dicas', 'gak bisa dicas', 'ga bisa dicas',
      'gabisa dicas', 'tidak mengisi', 'gak mengisi', 'kempes', 'putus', 'patah', 'goyang'
    ];
    const componentKeywords = [
      'cas', 'charger', 'aki', 'baterai', 'rem', 'ban', 'rantai', 'dinamo', 'gas',
      'kabel', 'mesin', 'sepeda', 'motor', 'unit', 'kelistrikan', 'kontroller'
    ];

    const hasIssue = issueKeywords.some((w) => norm.includes(w));
    const hasComponent = componentKeywords.some((c) => norm.includes(c));

    return hasIssue && (hasComponent || norm.includes('kendala') || norm.includes('masalah'));
  };

  if (isVehicleComplaint()) {
    return {
      matched: true,
      layer: 'LAYER_B',
      subIntent: 'VEHICLE_COMPLAINT_INTENT',
      reply:
        `Halo kak! Kendala kendaraan listrik Anda siap ditangani oleh tim teknisi spesialis Selis Molis Hoki. 🛵⚡\n\n` +
        `💰 *Estimasi Biaya:* Untuk pemeriksaan & perbaikan kendala standar (kelistrikan/mekanis) mulai dari *Rp25.000 - Rp35.000* (biaya akhir akan dikonfirmasi teknisi setelah pengecekan kondisi fisik unit).\n\n` +
        `🛵⚡ Layanan perbaikan kami bisa dilakukan langsung di *Bengkel* maupun melalui *Home Service (teknisi kami datang ke rumah)*.\n\n` +
        `Untuk pendaftaran dan penjadwalan servis, silakan balas dengan mengisi format berikut ya kak:\n` +
        `- Atas nama:\n` +
        `- Alamat:\n` +
        `- Foto unit:\n` +
        `- Kendala:\n\n` +
        `_Contoh: Jika belum sempat foto, tuliskan merk/tipe kendaraan pada kolom foto unit lalu kirimkan fotonya setelah ini._ 😊`,
    };
  }

  // 0.3 Deteksi Pertanyaan Biaya / Daftar Harga Servis Umum
  const isGeneralPriceInquiry = () => {
    const priceKeywords = [
      'harga servis', 'biaya servis', 'ongkos servis', 'tarif servis',
      'daftar harga', 'price list', 'pricelist', 'berapa biaya', 'berapa harga',
      'biayanya berapa', 'harganya berapa', 'ongkosnya berapa', 'kisaran biaya'
    ];
    return priceKeywords.some((p) => norm.includes(p));
  };

  if (isGeneralPriceInquiry()) {
    return {
      matched: true,
      layer: 'LAYER_B',
      subIntent: 'GENERAL_PRICE_INQUIRY',
      reply:
        `Halo kak! Berikut estimasi daftar biaya servis di *Selis Molis Hoki*: 🛵⚡\n\n` +
        `1. ⚡ *Biaya Servis Elektris:* Mulai Rp35.000\n` +
        `   _(Pengecekan kelistrikan, kendala cas, sensor, dinamo standar)_\n` +
        `2. 🛠️ *Biaya Servis Mekanis:* Mulai Rp25.000\n` +
        `   _(Rem ngempos/blong, rantai, ban, penyetelan fisik)_\n` +
        `3. 🔋 *Servis & Balancing Aki/Baterai:* Mulai Rp15.000\n` +
        `4. ⚙️ *Servis Dinamo BLDC / Turun Mesin:* Mulai Rp75.000\n` +
        `5. 🛵 *Home Service:* Kunjungan teknisi langsung ke rumah Anda\n\n` +
        `Layanan dapat dilakukan di *Bengkel* maupun via *Home Service*.\n\n` +
        `Untuk pendaftaran dan penjadwalan servis, silakan balas dengan mengisi format berikut ya kak:\n` +
        `- Atas nama:\n` +
        `- Alamat:\n` +
        `- Foto unit:\n` +
        `- Kendala:\n\n` +
        `_Contoh: Jika belum sempat foto, tuliskan merk/tipe kendaraan pada kolom foto unit lalu kirimkan fotonya setelah ini._ 😊`,
    };
  }

  // 1. Outside Area / Remote Consultation (Bengkel belum buka di kota tertentu)
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

  // 2. Home Service / Layanan ke Rumah
  const homeServiceKeywords = [
    'home service',
    'homeservice',
    'home servis',
    'homeservis',
    'panggilan ke rumah',
    'servis panggil',
    'servis ke rumah',
    'servis di rumah',
    'datang ke rumah',
    'panggil ke rumah',
    'panggil montir',
    'panggil teknisi',
    'mekanik ke rumah',
    'teknisi ke rumah',
  ];
  const isHomeServiceQuery = homeServiceKeywords.some((kw) => norm.includes(kw));

  if (isHomeServiceQuery) {
    // Check if customer requested specific hours outside 09.00 - 20.00
    if (isHomeServiceOutsideHours(norm)) {
      return {
        matched: true,
        layer: 'LAYER_B',
        subIntent: 'HOME_SERVICE_OUTSIDE_HOURS',
        reply:
          `Halo kak! Mohon maaf, untuk kunjungan Home Service hanya beroperasi pada:\n` +
          `⏰ *Senin–Sabtu, pukul 09.00–20.00 WIB* (Minggu tutup).\n\n` +
          `Permintaan di luar jam operasional belum dapat kami layani pada waktu tersebut, namun kakak tetap dapat melakukan *reservasi jadwal di jam operasional* dengan format:\n` +
          `• Nama:\n` +
          `• Alamat & Patokan:\n` +
          `• Jenis Kendaraan & Merk:\n` +
          `• Kendala yang Dialami:\n` +
          `• Usulan Hari & Jam Kunjungan:\n\n` +
          `Silakan balas pesan ini dengan data di atas ya kak. Terima kasih! 🙏`,
      };
    }

    // Normal Home Service query
    return {
      matched: true,
      layer: 'LAYER_B',
      subIntent: 'HOME_SERVICE_GENERAL',
      reply:
        `Halo kak! Layanan *Home Service (kunjungan ke rumah)* Selis Molis Hoki siap melayani Anda. 🛵⚡\n\n` +
        `⏰ *Jam Operasional Home Service:* Senin–Sabtu, 09.00–20.00 WIB.\n` +
        `📍 *Wilayah Jangkauan:* Purwokerto & sekitarnya.\n\n` +
        `Untuk pendaftaran kunjungan teknisi, silakan kirimkan data berikut:\n` +
        `• Nama:\n` +
        `• No. WhatsApp:\n` +
        `• Alamat Lengkap & Patokan:\n` +
        `• Jenis Kendaraan (Sepeda / Motor Listrik) & Merk:\n` +
        `• Kendala yang Dialami:\n` +
        `• Rencana Hari & Jam Kunjungan:\n\n` +
        `Teknisi kami akan segera memverifikasi jadwal kunjungan. Terima kasih! 🙏`,
    };
  }

  // 3. Lokasi / Alamat Toko (Eksplisit bertanya alamat / cabang)
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
        `Halo kak! Selis Molis Hoki memiliki 2 lokasi toko:\n\n` +
        `📍 *Toko 1 (Pusat - Purwokerto):*\n` +
        `${OPERATIONAL_DATA.store1.address}\n\n` +
        `📍 *Toko 2 (Cirebon):*\n` +
        `${OPERATIONAL_DATA.store2.address}\n\n` +
        `⏰ Jam buka: Senin–Sabtu, 09.00–17.00 WIB (Minggu tutup).\n\n` +
        `Silakan kunjungi bengkel kami atau kabari jika ingin layanan home service ya kak! 😊`,
    };
  }

  // 4. Jam Operasional / Jam Tutup / Jam Buka
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

module.exports = {
  OPERATIONAL_DATA,
  isHomeServiceOutsideHours,
  matchOperationalInfo,
};
