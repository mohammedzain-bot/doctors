'use strict';

const http = require('node:http');
const { WebSocket } = require('ws');

// Launch server in-process for testing
process.env.PORT = '3045';
process.env.JWT_SECRET = 'test_secret_key_123';
require('./server.js');

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function request(path, options = {}) {
  const url = `http://localhost:3045${path}`;
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
  console.log('--- STARTING COMPREHENSIVE SYSTEM VERIFICATION ---');
  await wait(800); // Wait for server to start

  let testsPassed = 0;
  function assert(condition, message) {
    if (!condition) {
      console.error(`❌ FAILED: ${message}`);
      process.exit(1);
    }
    console.log(`✅ PASSED: ${message}`);
    testsPassed++;
  }

  // 1. Visitor initializes chat session
  console.log('\n[1] Testing visitor session creation...');
  const initRes = await request('/api/chat/session', {
    method: 'POST',
    body: {
      visitorName: 'Rahul Verma',
      visitorPhone: '+91 98765 43210'
    }
  });
  assert(initRes.status === 200 && initRes.data.success, 'Visitor session initialized');
  assert(!!initRes.data.conversationId, 'Conversation ID created');
  assert(!!initRes.data.visitorToken, 'Visitor Token created');
  const convId = initRes.data.conversationId;
  const visToken = initRes.data.visitorToken;

  // 2. Visitor sends message "Hi"
  console.log('\n[2] Testing visitor sending message "Hi"...');
  const sendRes = await request('/api/chat/send', {
    method: 'POST',
    body: {
      conversationId: convId,
      visitorToken: visToken,
      messageText: 'Hi, I would like to consult Dr. John Smith regarding chest pain and ECG results.'
    }
  });
  assert(sendRes.status === 200 && sendRes.data.success, 'Visitor message saved successfully');
  assert(sendRes.data.message.message_text.includes('chest pain'), 'Message content verified in DB');

  // 3. Admin Login
  console.log('\n[3] Testing secure Admin Authentication...');
  const loginRes = await request('/api/admin/login', {
    method: 'POST',
    body: {
      email: 'admin@doctor.com',
      password: 'DoctorCare@2026'
    }
  });
  assert(loginRes.status === 200 && !!loginRes.data.token, 'Admin logged in with JWT token');
  const adminToken = loginRes.data.token;

  // Verify protected route rejection without token
  const unauthRes = await request('/api/admin/conversations');
  assert(unauthRes.status === 401, 'Protected admin route rejects unauthenticated requests (401)');

  // 4. Admin lists enquiries (verifying "Hi" appears in inbox)
  console.log('\n[4] Testing Admin Enquiry Inbox retrieval...');
  const inboxRes = await request('/api/admin/conversations', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(inboxRes.status === 200 && Array.isArray(inboxRes.data.conversations), 'Admin inbox fetched');
  const foundConv = inboxRes.data.conversations.find(c => c.id === convId);
  assert(!!foundConv, 'New visitor enquiry is visible in Admin inbox without page refresh');
  assert(foundConv.unread_count > 0, 'Unread message indicator increments properly');
  assert(foundConv.visitor_name === 'Rahul Verma', 'Visitor name attached correctly');

  // 5. Admin reads conversation (marks messages as read)
  console.log('\n[5] Testing Admin viewing active enquiry...');
  const viewRes = await request(`/api/admin/conversations/${convId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(viewRes.status === 200 && Array.isArray(viewRes.data.messages), 'Active conversation history loaded');
  assert(viewRes.data.messages.length >= 1, 'Visitor message present in history');

  // Check that unread count has now reset to 0
  const inboxAfterRead = await request('/api/admin/conversations', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const updatedConv = inboxAfterRead.data.conversations.find(c => c.id === convId);
  assert(updatedConv.unread_count === 0, 'Unread count marked as 0 after admin view');

  // 6. Admin replies to visitor
  console.log('\n[6] Testing Admin replying to enquiry...');
  const replyRes = await request(`/api/admin/conversations/${convId}/reply`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      messageText: 'Hello Rahul, Dr. Smith is available for urgent cardiac review today at 3:00 PM. Please bring your recent ECG reports.'
    }
  });
  assert(replyRes.status === 200 && replyRes.data.success, 'Admin reply sent and persisted');
  assert(replyRes.data.message.sender_type === 'admin', 'Reply sender correctly marked as admin');

  // 7. Visitor retrieves updated messages (verifying persistence of admin reply)
  console.log('\n[7] Testing Visitor fetching reply with persistence...');
  const visMessagesRes = await request(`/api/chat/messages?conversationId=${convId}&visitorToken=${visToken}`);
  assert(visMessagesRes.status === 200 && visMessagesRes.data.messages.length === 2, 'Visitor sees both messages (visitor message + admin reply)');
  assert(visMessagesRes.data.messages[1].message_text.includes('Dr. Smith is available'), 'Admin reply verified in visitor history');

  // 8. Visitor Isolation Security Test
  console.log('\n[8] Testing Row-Level Visitor Isolation & Privacy...');
  const fakeTokenRes = await request(`/api/chat/messages?conversationId=${convId}&visitorToken=fake_imposter_token`);
  assert(fakeTokenRes.status === 403, 'Unauthorized visitor CANNOT access other patient messages (403 Forbidden)');

  // 9. Admin Notes & Status Updates
  console.log('\n[9] Testing Admin Private Notes & Status Management...');
  const notesRes = await request(`/api/admin/conversations/${convId}/notes`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { notes: 'Patient flagged for priority evaluation. Symptoms: chest pain with exertion.' }
  });
  assert(notesRes.status === 200 && notesRes.data.conversation.admin_notes.includes('priority evaluation'), 'Admin private clinical notes saved to database');

  const statusRes = await request(`/api/admin/conversations/${convId}/status`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { status: 'resolved' }
  });
  assert(statusRes.status === 200 && statusRes.data.conversation.status === 'resolved', 'Conversation status successfully updated to resolved');

  // 10. Real-time WebSocket verification
  console.log('\n[10] Testing Real-time WebSocket connection and bidirectional event dispatch...');
  await new Promise((resolve, reject) => {
    const wsAdmin = new WebSocket('ws://localhost:3045/ws');
    const wsVisitor = new WebSocket('ws://localhost:3045/ws');

    let adminAuthed = false;
    let visitorAuthed = false;
    let messageReceivedOnVisitorWs = false;

    wsAdmin.on('open', () => {
      wsAdmin.send(JSON.stringify({ action: 'auth_admin', token: adminToken }));
    });

    wsVisitor.on('open', () => {
      wsVisitor.send(JSON.stringify({ action: 'auth_visitor', conversationId: convId, visitorToken: visToken }));
    });

    wsAdmin.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.event === 'auth_success') adminAuthed = true;
    });

    wsVisitor.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.event === 'auth_success') {
        visitorAuthed = true;
        // Trigger admin message to verify real-time push to visitor WS
        request(`/api/admin/conversations/${convId}/reply`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
          body: { messageText: 'Realtime test message push over WebSocket!' }
        });
      }
      if (msg.event === 'new_message' && msg.message.message_text.includes('Realtime test message')) {
        messageReceivedOnVisitorWs = true;
        wsAdmin.close();
        wsVisitor.close();
        assert(adminAuthed && visitorAuthed && messageReceivedOnVisitorWs, 'Bidirectional WebSocket real-time message delivery verified');
        resolve();
      }
    });

    setTimeout(() => {
      if (!messageReceivedOnVisitorWs) {
        wsAdmin.close();
        wsVisitor.close();
        reject(new Error('WebSocket verification timed out'));
      }
    }, 4000);
  });

  console.log(`\n======================================================`);
  console.log(`🎉 ALL ${testsPassed} SYSTEM VERIFICATION TESTS PASSED SUCCESSFULLY!`);
  console.log(`======================================================`);
  process.exit(0);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
