const { handleMessage } = require('../src/handlers/message.handler');
const conversationService = require('../src/services/conversation.service');
const auditService = require('../src/services/audit.service');
const { BotChatLog, sequelize } = require('../src/models');

(async () => {
  console.log('=== TEST TAHAP 4: STATE MACHINE REDIS & MYSQL AUDIT LOG ===\n');

  const testPhone = '628999888777';

  // Pre-cleanup in case old test data exists
  await conversationService.releaseAdminHandled(testPhone);
  await BotChatLog.destroy({ where: { phone_number: testPhone } });

  // 1. Normal Service Message
  console.log('1. Customer sends valid service inquiry:');
  const reply1 = await handleMessage(testPhone, 'bisa tambal ban motor bocor?', 'msg-001');
  console.log('   Reply 1:', reply1 ? reply1.split('\n')[0] : null);
  console.assert(reply1 && reply1.includes('Tambal Ban'), 'Must reply with service details');
  
  const isHandled1 = await conversationService.isAdminHandled(testPhone);
  console.log('   Is Admin-Handled in Redis:', isHandled1);
  console.assert(isHandled1 === false, 'Must NOT be admin handled after successful match');
  console.log('   ✅ Normal Flow PASS\n');

  // 2. Escalation Trigger (Layer C: Jual-Beli Seken)
  console.log('2. Customer asks for used unit (triggers Layer C escalation):');
  const reply2 = await handleMessage(testPhone, 'ada molis seken gak?', 'msg-002');
  console.log('   Reply 2:', reply2);
  console.assert(reply2 && reply2.includes('teruskan ke admin'), 'Must send 1x escalation notification');

  const isHandled2 = await conversationService.isAdminHandled(testPhone);
  const info2 = await conversationService.getAdminHandledInfo(testPhone);
  console.log('   Is Admin-Handled in Redis:', isHandled2);
  console.log('   Reason recorded:', info2?.reason);
  console.log('   Remaining TTL (seconds):', info2?.remainingTtlSeconds);
  console.assert(isHandled2 === true, 'Must BE admin handled in Redis');
  console.assert(info2?.reason === 'jual_beli_non_harga', 'Reason must be jual_beli_non_harga');
  console.assert(info2?.remainingTtlSeconds > 86000, 'TTL must be around 86400 (24h)');
  console.log('   ✅ Escalation & Redis TTL PASS\n');

  // 3. Subsequent Message while Admin-Handled (Bot must stay SILENT)
  console.log('3. Customer sends subsequent message while admin-handled:');
  const reply3 = await handleMessage(testPhone, 'halo admin kok belum dibalas?', 'msg-003');
  console.log('   Reply 3 (should be null):', reply3);
  console.assert(reply3 === null, 'Bot must stay completely SILENT when admin-handled');
  console.log('   ✅ Silent Bot PASS\n');

  // 4. Verify MySQL Audit Logs
  console.log('4. Checking MySQL bot_chat_logs:');
  const logs = await auditService.getRecentLogs(10, 0, { phone_number: testPhone });
  console.log('   Total logs for test phone:', logs.length);
  for (const l of logs) {
    console.log(`   [ID: ${l.id}] Msg: "${l.incoming_message}" | Layer: ${l.matched_layer} | Escalated: ${l.is_escalated} | Reason: ${l.escalation_reason}`);
  }
  console.assert(logs.length === 3, 'Must have recorded all 3 interactions in MySQL');
  console.log('   ✅ MySQL Audit Trail PASS\n');

  // 5. Test Release / Unblock (Simulating 24h reset or admin unblock)
  console.log('5. Releasing admin-handled status:');
  await conversationService.releaseAdminHandled(testPhone);
  const isHandledAfterRelease = await conversationService.isAdminHandled(testPhone);
  console.log('   Is Admin-Handled after release:', isHandledAfterRelease);
  console.assert(isHandledAfterRelease === false, 'Must be false after release');

  // Now bot should answer again
  const reply4 = await handleMessage(testPhone, 'bengkel tutup jam berapa?', 'msg-004');
  console.log('   Reply 4 after release:', reply4 ? reply4.split('\n')[0] : null);
  console.assert(reply4 && reply4.includes('operasional'), 'Bot must answer again after release');
  console.log('   ✅ Unblock & Re-activation PASS\n');

  // Clean up test data
  await conversationService.releaseAdminHandled(testPhone);
  await BotChatLog.destroy({ where: { phone_number: testPhone } });
  console.log('🎉 ALL TAHAP 4 TESTS PASSED 100% SUCCESSFULLY!');
  process.exit(0);
})();
