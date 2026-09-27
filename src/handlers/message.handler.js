const conversationService = require('../services/conversation.service');
const matcherService = require('../services/matcher.service');
const registrationService = require('../services/registration.service');
const auditService = require('../services/audit.service');
const alertService = require('../services/alert.service');
const logger = require('../utils/logger');

// Set for in-memory message deduplication within short window
const processedMessageIds = new Set();

/**
 * Main message handler for Selis Molis Hoki Chatbot
 * Implements PRD Bagian 5 & Alur Pendaftaran Servis / Home Service
 * 
 * @param {string} phoneNumber - Normalized customer phone number
 * @param {string} messageText - The message content
 * @param {string} [waMessageId] - WhatsApp message ID for deduplication
 * @returns {Promise<string|null>} Reply message to send back, or null if silent
 */
async function handleMessage(phoneNumber, messageText, waMessageId) {
  try {
    // 1. Deduplication check
    if (waMessageId) {
      if (processedMessageIds.has(waMessageId)) {
        logger.debug({ waMessageId, phoneNumber }, 'Duplicate message detected, skipping');
        return null;
      }
      processedMessageIds.add(waMessageId);
      // Clean up set memory periodically
      if (processedMessageIds.size > 5000) {
        processedMessageIds.clear();
      }
    }

    logger.info({ phoneNumber, messageText }, 'Processing incoming customer message');

    // 2. Check conversation state in Redis
    // If status = "admin-handled" & within 24h reset window -> Bot is SILENT (PRD Bagian 5)
    const isAdminHandled = await conversationService.isAdminHandled(phoneNumber);
    if (isAdminHandled) {
      const info = await conversationService.getAdminHandledInfo(phoneNumber);
      logger.info(
        {
          phoneNumber,
          reason: info?.reason,
          remainingTtl: info?.remainingTtlSeconds,
        },
        'Conversation is in admin-handled state -> Bot remaining silent'
      );

      // Still record to audit log so admin knows customer sent a message during admin-handled
      await auditService.logChatInteraction({
        phoneNumber,
        incomingMessage: messageText,
        matchedLayer: 'ADMIN_HANDLED_SILENT',
        matchedItemId: null,
        rawScore: 0,
        thresholdUsed: parseInt(process.env.MATCHER_THRESHOLD, 10) || 2,
        replyMessage: null,
        isEscalated: true,
        escalationReason: info?.reason || 'already_admin_handled',
      });

      return null; // Do not send any automatic message
    }

    // 3. Check Multi-step Service Registration State (Form -> Photo -> Share Location)
    const convState = await conversationService.getState(phoneNumber);
    const currentState = convState?.state;

    // 3.1 If waiting for Share Location
    if (currentState === 'AWAITING_LOCATION') {
      const loc = registrationService.parseLocationMessage(messageText);
      if (loc) {
        const regData = (await registrationService.getRegistration(phoneNumber)) || {};
        regData.location = loc;
        regData.phoneNumber = phoneNumber;

        // Double check: if photo is still missing, prompt for photo first
        if (!regData.hasPhoto) {
          await registrationService.saveRegistration(phoneNumber, regData);
          await conversationService.setState(phoneNumber, 'AWAITING_PHOTO');
          return (
            `📍 Lokasi Anda sudah kami terima!\n\n` +
            `📸 Namun foto unit kendaraan belum terlampir. Silakan kirimkan foto fisik unit motor/sepeda listrik Anda terlebih dahulu ya kak agar teknisi kami dapat memeriksa kondisinya.`
          );
        }

        // All data complete: build API request body payload ready for endpoint dispatch
        const apiPayload = registrationService.buildApiRequestBody(regData);
        await registrationService.dispatchRegistrationToEndpoint(apiPayload);

        // Clear active session
        await registrationService.clearRegistration(phoneNumber);
        await conversationService.resetState(phoneNumber);

        await auditService.logChatInteraction({
          phoneNumber,
          incomingMessage: messageText,
          matchedLayer: 'SERVICE_REGISTRATION_COMPLETE',
          matchedItemId: null,
          rawScore: 100,
          thresholdUsed: 0,
          replyMessage: 'REGISTRATION_SUCCESS',
          isEscalated: false,
          escalationReason: null,
        });

        return (
          `Terima kasih kak! Seluruh data pendaftaran dan lokasi Anda telah lengkap tercatat di sistem Selis Molis Hoki. ✅\n\n` +
          `📋 *Detail Pendaftaran:*\n` +
          `• Atas nama: ${regData.nama}\n` +
          `• Alamat: ${regData.alamat}\n` +
          `• Kendala: ${regData.kendala}\n` +
          `• Foto Unit: Terlampir 📸\n` +
          `• Lokasi: Terkonfirmasi 📍\n\n` +
          `Tim admin & teknisi kami akan segera memverifikasi data dan menghubungi kakak kembali untuk konfirmasi jadwal. Mohon ditunggu ya kak! 🙏`
        );
      }

      // If user sent a new registration form instead, allow overwrite
      if (registrationService.isRegistrationForm(messageText)) {
        // Fall through to 3.3 form processing
      } else {
        return (
          `📍 Silakan kirimkan *Share Lokasi (Pin Lokasi WhatsApp)* Anda terlebih dahulu ya kak agar teknisi kami dapat menentukan rute dan estimasi kedatangan ke lokasi Anda.\n\n` +
          `_(Caranya: Tekan tombol lampiran '+' atau penjepit kertas di WhatsApp -> pilih Lokasi / Bagikan Lokasi Saat Ini)_`
        );
      }
    }

    // 3.2 If waiting for Photo
    if (currentState === 'AWAITING_PHOTO') {
      const hasPhotoInMessage = messageText.includes('[FOTO_UNIT]') || messageText.toLowerCase().includes('foto');
      if (hasPhotoInMessage) {
        const regData = (await registrationService.getRegistration(phoneNumber)) || {};
        regData.hasPhoto = true;
        regData.fotoUnit = '[FOTO_UNIT TERLAMPIR]';
        regData.phoneNumber = phoneNumber;

        await registrationService.saveRegistration(phoneNumber, regData);
        await conversationService.setState(phoneNumber, 'AWAITING_LOCATION');

        return (
          `Terima kasih kak, foto unit sudah kami terima! 📸✅\n\n` +
          `📍 Terakhir, silakan kirimkan *Share Lokasi (Pin Lokasi WhatsApp)* Anda agar memudahkan teknisi kami menentukan rute dan estimasi kedatangan.`
        );
      }

      // If user sent a new registration form instead, allow overwrite
      if (registrationService.isRegistrationForm(messageText)) {
        // Fall through to 3.3 form processing
      } else {
        return (
          `📸 Mohon kirimkan foto fisik unit motor/sepeda listrik Anda terlebih dahulu ya kak (cukup foto kendaraannya langsung via WhatsApp) agar teknisi kami dapat memeriksa tipe & kondisi unit.`
        );
      }
    }

    // 3.3 Check if incoming message is a Service Registration Form
    if (registrationService.isRegistrationForm(messageText)) {
      const formData = registrationService.parseRegistrationForm(messageText);

      // Validate required basic fields
      if (!formData.nama || !formData.alamat || !formData.kendala) {
        return (
          `Mohon lengkapi data pendaftaran Anda ya kak. Format yang diperlukan:\n\n` +
          `- Atas nama: (Nama Anda)\n` +
          `- Alamat: (Alamat lengkap & patokan)\n` +
          `- Foto unit: (Kirim foto unit kendaraan)\n` +
          `- Kendala: (Deskripsi masalah kendaraan)\n\n` +
          `Silakan salin dan isi kembali format di atas ya kak. Terima kasih! 🙏`
        );
      }

      formData.phoneNumber = phoneNumber;
      await registrationService.saveRegistration(phoneNumber, formData);

      // Check if photo is attached
      if (!formData.hasPhoto) {
        await conversationService.setState(phoneNumber, 'AWAITING_PHOTO');
        return (
          `Terima kasih datanya sudah kami catat kak: 🙏\n\n` +
          `• Atas nama: ${formData.nama}\n` +
          `• Alamat: ${formData.alamat}\n` +
          `• Kendala: ${formData.kendala}\n\n` +
          `📸 *Langkah Selanjutnya:* Silakan kirimkan *foto unit kendaraan* Anda terlebih dahulu ya kak agar teknisi kami dapat melihat kondisi fisik kendaraan.`
        );
      }

      // Photo is already attached (e.g. caption on image)
      await conversationService.setState(phoneNumber, 'AWAITING_LOCATION');
      return (
        `Terima kasih datanya sudah lengkap kami catat kak: 🙏\n\n` +
        `• Atas nama: ${formData.nama}\n` +
        `• Alamat: ${formData.alamat}\n` +
        `• Foto unit: ${formData.fotoUnit || 'Terlampir'} 📸\n` +
        `• Kendala: ${formData.kendala}\n\n` +
        `📍 *Langkah Terakhir:* Silakan kirimkan *Share Lokasi (Pin Lokasi WhatsApp)* Anda agar memudahkan teknisi kami menentukan rute dan estimasi kedatangan.`
      );
    }

    // 4. Process Intent & Keyword Matcher (Layer C -> Layer B -> Layer A -> Layer D)
    const matchResult = await matcherService.matchIntent(messageText);

    // 5. Handle Escalation (Layer C Jual-Beli Non-Harga or Layer D Fallback)
    if (matchResult.isEscalated) {
      logger.warn(
        {
          phoneNumber,
          layer: matchResult.layer,
          reason: matchResult.escalationReason,
        },
        'Escalating message to admin'
      );

      // Set status in Redis: "admin-handled" with 24-hour TTL (PRD Bagian 5 & 7.4)
      await conversationService.setAdminHandled(phoneNumber, {
        reason: matchResult.escalationReason,
        lastMessage: messageText,
      });

      // Trigger throttled email notification to admin in background (PRD 7.4)
      alertService
        .sendEscalationAlert({
          phoneNumber,
          incomingMessage: messageText,
          escalationReason: matchResult.escalationReason,
          matchedLayer: matchResult.layer,
        })
        .catch((err) => logger.error({ err }, 'Background escalation alert error'));

      // Log escalation to MySQL for audit & threshold tuning
      await auditService.logChatInteraction({
        phoneNumber,
        incomingMessage: messageText,
        matchedLayer: matchResult.layer,
        matchedItemId: matchResult.item ? matchResult.item.id : null,
        rawScore: matchResult.score || 0,
        thresholdUsed: matchResult.threshold,
        replyMessage: matchResult.reply,
        isEscalated: true,
        escalationReason: matchResult.escalationReason,
      });

      // Send 1x polite notification that admin will follow up manually
      return matchResult.reply;
    }

    // 6. Handle Direct Match (Layer A Service & Price, or Layer B Operational Info)
    logger.info(
      {
        phoneNumber,
        layer: matchResult.layer,
        item: matchResult.item?.name,
      },
      'Bot successfully generated direct response'
    );

    // If customer asked about service or complaints, set state to AWAITING_SERVICE_FORM
    if (
      matchResult.layer === 'LAYER_A' ||
      matchResult.subIntent === 'VEHICLE_COMPLAINT_INTENT' ||
      matchResult.subIntent === 'SERVICE_MENU_GUIDANCE' ||
      matchResult.subIntent === 'HOME_SERVICE_GENERAL'
    ) {
      await conversationService.setState(phoneNumber, 'AWAITING_SERVICE_FORM');
    }

    // Log successful match to MySQL for audit
    await auditService.logChatInteraction({
      phoneNumber,
      incomingMessage: messageText,
      matchedLayer: matchResult.layer,
      matchedItemId: matchResult.item ? matchResult.item.id : null,
      rawScore: matchResult.score || 0,
      thresholdUsed: matchResult.threshold,
      replyMessage: matchResult.reply,
      isEscalated: false,
      escalationReason: null,
    });

    return matchResult.reply;
  } catch (err) {
    logger.error({ err, phoneNumber }, 'Unexpected error in handleMessage');
    return '⚠️ Maaf, terjadi sedikit kendala pada sistem kami. Pertanyaan Anda akan segera dicek oleh tim admin. Terima kasih! 🙏';
  }
}

module.exports = {
  handleMessage,
};
