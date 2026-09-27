const conversationService = require('../services/conversation.service');
const matcherService = require('../services/matcher.service');
const registrationFlow = require('../services/registrationFlow.service');
const auditService = require('../services/audit.service');
const alertService = require('../services/alert.service');
const { COMPLAINT_INVITE } = require('../matchers/operationalMatcher');
const logger = require('../utils/logger');

// Set for in-memory message deduplication within short window
const processedMessageIds = new Set();

/**
 * Main message handler for Selis Molis Hoki Chatbot
 * Pipeline (PRD v1.2): admin-handled → booking flow → Layer C/B → diagnosis keluhan (Gemini)
 * → service inquiry → Layer D fallback
 * 
 * @param {string} phoneNumber - Normalized customer phone number
 * @param {string} messageText - The message content
 * @param {string} [waMessageId] - WhatsApp message ID for deduplication
 * @param {{ mediaPaths?: string[], phoneResolved?: boolean }} [context] - downloaded images & whether
 *   phoneNumber is a real number (false = unresolved WhatsApp LID)
 * @returns {Promise<string|null>} Reply message to send back, or null if silent
 */
async function handleMessage(phoneNumber, messageText, waMessageId, context = {}) {
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
        thresholdUsed: 0,
        replyMessage: null,
        isEscalated: true,
        escalationReason: info?.reason || 'already_admin_handled',
      });

      return null; // Do not send any automatic message
    }

    const convState = await conversationService.getState(phoneNumber);
    const currentState = convState?.state;

    // 3. Active booking flow (diagnosis confirmation, form, foto, lokasi, jadwal, …) or a registration form
    const flowResult = await registrationFlow.handleRegistrationFlow(phoneNumber, messageText, currentState, context);
    if (flowResult) return respond(phoneNumber, messageText, flowResult);

    // 4. Rule-based: Layer C (jual-beli → admin) and Layer B info (sapaan, lokasi, jam, …)
    const ruleResult = matcherService.matchRules(messageText);
    if (ruleResult?.isEscalated) return escalate(phoneNumber, messageText, ruleResult);
    if (ruleResult) {
      if (ruleResult.invitesComplaint) {
        await conversationService.setState(phoneNumber, registrationFlow.AWAITING_COMPLAINT);
      }
      return respond(phoneNumber, messageText, ruleResult);
    }

    // 5. Complaint diagnosis: Gemini maps the complaint to a website jenis kerusakan → estimasi
    const expectComplaint = currentState === registrationFlow.AWAITING_COMPLAINT;
    const diagnosisResult = await registrationFlow.startDiagnosis(phoneNumber, messageText, context, { expectComplaint });
    if (diagnosisResult) {
      if (diagnosisResult.invitesComplaint) {
        await conversationService.setState(phoneNumber, registrationFlow.AWAITING_COMPLAINT);
      }
      return respond(phoneNumber, messageText, diagnosisResult);
    }

    // 6. Service inquiry without a complaint (mau servis / home service / harga) → ask for the complaint
    const serviceResult = matcherService.matchServiceIntent(messageText);
    if (serviceResult) {
      await conversationService.setState(phoneNumber, registrationFlow.AWAITING_COMPLAINT);
      return respond(phoneNumber, messageText, serviceResult);
    }

    // 6b. We asked for a complaint but did not get one → ask once more before escalating
    if (expectComplaint) {
      await conversationService.resetState(phoneNumber);
      return respond(phoneNumber, messageText, {
        layer: 'LAYER_B',
        subIntent: 'COMPLAINT_REINVITE',
        reply: `Mohon maaf kak, kami belum menangkap keluhan kendaraannya. 🙏\n\n${COMPLAINT_INVITE}`,
      });
    }

    // 7. Layer D: nothing matched → admin
    return escalate(phoneNumber, messageText, matcherService.buildFallback('no_match'));
  } catch (err) {
    logger.error({ err, phoneNumber }, 'Unexpected error in handleMessage');
    return '⚠️ Maaf, terjadi sedikit kendala pada sistem kami. Pertanyaan Anda akan segera dicek oleh tim admin. Terima kasih! 🙏';
  }
}

/**
 * Audit a bot reply (escalations raised inside the booking flow are already handled there).
 */
async function respond(phoneNumber, messageText, result) {
  await auditService.logChatInteraction({
    phoneNumber,
    incomingMessage: messageText,
    matchedLayer: result.subIntent ? `${result.layer}:${result.subIntent}` : result.layer,
    matchedItemId: null,
    rawScore: 0,
    thresholdUsed: 0,
    replyMessage: result.reply,
    isEscalated: !!result.isEscalated,
    escalationReason: result.escalationReason || null,
  });
  return result.reply;
}

/**
 * Hand the conversation to the admin: bot silent for 24h, throttled email alert, audit (PRD 7.4).
 */
async function escalate(phoneNumber, messageText, result) {
  logger.warn({ phoneNumber, layer: result.layer, reason: result.escalationReason }, 'Escalating message to admin');

  await conversationService.resetState(phoneNumber);
  await conversationService.setAdminHandled(phoneNumber, {
    reason: result.escalationReason,
    lastMessage: messageText,
  });

  alertService
    .sendEscalationAlert({
      phoneNumber,
      incomingMessage: messageText,
      escalationReason: result.escalationReason,
      matchedLayer: result.layer,
    })
    .catch((err) => logger.error({ err }, 'Background escalation alert error'));

  return respond(phoneNumber, messageText, result);
}

module.exports = {
  handleMessage,
};
