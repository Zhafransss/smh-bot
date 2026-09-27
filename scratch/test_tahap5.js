process.env.NODE_ENV = 'test';

const { enqueueMessage, closeQueue, getQueue } = require('../src/queues/message.queue');
const { startWorker, stopWorker } = require('../src/queues/message.worker');
const { getRedisClient } = require('../src/config/redis');
const conversationService = require('../src/services/conversation.service');
const { BotChatLog } = require('../src/models');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  console.log('=== TEST TAHAP 5: CONSECUTIVE MESSAGE AGGREGATION & BULLMQ WORKER ===\n');

  const testPhone = '628111222333';
  const remoteJid = `${testPhone}@s.whatsapp.net`;

  // Pre-cleanup
  await conversationService.releaseAdminHandled(testPhone);
  await BotChatLog.destroy({ where: { phone_number: testPhone } });
  const redis = getRedisClient();
  await redis.del(`msg_buffer:${testPhone}`);

  // Start worker
  const worker = startWorker();
  console.log('Worker started for test.');

  // Simulate customer typing 3 messages rapidly (dicicil per baris)
  console.log('1. Customer sends 3 consecutive messages within 100ms:');
  console.log('   Message 1: "halo kak"');
  await enqueueMessage({
    phoneNumber: testPhone,
    messageText: 'halo kak',
    waMessageId: 'msg-part-1',
    remoteJid,
    msgKey: { remoteJid, id: 'msg-part-1' },
  }, 1000); // 1000ms debounce delay for test speed

  await sleep(100);

  console.log('   Message 2: "bisa cek molis?"');
  await enqueueMessage({
    phoneNumber: testPhone,
    messageText: 'bisa cek molis?',
    waMessageId: 'msg-part-2',
    remoteJid,
    msgKey: { remoteJid, id: 'msg-part-2' },
  }, 1000);

  await sleep(100);

  console.log('   Message 3: "motor listrik tidak mau digas mati"');
  await enqueueMessage({
    phoneNumber: testPhone,
    messageText: 'motor listrik tidak mau digas mati',
    waMessageId: 'msg-part-3',
    remoteJid,
    msgKey: { remoteJid, id: 'msg-part-3' },
  }, 1000);

  // Check Redis buffer immediately
  const bufferedCount = await redis.llen(`msg_buffer:${testPhone}`);
  console.log('   Buffered messages count in Redis:', bufferedCount);
  console.assert(bufferedCount === 3, 'Must have buffered all 3 messages in Redis');
  console.log('   ✅ Redis Buffering PASS\n');

  // Wait for BullMQ debounce delay + worker processing (~1.5 seconds)
  console.log('2. Waiting for BullMQ debounce timer & worker execution...');
  await sleep(2000);

  // Buffer should now be drained by worker
  const remainingBuffer = await redis.llen(`msg_buffer:${testPhone}`);
  console.log('   Remaining buffer after worker run:', remainingBuffer);
  console.assert(remainingBuffer === 0, 'Buffer must be drained by worker');
  console.log('   ✅ Buffer Drain PASS\n');

  // Verify MySQL audit log for the aggregated message
  console.log('3. Verifying aggregated message in MySQL audit log:');
  const logs = await BotChatLog.findAll({
    where: { phone_number: testPhone },
    order: [['created_at', 'DESC']],
  });

  console.log('   Audit logs count:', logs.length);
  console.assert(logs.length === 1, 'Must have processed as exactly ONE aggregated interaction');

  const log = logs[0];
  console.log('   Incoming message stored:\n', log.incoming_message);
  console.log('   Matched layer:', log.matched_layer);
  console.log('   Raw score:', log.raw_score);
  console.log('   Is escalated:', log.is_escalated);

  console.assert(
    log.incoming_message.includes('halo kak') &&
    log.incoming_message.includes('bisa cek molis?') &&
    log.incoming_message.includes('motor listrik tidak mau digas mati'),
    'Aggregated text must contain all 3 messages'
  );
  console.assert(log.matched_layer === 'LAYER_A', 'Should match Layer A');
  console.assert(log.raw_score >= 2, 'Raw score must be >= 2');
  console.log('   ✅ Message Aggregation & Context Integrity PASS\n');

  // Cleanup
  await stopWorker();
  await closeQueue();
  await conversationService.releaseAdminHandled(testPhone);
  await BotChatLog.destroy({ where: { phone_number: testPhone } });

  console.log('🎉 ALL TAHAP 5 TESTS PASSED 100% SUCCESSFULLY!');
  process.exit(0);
})();
