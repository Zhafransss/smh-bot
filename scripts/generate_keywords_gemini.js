/**
 * ============================================================================
 * SCRIPT BATCH / OFFLINE: GEMINI API KEYWORD ENRICHMENT
 * ============================================================================
 * 
 * ⚠️ PERINGATAN PRINSIP ANTI-HALUSINASI (PRD BAGIAN 8):
 * - Skrip ini TERISOLASI dan BUKAN bagian dari service real-time yang menjawab
 *   konsumen WhatsApp.
 * - Skrip ini HANYA dijalankan secara manual oleh developer/admin untuk
 *   menghasilkan kata kunci/sinonim (meta.keywords) dari data item_services.
 * - Hasil pemanggilan Gemini API WAJIB disimpan terlebih dahulu ke kolom `meta`
 *   di database MySQL sebelum dapat digunakan oleh chatbot.
 * - Konsumen TIDAK PERNAH menerima balasan teks hasil inferensi langsung model AI.
 * - Kolom `generated_by` diisi "gemini-batch-1", "gemini-batch-2", dst. untuk audit.
 * 
 * Penggunaan CLI:
 *   node scripts/generate_keywords_gemini.js --empty-only
 *   node scripts/generate_keywords_gemini.js --id=1
 *   node scripts/generate_keywords_gemini.js --all --dry-run
 *   node scripts/generate_keywords_gemini.js --limit=5 --batch-label=gemini-batch-1
 * ============================================================================
 */

require('dotenv').config();

const { ItemService, sequelize } = require('../src/models');
const logger = require('../src/utils/logger');

// Gemini API Configuration (dari .env)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

/**
 * Call Gemini API to extract search keywords and vehicle hints
 * @param {object} item - ItemService record
 * @returns {Promise<{ keywords: string[], vehicle_hint: string[] }>}
 */
async function callGeminiForKeywords(item) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your-gemini-api-key-here') {
    throw new Error(
      'GEMINI_API_KEY belum diatur di file .env! Silakan masukkan API key Gemini Anda pada baris GEMINI_API_KEY=... di .env'
    );
  }

  const prompt = `Anda adalah asisten bengkel sepeda listrik dan motor listrik "Selis Molis Hoki".
Tugas Anda: Analisis nama layanan/produk dan keterangannya di bawah ini, lalu buatlah daftar kata kunci (keywords) dan variasi kalimat/keluhan yang sering diketikkan konsumen di WhatsApp saat mencari layanan ini.

Data Layanan:
- Nama: "${item.name}"
- Kategori: "${item.category}"
- Keterangan: "${item.keterangan || '-'}"

Ketentuan:
1. Buat 4-8 kata kunci relevan dalam bahasa Indonesia santai/sehari-hari (contoh: "tidak bisa dicas", "rem blong", "ganti ban bocor", "korslet").
2. Tentukan vehicle_hint: array berisi "motor", "sepeda", keduanya, atau kosong [] jika berlaku umum.
3. KELUARKAN HANYA JSON MURNI TANPA MARKDOWN / BACKTICKS dengan format persis:
{
  "keywords": ["kata kunci 1", "keluhan 2", "frasa 3"],
  "vehicle_hint": ["motor"]
}`;

  const requestBody = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2, // Low temperature for deterministic output
      responseMimeType: 'application/json',
    },
  };

  const response = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('Gemini API returned empty response');
  }

  // Parse JSON response safely
  const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleanJson);

  return {
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map((k) => k.toLowerCase().trim()) : [],
    vehicle_hint: Array.isArray(parsed.vehicle_hint) ? parsed.vehicle_hint.map((v) => v.toLowerCase().trim()) : [],
  };
}

/**
 * Format meta JSON matching PRD Bagian 8.3
 * @param {object} generated - { keywords, vehicle_hint }
 * @param {string} batchLabel - e.g. "gemini-batch-1"
 * @returns {object}
 */
function buildMetaJson(generated, batchLabel = 'gemini-batch-1') {
  const today = new Date().toISOString().split('T')[0];
  return {
    keywords: generated.keywords || [],
    vehicle_hint: generated.vehicle_hint || [],
    generated_by: batchLabel,
    generated_at: today,
  };
}

/**
 * Main batch runner
 */
async function runBatch() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isEmptyOnly = args.includes('--empty-only');
  const isAll = args.includes('--all');
  
  const idArg = args.find((a) => a.startsWith('--id='));
  const targetId = idArg ? parseInt(idArg.split('=')[1], 10) : null;

  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

  const batchArg = args.find((a) => a.startsWith('--batch-label='));
  const batchLabel = batchArg ? batchArg.split('=')[1] : 'gemini-batch-1';

  console.log('\n===============================================================');
  console.log('  SELIS MOLIS HOKI — BATCH GEMINI KEYWORD ENRICHMENT');
  console.log('  ⚠️ Status: Batch Offline / Developer CLI Tool');
  console.log('===============================================================');
  console.log(`  • Model:       ${GEMINI_MODEL}`);
  console.log(`  • Batch Label: ${batchLabel}`);
  console.log(`  • Dry Run:     ${isDryRun ? 'YES (tidak menulis ke database)' : 'NO'}`);
  console.log('---------------------------------------------------------------\n');

  try {
    await sequelize.authenticate();

    // Build query conditions
    const where = {};
    if (targetId) {
      where.id = targetId;
    } else if (isEmptyOnly) {
      where.meta = null;
    }

    const queryOptions = {
      where,
      order: [['id', 'ASC']],
    };
    if (limit) {
      queryOptions.limit = limit;
    }

    const items = await ItemService.findAll(queryOptions);

    if (items.length === 0) {
      console.log('ℹ️ Tidak ada item yang memenuhi kriteria untuk diproses.');
      process.exit(0);
    }

    console.log(`Ditemukan ${items.length} item untuk diproses:\n`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      console.log(`[${i + 1}/${items.length}] ID ${item.id}: "${item.name}" (${item.category})`);

      try {
        console.log('   Memanggil Gemini API...');
        const generated = await callGeminiForKeywords(item);
        const metaObj = buildMetaJson(generated, batchLabel);

        console.log('   Hasil Keywords:', metaObj.keywords);
        console.log('   Vehicle Hint:  ', metaObj.vehicle_hint);
        console.log('   Generated By:  ', metaObj.generated_by);

        if (!isDryRun) {
          item.meta = metaObj;
          await item.save();
          console.log('   ✅ Disimpan ke database MySQL (kolom meta)');
        } else {
          console.log('   🔍 [DRY-RUN] Melewati penulisan ke database');
        }

        successCount++;
        // Small delay to respect rate limit of Gemini API
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        console.error(`   ❌ Gagal: ${err.message}`);
        failCount++;
      }
      console.log('---------------------------------------------------------------');
    }

    console.log(`\n🎉 Proses Batch Selesai! Sukses: ${successCount}, Gagal: ${failCount}`);
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Fatal Error pada proses batch:', err.message);
    process.exit(1);
  }
}

// Execute if called directly from CLI
if (require.main === module) {
  runBatch();
}

module.exports = {
  callGeminiForKeywords,
  buildMetaJson,
};
