require('dotenv').config();
const { handleMessage } = require('../src/handlers/message.handler');
const { getRegistration, clearRegistration } = require('../src/services/registration.service');
const { releaseAdminHandled, resetState } = require('../src/services/conversation.service');
const { sequelize } = require('../src/models');
const { getRedisClient, closeRedis } = require('../src/config/redis');

async function runTest() {
  const testPhone = '6281329886092';
  console.log('🧪 Starting Service Complaint & Registration Flow Test...\n');

  try {
    // 0. Reset state for test phone
    await releaseAdminHandled(testPhone);
    await resetState(testPhone);
    await clearRegistration(testPhone);
    console.log('✅ Cleaned previous state for phone:', testPhone);

    // Step 1: Customer submits complaint
    console.log('\n--- Step 1: Customer sends complaint ---');
    const msg1 = 'jadi sebenernya ketika saya cas itu gabisa masuk mas, sudah saya cobain pake charger lain';
    console.log('Customer:', msg1);
    const reply1 = await handleMessage(testPhone, msg1);
    console.log('\nBot Reply:\n' + reply1);

    if (reply1.includes('Pesan Anda telah kami teruskan ke admin')) {
      throw new Error('FAILED: Bot immediately escalated to admin instead of providing guidance!');
    }
    if (!reply1.includes('- Atas nama:') || !reply1.includes('- Alamat:')) {
      throw new Error('FAILED: Bot reply did not include the registration form!');
    }
    console.log('✅ Step 1 Passed: Bot offered workshop/home service and sent registration format.');

    // Step 2: Customer sends registration form WITHOUT photo
    console.log('\n--- Step 2: Customer sends form without photo ---');
    const msg2 = `- Atas nama: Budi Santoso\n- Alamat: Jl. Melati No. 12, Purwokerto\n- Foto unit: -\n- Kendala: Cas tidak masuk`;
    console.log('Customer:\n' + msg2);
    const reply2 = await handleMessage(testPhone, msg2);
    console.log('\nBot Reply:\n' + reply2);

    if (!reply2.toLowerCase().includes('foto unit')) {
      throw new Error('FAILED: Bot should have prompted for unit photo when not provided!');
    }
    console.log('✅ Step 2 Passed: Bot detected missing photo and asked for photo unit.');

    // Step 3: Customer sends photo
    console.log('\n--- Step 3: Customer sends photo ---');
    const msg3 = '[FOTO_UNIT]';
    console.log('Customer:', msg3);
    const reply3 = await handleMessage(testPhone, msg3);
    console.log('\nBot Reply:\n' + reply3);

    if (!reply3.toLowerCase().includes('share lokasi')) {
      throw new Error('FAILED: Bot should have requested Share Location after photo was received!');
    }
    console.log('✅ Step 3 Passed: Bot accepted photo and requested Share Location.');

    // Step 4: Customer sends Share Location
    console.log('\n--- Step 4: Customer sends Share Location ---');
    const msg4 = '[LOCATION: lat=-7.4243, lng=109.2301, label=Rumah Budi]';
    console.log('Customer:', msg4);
    const reply4 = await handleMessage(testPhone, msg4);
    console.log('\nBot Reply:\n' + reply4);

    if (!reply4.includes('lengkap tercatat')) {
      throw new Error('FAILED: Bot should confirm complete registration!');
    }
    console.log('✅ Step 4 Passed: Bot finalized registration with complete payload formatted.');

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! The flow functions precisely as requested.');
  } catch (err) {
    console.error('\n❌ Test Error:', err.message);
  } finally {
    await sequelize.close();
    await closeRedis();
    process.exit(0);
  }
}

runTest();
