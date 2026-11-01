'use strict';

const http = require('node:http');
const { WebSocket } = require('ws');
const DB = require('./db.js');

process.env.PORT = '3046';
process.env.JWT_SECRET = 'test_secret_upgrade_2026';
require('./server.js');

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function request(path, options = {}) {
  const url = `http://localhost:3046${path}`;
  options.headers = options.headers || {};
  if (options.body && typeof options.body === 'object') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(url, options);
  const json = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data: json };
}

async function runTests() {
  console.log('=== STARTING UPGRADED AI & REGISTRATION SYSTEM TESTS ===');
  await wait(900); // Wait for server to bind

  let passed = 0;
  function assert(condition, message) {
    if (!condition) {
      console.error(`❌ FAILED: ${message}`);
      process.exit(1);
    }
    console.log(`✅ PASSED: ${message}`);
    passed++;
  }

  // 1. Visitor Registration Validation
  console.log('\n[1] Testing visitor registration validation rules...');
  const invalidAgeRes = await request('/api/visitor/register', {
    method: 'POST',
    body: { username: 'Vikram', age: 'invalid_age', phone: '+91 94954 92013' }
  });
  assert(invalidAgeRes.status === 400, 'Rejects non-integer age values');

  const validReg = await request('/api/visitor/register', {
    method: 'POST',
    body: { username: 'Vikram Sundaram', age: 48, phone: '+91 94954 92013' }
  });
  assert(validReg.status === 200 && validReg.data.success, 'Valid registration creates visitor profile');
  assert(!!validReg.data.visitorToken, 'Cryptographic visitor token generated');
  assert(!!validReg.data.conversationId, 'Conversation automatically created for visitor');
  const visToken = validReg.data.visitorToken;
  const convId = validReg.data.conversationId;
  const visitorId = validReg.data.visitor.id;

  // 2. Session verification & returning visitor persistence
  console.log('\n[2] Testing session persistence for returning visitors...');
  const sessionRes = await request(`/api/chat/session?visitorToken=${visToken}`);
  assert(sessionRes.status === 200 && sessionRes.data.success && !sessionRes.data.requiresRegistration, 'Session restored without requiring re-registration');
  assert(sessionRes.data.visitor.username === 'Vikram Sundaram', 'Visitor identity verified');

  // 3. Visitor sends "Hi" -> Automated AI Response verification
  console.log('\n[3] Testing visitor sending "Hi" and automated AI Clinical Assistant response...');
  const sendHi = await request('/api/chat/send', {
    method: 'POST',
    body: { visitorToken: visToken, conversationId: convId, messageText: 'Hi' }
  });
  assert(sendHi.status === 200 && sendHi.data.success, 'Visitor message "Hi" saved');

  // Wait 1.2s for AI processing and typing simulation
  await wait(1200);

  const messagesAfterHi = await request(`/api/chat/session?visitorToken=${visToken}`);
  assert(messagesAfterHi.data.messages.length >= 2, 'AI Assistant replied automatically');
  const aiReply1 = messagesAfterHi.data.messages.find(m => m.sender_type === 'AI');
  assert(!!aiReply1, 'Message sender type is explicitly marked as "AI"');
  assert(aiReply1.message_text.includes('Dr. John Smith'), 'AI introduced Dr. John Smith\'s clinical practice');

  // 4. Inquiring about consultation hours
  console.log('\n[4] Testing AI understanding clinical consultation hours...');
  await request('/api/chat/send', {
    method: 'POST',
    body: { visitorToken: visToken, conversationId: convId, messageText: 'What are your consultation hours?' }
  });
  await wait(1200);

  const msgsHours = await request(`/api/chat/session?visitorToken=${visToken}`);
  const lastAiMsgHours = msgsHours.data.messages.filter(m => m.sender_type === 'AI').pop();
  assert(lastAiMsgHours.message_text.includes('10:00 AM') && lastAiMsgHours.message_text.includes('Monday'), 'AI accurately answered consultation hours');

  // 5. Inquiring about doctor's credentials & qualifications
  console.log('\n[5] Testing AI responding with verified medical qualifications...');
  await request('/api/chat/send', {
    method: 'POST',
    body: { visitorToken: visToken, conversationId: convId, messageText: 'Where did Dr. Smith train and what are his qualifications?' }
  });
  await wait(1200);

  const msgsQual = await request(`/api/chat/session?visitorToken=${visToken}`);
  const lastAiMsgQual = msgsQual.data.messages.filter(m => m.sender_type === 'AI').pop();
  assert(lastAiMsgQual.message_text.includes('AIIMS') && lastAiMsgQual.message_text.includes('Mayo Clinic'), 'AI quoted verified qualifications (AIIMS & Mayo Clinic)');

  // 6. Automated Appointment Booking via Chat
  console.log('\n[6] Testing conversational appointment booking through AI...');
  await request('/api/chat/send', {
    method: 'POST',
    body: {
      visitorToken: visToken,
      conversationId: convId,
      messageText: 'I would like to book an appointment tomorrow at 11:00 AM for persistent chest discomfort.'
    }
  });
  await wait(1300);

  const msgsBooking = await request(`/api/chat/session?visitorToken=${visToken}`);
  const lastBookingAi = msgsBooking.data.messages.filter(m => m.sender_type === 'AI').pop();
  assert(lastBookingAi.message_text.includes('Appointment Request Received') || lastBookingAi.message_text.includes('11:00 AM'), 'AI processed appointment booking confirmation');

  // Verify appointment logged in database appointments table
  const apptsList = DB.listAppointments();
  const createdAppt = apptsList.find(a => a.visitor_id === visitorId);
  assert(!!createdAppt, 'Appointment successfully created in database appointments table');
  assert(createdAppt.preferred_time.includes('11:00 AM'), 'Preferred time slot recorded accurately');
  assert(createdAppt.status === 'pending', 'Initial appointment status is pending');
  assert(createdAppt.patient_name === 'Vikram Sundaram', 'Patient name associated with appointment');

  // 7. Admin Authentication & Appointments Management
  console.log('\n[7] Testing Admin viewing and confirming appointment...');
  const adminLogin = await request('/api/admin/login', {
    method: 'POST',
    body: { email: 'admin@doctor.com', password: 'DoctorCare@2026' }
  });
  assert(adminLogin.status === 200 && !!adminLogin.data.token, 'Admin logged in');
  const adminToken = adminLogin.data.token;

  const adminApptsRes = await request('/api/admin/appointments', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminApptsRes.status === 200 && adminApptsRes.data.appointments.length > 0, 'Admin can view all clinic appointments');

  const updateApptRes = await request(`/api/admin/appointments/${createdAppt.id}/status`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { status: 'confirmed' }
  });
  assert(updateApptRes.status === 200 && updateApptRes.data.appointment.status === 'confirmed', 'Admin confirmed patient appointment');

  // 8. Row-Level Security / Visitor Isolation
  console.log('\n[8] Testing privacy isolation between visitors...');
  const fakeSession = await request('/api/chat/session?visitorToken=imposter_token_999');
  assert(fakeSession.data.requiresRegistration === true, 'Unauthorized access rejected and forced to register');

  console.log('\n======================================================');
  console.log(`🎉 ALL ${passed} UPGRADED FEATURE TESTS PASSED WITH 100% SUCCESS!`);
  console.log('======================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
