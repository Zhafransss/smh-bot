const registrationService = require('./registration.service');
const conversationService = require('./conversation.service');
const diagnosisService = require('./diagnosis.service');
const websiteService = require('./website.service');
const mediaService = require('./media.service');
const alertService = require('./alert.service');
const {
  OPERATIONAL_DATA,
  COMPLAINT_INVITE,
  GREETING_REPLY,
  SMALL_TALK_REPLIES,
  detectSmallTalk,
  looksLikeVehicleComplaint,
} = require('../matchers/operationalMatcher');
const { parseSchedule } = require('../utils/scheduleParser');
const { isValidPhone } = require('../utils/validator');
const { formatRupiah, toLocalPhone } = require('../utils/formatter');
const logger = require('../utils/logger');

/**
 * Complaint → Home Service reservation flow (PRD v1.2):
 *
 *   keluhan → [jenis kendaraan, if needed] → diagnosis (Gemini picks a website jenis kerusakan)
 *   → estimasi biaya from the website DB → konfirmasi (YA / TIDAK / detail tambahan)
 *   → nama & alamat → foto unit → pin lokasi konsumen → hari & jam
 *   → [nomor WA, only if WhatsApp hides it] → POST /api/home-service → no. resi
 *
 * The next data-collection step is derived from what is still MISSING in the draft, so a photo
 * or location sent earlier than asked is kept instead of being rejected.
 */

const REG_STATE = {
  VEHICLE: 'AWAITING_VEHICLE',
  DIAGNOSIS_CONFIRM: 'AWAITING_DIAGNOSIS_CONFIRM',
  FORM: 'AWAITING_FORM',
  PHOTO: 'AWAITING_PHOTO',
  LOCATION: 'AWAITING_LOCATION',
  SCHEDULE: 'AWAITING_SCHEDULE',
  PHONE: 'AWAITING_PHONE',
};

// Set after a greeting / service inquiry: the next free-text message is treated as a complaint
const AWAITING_COMPLAINT = 'AWAITING_COMPLAINT';

const MAX_DIAGNOSIS_ATTEMPTS = 3;
const PHOTO_FAILED_MARKER = '[FOTO_GAGAL]';
const YES_ANSWERS = ['ya', 'iya', 'y', 'yes', 'yup', 'ok', 'oke', 'okay', 'lanjut', 'boleh', 'mau', 'siap', 'betul', 'benar', 'sesuai', 'setuju', 'gas'];
const NO_ANSWERS = ['tidak', 'tdk', 'gak', 'ga', 'nggak', 'ngga', 'enggak', 'engga', 'no', 'belum', 'nanti', 'nanti dulu', 'tidak dulu', 'gak dulu', 'ga dulu', 'belum dulu', 'tidak jadi', 'gak jadi', 'ga jadi'];
const CANCEL_ANSWERS = ['batal', 'batalkan', 'cancel', 'stop'];

const VEHICLE_PROMPT =
  `🛵 Kendaraan kakak *sepeda listrik* atau *motor listrik*? (estimasi biaya untuk keduanya berbeda)`;

const FORM_PROMPT =
  `Siap kak! Untuk pendaftaran *Home Service*, silakan balas dengan format berikut:\n\n` +
  `- Atas nama:\n` +
  `- Alamat:\n\n` +
  `_(Ketik *batal* kapan saja untuk membatalkan pendaftaran)_`;

const PHOTO_PROMPT =
  `📸 Silakan kirimkan *foto unit kendaraan* Anda ya kak (langsung foto via WhatsApp) agar teknisi kami dapat melihat tipe & kondisi fisik unit.`;

const LOCATION_PROMPT =
  `📍 Silakan kirimkan *Share Lokasi (Pin Lokasi WhatsApp)* tempat teknisi kami harus datang (rumah/lokasi kendaraan kakak). ` +
  `Lokasi ini dipakai untuk menentukan bengkel terdekat & biaya perjalanan.\n\n` +
  `_(Caranya: Tekan tombol lampiran '+' atau penjepit kertas di WhatsApp -> pilih Lokasi / Bagikan Lokasi Saat Ini)_`;

const MAPS_LINK_NOT_SUPPORTED =
  `🔗 Link Google Maps belum bisa kami baca otomatis, kak. Mohon kirim *Pin Lokasi WhatsApp* ya (tombol lampiran → Lokasi).`;

const SCHEDULE_EXAMPLES = `Contoh: *Senin jam 10*, *besok jam 2 siang*, atau *28/09 jam 13.00*.`;

const SCHEDULE_PROMPT =
  `🗓️ Kapan kakak ingin teknisi kami datang? Silakan balas dengan *hari/tanggal dan jam* kunjungan.\n` +
  `${SCHEDULE_EXAMPLES}\n\n` +
  `⏰ Jam Home Service: Senin–Sabtu, 09.00–20.00 WIB. _Jadwal final akan dikonfirmasi oleh admin._`;

const SCHEDULE_INVALID_REPLIES = {
  no_date: `Mohon sebutkan *hari atau tanggal* kunjungannya juga ya kak. ${SCHEDULE_EXAMPLES}`,
  no_time: `Mohon sebutkan *jam* kunjungannya juga ya kak. ${SCHEDULE_EXAMPLES}`,
  invalid_date: `Tanggal tersebut sepertinya tidak valid, kak. ${SCHEDULE_EXAMPLES}`,
  sunday: `Mohon maaf kak, Home Service *tutup di hari Minggu*. Silakan pilih hari Senin–Sabtu ya. ${SCHEDULE_EXAMPLES}`,
  outside_hours: `Mohon maaf kak, jam Home Service hanya *09.00–20.00 WIB*. Silakan pilih jam di rentang tersebut ya. ${SCHEDULE_EXAMPLES}`,
  past: `Waktu tersebut sudah lewat, kak. Silakan pilih hari & jam berikutnya ya. ${SCHEDULE_EXAMPLES}`,
  too_far: `Jadwal hanya bisa dipesan maksimal 90 hari ke depan, kak. Silakan pilih tanggal yang lebih dekat ya.`,
};

const PHONE_PROMPT =
  `📱 Terakhir, mohon kirimkan *nomor WhatsApp aktif* kakak (contoh: 081234567890) agar teknisi & admin dapat menghubungi kakak.`;

const DISPATCH_FAILED_REPLY =
  `🙏 Mohon maaf kak, pendaftaran belum berhasil kami simpan ke sistem karena kendala teknis.\n\n` +
  `Data kakak sudah kami teruskan ke admin, dan admin kami akan segera menghubungi kakak untuk melanjutkan reservasi. Terima kasih atas kesabarannya!`;

const DIAGNOSIS_UNAVAILABLE_REPLY =
  `🙏 Mohon maaf kak, sistem estimasi kami sedang mengalami kendala. Keluhan kakak sudah kami teruskan ke admin, ` +
  `dan admin kami akan segera membantu menjelaskan estimasi biayanya.`;

const CONFIRM_REMINDER =
  `Balas *YA* untuk lanjut pendaftaran Home Service, *TIDAK* jika belum perlu, atau ceritakan lebih detail kendalanya ya kak.`;

// "Estimasinya berapa?", "biayanya berapa kak" while the customer is looking at the estimate
// ("berapa lama / jam / hari / km" is about time or distance, not price)
const PRICE_QUESTION =
  /\b(estimasi\w*|biaya\w*|harga\w*|ongkos\w*|tarif\w*|kisaran|mahal|murah)\b|\bberapa\b(?!\s*(lama|jam|hari|menit|minggu|bulan|kali|km|kilo|jauh|orang|unit))/i;

const OTHER_QUESTION_NOTE =
  `Untuk pertanyaan tersebut, admin kami akan membantu menjawabnya saat menghubungi kakak untuk konfirmasi jadwal ya. 🙏`;

const CANCELLED_REPLY =
  `Baik kak, pendaftaran dibatalkan. 🙏 Jika sewaktu-waktu butuh bantuan servis, cukup ceritakan keluhannya kepada kami lagi ya.`;

/** "Charger_Motor Listrik Tidak bisa Mengisi" → "Charger – Motor Listrik Tidak bisa Mengisi" (no WA italics). */
function formatJenisName(nama) {
  return nama.replace(/_/g, ' – ').replace(/\s+/g, ' ').trim();
}

function formatEstimasi(biaya) {
  return biaya !== null && biaya !== undefined ? formatRupiah(biaya) : 'sesuai pengecekan';
}

/** Remove attachment markers so their digits/words are not mistaken for an answer. */
function stripMarkers(messageText) {
  return messageText
    .replace(/\[LOCATION:[^\]]*\]/gi, ' ')
    .split(registrationService.PHOTO_MARKER)
    .join(' ')
    .split(PHOTO_FAILED_MARKER)
    .join(' ')
    // Keep line breaks: forms ("- Atas nama: …\n- Alamat: …") are parsed line by line
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Short reply like "ya kak!", "Oke." → "ya" / "oke" for YES/NO matching. */
function normalizeShortAnswer(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(kak|kakak|min|mas|mbak|dong|deh|aja|saja)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First valid Indonesian mobile number in the text, in local format ("0812..."). */
function extractPhone(text) {
  const candidates = text.match(/(?:\+?62|0)8[\d\s-]{7,16}\d/g) || [];
  const valid = candidates.map((c) => c.replace(/[\s-]/g, '')).find((c) => isValidPhone(c));
  return valid ? toLocalPhone(valid) : null;
}

function buildDiagnosisMessage(diagnosis) {
  const { jenis, isDefault, geminiFailed } = diagnosis;
  const header = isDefault
    ? `🔍 Kendala kakak perlu dicek langsung oleh teknisi kami untuk memastikan penyebabnya.\n` +
      `📋 Layanan: *${formatJenisName(jenis.nama)}*\n`
    : `🔍 Dari keluhan kakak, jenis kerusakannya termasuk:\n*${formatJenisName(jenis.nama)}*\n`;

  return (
    header +
    `💰 Estimasi biaya: *${formatEstimasi(jenis.biaya_estimasi)}*\n` +
    `_Estimasi dapat berubah setelah pengecekan teknisi dan belum termasuk biaya perjalanan home service._` +
    (geminiFailed ? `\n_Estimasi ini akan dikonfirmasi ulang oleh admin kami._` : '') +
    `\n\nApakah kakak ingin kami jadwalkan *Home Service* (teknisi datang ke rumah)?\n` +
    `• Balas *YA* untuk lanjut pendaftaran\n` +
    `• Balas *TIDAK* jika belum perlu\n` +
    `• Atau ceritakan lebih detail jika jenis kerusakan di atas kurang sesuai`
  );
}

/** Answer "berapa estimasinya?" strictly from the jenis kerusakan data (never an invented number). */
function buildPriceAnswer(diagnosis) {
  const { jenis } = diagnosis;
  const name = formatJenisName(jenis.nama);
  if (jenis.biaya_estimasi === null || jenis.biaya_estimasi === undefined) {
    return (
      `💰 Untuk *${name}*, biayanya belum bisa kami pastikan sekarang karena penyebab kerusakannya perlu diperiksa langsung oleh teknisi. ` +
      `Rincian biaya akan diinformasikan setelah pengecekan.\n\n` +
      `Jika kakak bisa ceritakan gejalanya lebih detail (mis. lampu indikator menyala atau tidak, ada bunyi, kondisi baterai/charger), ` +
      `kami bisa bantu memberi estimasi yang lebih tepat.`
    );
  }
  return (
    `💰 Estimasi biaya untuk *${name}* adalah *${formatRupiah(jenis.biaya_estimasi)}*.\n` +
    `_Estimasi dapat berubah setelah pengecekan teknisi. Untuk Home Service ada tambahan biaya perjalanan yang dihitung dari jarak lokasi kakak ke bengkel terdekat._`
  );
}

function buildDeclinedMessage() {
  return (
    `Baik kak, terima kasih. 🙏 Jika sewaktu-waktu ingin servis, cukup chat kami lagi ya.\n\n` +
    `Kakak juga bisa langsung datang ke bengkel kami:\n` +
    `📍 ${OPERATIONAL_DATA.store1.address}\n` +
    `📍 ${OPERATIONAL_DATA.store2.address}\n` +
    `⏰ Senin–Sabtu, 09.00–17.00 WIB`
  );
}

function buildSuccessMessage(regData, result) {
  const jarak = result.jarak_km !== undefined && result.jarak_km !== null ? ` (± ${result.jarak_km} km)` : '';
  return (
    `✅ *Reservasi Home Service berhasil dibuat!*\n\n` +
    `🧾 No. Resi: *${result.no_resi}*\n\n` +
    `• Atas nama: ${regData.nama}\n` +
    `• Alamat: ${regData.alamat}\n` +
    `• Jenis Kerusakan: ${formatJenisName(regData.diagnosis.jenis.nama)}\n` +
    `• Estimasi Biaya Servis: ${formatEstimasi(regData.diagnosis.jenis.biaya_estimasi)}\n` +
    `• Biaya Perjalanan: ${formatRupiah(result.biaya_perjalanan)}${jarak}\n` +
    `• Jadwal yang diminta: ${regData.jadwal.label}\n\n` +
    `Status: *${result.status_label || 'Menunggu Konfirmasi'}*. Admin kami akan menghubungi kakak untuk konfirmasi jadwal — ` +
    `jika teknisi berhalangan di waktu tersebut, admin akan menawarkan jadwal pengganti. 🙏\n\n` +
    `_Simpan nomor resi ini untuk mengecek status servis ya kak._`
  );
}

/** Plain-text summary for admin alerts (API failure / unresolved diagnosis). */
function buildAdminSummary(regData, headline) {
  return [
    headline,
    regData.nama ? `Nama: ${regData.nama}` : null,
    `No. WA: ${regData.contactPhone || regData.phoneNumber}`,
    regData.alamat ? `Alamat: ${regData.alamat}` : null,
    regData.location ? `Lokasi: ${regData.location.latitude}, ${regData.location.longitude}` : null,
    regData.diagnosis ? `Jenis kerusakan: ${regData.diagnosis.jenis.nama} (id ${regData.diagnosis.jenis.id})` : null,
    `Keluhan: ${regData.complaint || '-'}`,
    regData.jadwal ? `Jadwal diminta: ${regData.jadwal.label}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
}

/** Hand the conversation to the admin (bot goes silent for 24h) and send a throttled email alert. */
async function escalateToAdmin(phoneNumber, reason, summary) {
  await conversationService.resetState(phoneNumber);
  await conversationService.setAdminHandled(phoneNumber, { reason, lastMessage: summary });
  alertService
    .sendEscalationAlert({ phoneNumber, incomingMessage: summary, escalationReason: reason, matchedLayer: 'SERVICE_REGISTRATION' })
    .catch((err) => logger.error({ err }, 'Background escalation alert error'));
}

async function clearDraft(phoneNumber, regData) {
  if (regData?.photoPath) await mediaService.deleteFile(regData.photoPath);
  await registrationService.clearRegistration(phoneNumber);
  await conversationService.resetState(phoneNumber);
}

async function saveAndAsk(phoneNumber, regData, nextState, parts, layer = 'SERVICE_REGISTRATION_STEP') {
  await registrationService.saveRegistration(phoneNumber, regData);
  await conversationService.setState(phoneNumber, nextState);
  return { reply: parts.filter(Boolean).join('\n\n'), layer };
}

/** Contact number for the website: sender's WhatsApp number when known, else one typed by the customer. */
function applyContactPhone(regData, phoneNumber, phoneResolved) {
  if (phoneResolved) {
    regData.contactPhone = toLocalPhone(phoneNumber);
  } else if (!regData.contactPhone) {
    regData.contactPhone = extractPhone(regData.noWhatsapp || '') || null;
  }
}

/**
 * Store a photo / pin location from the message into the draft (allowed at any step).
 * @returns {string[]} acknowledgement notes for the customer
 */
async function absorbAttachments(regData, messageText, mediaPaths, { quiet = false } = {}) {
  const notes = [];

  if (registrationService.hasPhotoAttachment(messageText) && mediaPaths.length > 0) {
    const newPhoto = mediaPaths[mediaPaths.length - 1];
    const hadPhoto = !!regData.photoPath;
    if (regData.photoPath && regData.photoPath !== newPhoto) await mediaService.deleteFile(regData.photoPath);
    regData.photoPath = newPhoto;
    if (!quiet && !hadPhoto) notes.push(`Foto unit sudah kami terima! 📸✅`);
  } else if (messageText.includes(PHOTO_FAILED_MARKER) && !regData.photoPath) {
    notes.push(`⚠️ Foto belum berhasil kami terima, kak. Mohon kirim ulang fotonya ya.`);
  }

  const location = registrationService.parseLocationMessage(messageText);
  if (location && location.latitude !== null && location.longitude !== null) {
    const hadLocation = !!regData.location;
    regData.location = location;
    if (!quiet && !hadLocation) notes.push(`Lokasi Anda sudah kami terima! 📍✅`);
  } else if (location) {
    notes.push(MAPS_LINK_NOT_SUPPORTED);
  }

  return notes;
}

/**
 * Run the diagnosis on the accumulated complaint and move the conversation to the next step.
 * @returns {Promise<object|null>} flow result, or null when the text is not a complaint
 */
// AI intent → fixed template, for short social messages the keyword rules did not recognize
// (typos etc.). The AI only picks the category; the text is always one of our templates.
const SMALL_TALK_BY_INTENT = {
  terima_kasih: { subIntent: 'SMALL_TALK_THANKS', reply: SMALL_TALK_REPLIES.thanks },
  konfirmasi: { subIntent: 'SMALL_TALK_ACK', reply: SMALL_TALK_REPLIES.ack },
  penutup: { subIntent: 'SMALL_TALK_BYE', reply: SMALL_TALK_REPLIES.bye },
  sapaan: { subIntent: 'GREETING', reply: GREETING_REPLY, invitesComplaint: true },
};

async function runDiagnosis(phoneNumber, regData, notes, { expectComplaint, answerSmallTalk = false }) {
  const diag = await diagnosisService.diagnoseComplaint({
    complaint: regData.complaint,
    vehicle: regData.vehicle || null,
    expectComplaint,
  });

  if (diag.status === 'not_complaint') {
    const smallTalk = answerSmallTalk ? SMALL_TALK_BY_INTENT[diag.intent] : null;
    return smallTalk ? { layer: 'LAYER_B_AI', ...smallTalk } : null;
  }

  if (diag.status === 'unavailable') {
    await escalateToAdmin(phoneNumber, diag.reason, buildAdminSummary(regData, `Estimasi tidak tersedia (${diag.reason})`));
    return { reply: DIAGNOSIS_UNAVAILABLE_REPLY, layer: 'DIAGNOSIS_UNAVAILABLE', isEscalated: true, escalationReason: diag.reason };
  }

  if (diag.status === 'need_vehicle') {
    regData.aiSummary = diag.summary;
    return saveAndAsk(phoneNumber, regData, REG_STATE.VEHICLE, [...notes, VEHICLE_PROMPT], 'DIAGNOSIS_NEED_VEHICLE');
  }

  regData.vehicle = diag.vehicle || regData.vehicle || null;
  regData.aiSummary = diag.summary || regData.aiSummary || '';
  regData.diagnosis = {
    jenis: diag.jenis,
    isDefault: diag.status === 'default',
    geminiFailed: !!diag.geminiFailed,
  };
  return saveAndAsk(
    phoneNumber,
    regData,
    REG_STATE.DIAGNOSIS_CONFIRM,
    [...notes, buildDiagnosisMessage(regData.diagnosis)],
    diag.status === 'default' ? 'DIAGNOSIS_DEFAULT' : 'DIAGNOSIS_MATCHED'
  );
}

/**
 * Entry point for a message that may be a complaint (called by the handler when no rule matched).
 * @param {{ mediaPaths?: string[], phoneResolved?: boolean }} context
 * @param {{ expectComplaint?: boolean }} options - the bot explicitly asked for a complaint
 * @returns {Promise<object|null>} null = not a complaint
 */
async function startDiagnosis(phoneNumber, messageText, context = {}, { expectComplaint = false } = {}) {
  const { mediaPaths = [], phoneResolved = true } = context;
  const complaint = stripMarkers(messageText);
  if (!complaint) return null;

  // Keep nama/alamat if the customer already sent them (e.g. a form without a complaint)
  const existing = await registrationService.getRegistration(phoneNumber);
  const regData = { ...(existing || {}), phoneNumber, complaint, diagnosisAttempts: 1, diagnosis: null };
  applyContactPhone(regData, phoneNumber, phoneResolved);
  const notes = await absorbAttachments(regData, messageText, mediaPaths, { quiet: true });

  return runDiagnosis(phoneNumber, regData, notes, { expectComplaint, answerSmallTalk: true });
}

/** Decide the next data-collection step after the diagnosis was accepted. */
async function continueRegistration(phoneNumber, regData, notes, stepHint = null, currentState = null) {
  let nextState;
  let prompt;

  if (!regData.nama || !regData.alamat) {
    nextState = REG_STATE.FORM;
    prompt = currentState === REG_STATE.FORM && stepHint ? stepHint : FORM_PROMPT;
  } else if (!regData.photoPath) {
    nextState = REG_STATE.PHOTO;
    prompt = PHOTO_PROMPT;
  } else if (!regData.location) {
    nextState = REG_STATE.LOCATION;
    prompt = LOCATION_PROMPT;
  } else if (!regData.jadwal) {
    nextState = REG_STATE.SCHEDULE;
    prompt = (currentState === REG_STATE.SCHEDULE && stepHint) || SCHEDULE_PROMPT;
  } else if (!regData.contactPhone) {
    nextState = REG_STATE.PHONE;
    prompt = (currentState === REG_STATE.PHONE && stepHint) || PHONE_PROMPT;
  } else if (!(await mediaService.fileExists(regData.photoPath))) {
    // Photo file was cleaned up (draft older than the media TTL) — ask again
    regData.photoPath = null;
    nextState = REG_STATE.PHOTO;
    prompt = PHOTO_PROMPT;
  }

  if (nextState) return saveAndAsk(phoneNumber, regData, nextState, [...notes, prompt]);

  const result = await dispatchReservation(phoneNumber, regData);
  if (notes.length > 0 && result.layer === 'SERVICE_REGISTRATION_COMPLETE') {
    result.reply = [...notes, result.reply].join('\n\n');
  }
  return result;
}

/**
 * Create the reservation on the website. On failure the customer is told honestly and the
 * conversation is handed to the admin (with an email alert containing all collected data).
 */
async function dispatchReservation(phoneNumber, regData) {
  try {
    const payload = registrationService.buildHomeServicePayload(regData);
    const result = await websiteService.createHomeService(payload, regData.photoPath);

    logger.info({ phoneNumber, noResi: result?.no_resi }, 'Home service reservation created on website');
    await clearDraft(phoneNumber, regData);
    return { reply: buildSuccessMessage(regData, result || {}), layer: 'SERVICE_REGISTRATION_COMPLETE' };
  } catch (err) {
    logger.error({ err: err.message, status: err.status, errors: err.body?.errors, phoneNumber }, 'Failed to create home service reservation');
    const headline =
      `GAGAL membuat reservasi via API: ${err.message}` +
      (err.body?.errors ? ` | Detail validasi: ${JSON.stringify(err.body.errors)}` : '');
    // Draft & photo are kept (until TTL) for troubleshooting; the admin takes over the chat
    await escalateToAdmin(phoneNumber, 'reservation_api_failed', buildAdminSummary(regData, headline));
    return { reply: DISPATCH_FAILED_REPLY, layer: 'SERVICE_REGISTRATION_FAILED', isEscalated: true, escalationReason: 'reservation_api_failed' };
  }
}

/**
 * Handle a message that belongs to an active booking flow (or is a registration form).
 * @param {string} phoneNumber
 * @param {string} messageText - aggregated message text (may include [FOTO_UNIT] / [LOCATION: ...] markers)
 * @param {string|undefined} currentState - conversation state from Redis
 * @param {{ mediaPaths?: string[], phoneResolved?: boolean }} [context]
 * @returns {Promise<{ reply: string, layer: string, isEscalated?: boolean, escalationReason?: string } | null>}
 *   null = not part of the flow → the handler continues with the normal pipeline
 */
async function handleRegistrationFlow(phoneNumber, messageText, currentState, context = {}) {
  const { mediaPaths = [], phoneResolved = true } = context;
  const inFlow = Object.values(REG_STATE).includes(currentState);
  const isForm = registrationService.isRegistrationForm(messageText);
  const answer = stripMarkers(messageText);
  const shortAnswer = normalizeShortAnswer(answer);

  // A registration form sent outside the flow: use its "Kendala" as the complaint
  if (!inFlow) {
    if (!isForm) return null;
    const form = registrationService.parseRegistrationForm(messageText);
    const base = { ...form, phoneNumber };
    if (!form.kendala) {
      // No complaint yet — keep nama/alamat and ask for it
      await registrationService.saveRegistration(phoneNumber, base);
      await conversationService.setState(phoneNumber, AWAITING_COMPLAINT);
      return { reply: `Terima kasih kak, datanya sudah kami catat. 🙏\n\n${COMPLAINT_INVITE}`, layer: 'SERVICE_REGISTRATION_STEP' };
    }
    await registrationService.saveRegistration(phoneNumber, base);
    return startDiagnosis(phoneNumber, form.kendala + (messageText.includes(registrationService.PHOTO_MARKER) ? `\n${registrationService.PHOTO_MARKER}` : ''), context, { expectComplaint: true });
  }

  const regData = await registrationService.getRegistration(phoneNumber);
  if (!regData) {
    // Draft expired (2h) while the conversation state lived on → leave the flow gracefully
    await conversationService.resetState(phoneNumber);
    return null;
  }

  if (CANCEL_ANSWERS.includes(shortAnswer)) {
    await clearDraft(phoneNumber, regData);
    return { reply: CANCELLED_REPLY, layer: 'SERVICE_REGISTRATION_CANCELLED' };
  }

  applyContactPhone(regData, phoneNumber, phoneResolved);
  const notes = await absorbAttachments(regData, messageText, mediaPaths);

  // ── Diagnosis phase ──
  if (currentState === REG_STATE.VEHICLE) {
    const vehicle = diagnosisService.detectVehicle(answer);
    if (!vehicle) return saveAndAsk(phoneNumber, regData, REG_STATE.VEHICLE, [...notes, VEHICLE_PROMPT], 'DIAGNOSIS_NEED_VEHICLE');
    regData.vehicle = vehicle;
    return (await runDiagnosis(phoneNumber, regData, notes, { expectComplaint: true })) || saveAndAsk(phoneNumber, regData, REG_STATE.VEHICLE, [VEHICLE_PROMPT]);
  }

  if (currentState === REG_STATE.DIAGNOSIS_CONFIRM) {
    if (YES_ANSWERS.includes(shortAnswer)) {
      return continueRegistration(phoneNumber, regData, notes);
    }
    if (NO_ANSWERS.includes(shortAnswer)) {
      await clearDraft(phoneNumber, regData);
      return { reply: buildDeclinedMessage(), layer: 'DIAGNOSIS_DECLINED' };
    }
    if (!answer || detectSmallTalk(answer)) {
      // Only a photo/location, or "makasih" etc. — remind the pending question
      return saveAndAsk(phoneNumber, regData, REG_STATE.DIAGNOSIS_CONFIRM, [...notes, CONFIRM_REMINDER]);
    }

    // "Estimasinya berapa?" — answer from the DB value instead of re-diagnosing
    if (PRICE_QUESTION.test(answer) && !looksLikeVehicleComplaint(answer)) {
      return saveAndAsk(phoneNumber, regData, REG_STATE.DIAGNOSIS_CONFIRM, [...notes, buildPriceAnswer(regData.diagnosis), CONFIRM_REMINDER], 'DIAGNOSIS_PRICE_QUESTION');
    }

    // Anything else = more detail about the problem → diagnose again with the full story
    if ((regData.diagnosisAttempts || 1) + 1 > MAX_DIAGNOSIS_ATTEMPTS) {
      await escalateToAdmin(phoneNumber, 'diagnosis_unresolved', buildAdminSummary(regData, 'Jenis kerusakan belum sesuai setelah beberapa kali penjelasan'));
      return {
        reply: `Terima kasih penjelasannya kak 🙏 Agar estimasinya tepat, keluhan kakak kami teruskan ke admin/teknisi kami untuk dibantu langsung. Mohon ditunggu ya.`,
        layer: 'DIAGNOSIS_UNRESOLVED',
        isEscalated: true,
        escalationReason: 'diagnosis_unresolved',
      };
    }
    const previousComplaint = regData.complaint;
    const previousJenisId = regData.diagnosis?.jenis?.id;
    regData.diagnosisAttempts = (regData.diagnosisAttempts || 1) + 1;
    regData.complaint = `${previousComplaint}\n${answer}`;
    regData.vehicle = regData.vehicle || diagnosisService.detectVehicle(answer);

    // Not about the problem at all (e.g. "berapa lama pengerjaannya?") — the bot has no data to answer it
    const diagnosisOnly = await diagnosisService.diagnoseComplaint({ complaint: answer, vehicle: regData.vehicle, expectComplaint: false });
    if (diagnosisOnly.status === 'not_complaint') {
      regData.complaint = previousComplaint;
      regData.diagnosisAttempts -= 1;
      return saveAndAsk(phoneNumber, regData, REG_STATE.DIAGNOSIS_CONFIRM, [...notes, OTHER_QUESTION_NOTE, CONFIRM_REMINDER]);
    }

    const result = await runDiagnosis(phoneNumber, regData, notes, { expectComplaint: true });
    if (!result) {
      return saveAndAsk(phoneNumber, regData, REG_STATE.DIAGNOSIS_CONFIRM, [...notes, CONFIRM_REMINDER]);
    }
    // Same jenis as before → short confirmation instead of repeating the whole block
    if (regData.diagnosis?.jenis?.id === previousJenisId && ['DIAGNOSIS_MATCHED', 'DIAGNOSIS_DEFAULT'].includes(result.layer)) {
      result.reply = [
        ...notes,
        `Terima kasih penjelasannya kak 🙏 Jenis kerusakannya tetap *${formatJenisName(regData.diagnosis.jenis.nama)}* ` +
          `dengan estimasi biaya *${formatEstimasi(regData.diagnosis.jenis.biaya_estimasi)}*.`,
        CONFIRM_REMINDER,
      ].join('\n\n');
    }
    return result;
  }

  // ── Data collection phase ──
  let stepHint = null;

  if (currentState === REG_STATE.FORM && answer) {
    const form = registrationService.parseRegistrationForm(answer);
    if (form.nama) regData.nama = form.nama;
    if (form.alamat) regData.alamat = form.alamat;
    if (form.kendaraan) regData.kendaraan = form.kendaraan;
    if (form.noWhatsapp) regData.noWhatsapp = form.noWhatsapp;
    if (form.rencanaJadwal) regData.rencanaJadwal = form.rencanaJadwal;
    applyContactPhone(regData, phoneNumber, phoneResolved);
    if (!regData.nama || !regData.alamat) {
      stepHint = `Mohon lengkapi ${!regData.nama ? '*Atas nama*' : ''}${!regData.nama && !regData.alamat ? ' dan ' : ''}${!regData.alamat ? '*Alamat*' : ''} dengan format berikut ya kak:\n\n- Atas nama:\n- Alamat:`;
    }
  }

  if (currentState === REG_STATE.SCHEDULE && !regData.jadwal && answer) {
    const schedule = parseSchedule(answer);
    if (schedule.status === 'ok') {
      regData.jadwal = { ...schedule, raw: answer };
      notes.push(`🗓️ Jadwal kunjungan yang diminta: *${schedule.label}*`);
    } else {
      stepHint = SCHEDULE_INVALID_REPLIES[schedule.reason];
    }
  }

  if (currentState === REG_STATE.PHONE && !regData.contactPhone && answer) {
    regData.contactPhone = extractPhone(answer);
    if (!regData.contactPhone) {
      stepHint = `Nomor tersebut sepertinya belum valid, kak. Mohon kirim nomor WhatsApp dengan format *08xxxxxxxxxx* ya.`;
    }
  }

  // Schedule typed in the form ("Rencana Hari & Jam Kunjungan: Senin jam 10") — try it once
  if (!regData.jadwal && regData.rencanaJadwal && !regData.rencanaJadwalChecked) {
    regData.rencanaJadwalChecked = true;
    const schedule = parseSchedule(regData.rencanaJadwal);
    if (schedule.status === 'ok') regData.jadwal = { ...schedule, raw: regData.rencanaJadwal };
  }

  return continueRegistration(phoneNumber, regData, notes, stepHint, currentState);
}

module.exports = {
  REG_STATE,
  AWAITING_COMPLAINT,
  handleRegistrationFlow,
  startDiagnosis,
  buildDiagnosisMessage,
  formatJenisName,
  extractPhone,
};
