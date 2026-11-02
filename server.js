'use strict';

const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const DB = require('./db.js');
const { generateAIResponse, CLINIC_KNOWLEDGE } = require('./ai-engine.js');

const isVercelEnv = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION || process.env.NOW_REGION);

const app = express();
let server = null;
let wss = null;

if (!isVercelEnv) {
  server = http.createServer(app);
  wss = new WebSocketServer({ server, path: '/ws' });
}

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'doctor_luxury_medical_secret_key_2026';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Admin authentication middleware
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired admin token' });
  }
}

// ============================================================================
// REAL-TIME WEBSOCKET HUB
// ============================================================================
const adminSockets = new Set();
const conversationSockets = new Map(); // conversationId -> Set of ws clients

function broadcastToAdmin(payload) {
  const msg = JSON.stringify(payload);
  adminSockets.forEach(ws => {
    if (ws.readyState === ws.OPEN) {
      ws.send(msg);
    }
  });
}

function broadcastToConversation(conversationId, payload) {
  const msg = JSON.stringify(payload);
  const set = conversationSockets.get(conversationId);
  if (set) {
    set.forEach(ws => {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg);
      }
    });
  }
}

if (wss) {
  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.role = null;
    ws.conversationId = null;

    ws.on('message', raw => {
      try {
        const data = JSON.parse(raw);

        // Admin socket registration
        if (data.action === 'auth_admin') {
          try {
            const decoded = jwt.verify(data.token, JWT_SECRET);
            ws.role = 'admin';
            ws.admin = decoded;
            adminSockets.add(ws);
            ws.send(JSON.stringify({ event: 'auth_success', role: 'admin' }));
          } catch (e) {
            ws.send(JSON.stringify({ event: 'auth_error', message: 'Invalid admin token' }));
          }
          return;
        }

        // Visitor socket registration
        if (data.action === 'auth_visitor') {
          const { conversationId, visitorToken } = data;
          const visitor = DB.getVisitorByToken(visitorToken);
          if (visitor) {
            const conv = DB.getConversationForVisitor(visitor.id, conversationId);
            if (conv) {
              ws.role = 'visitor';
              ws.conversationId = conv.id;
              if (!conversationSockets.has(conv.id)) {
                conversationSockets.set(conv.id, new Set());
              }
              conversationSockets.get(conv.id).add(ws);
              ws.send(JSON.stringify({ event: 'auth_success', role: 'visitor', conversationId: conv.id }));
              return;
            }
          }
          ws.send(JSON.stringify({ event: 'auth_error', message: 'Invalid visitor credentials' }));
          return;
        }

        // Typing indicator
        if (data.action === 'typing') {
          if (ws.role === 'visitor' && ws.conversationId) {
            broadcastToAdmin({
              event: 'typing',
              conversationId: ws.conversationId,
              senderType: 'visitor',
              isTyping: !!data.isTyping
            });
          } else if (ws.role === 'admin' && data.conversationId) {
            broadcastToConversation(data.conversationId, {
              event: 'typing',
              conversationId: data.conversationId,
              senderType: 'admin',
              isTyping: !!data.isTyping
            });
          }
        }
      } catch (err) {
        console.error('[WebSocket] Message parsing error:', err.message);
      }
    });

    ws.on('close', () => {
      if (ws.role === 'admin') {
        adminSockets.delete(ws);
      }
      if (ws.conversationId && conversationSockets.has(ws.conversationId)) {
        const set = conversationSockets.get(ws.conversationId);
        set.delete(ws);
        if (set.size === 0) {
          conversationSockets.delete(ws.conversationId);
        }
      }
    });
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));
}

// ============================================================================
// REST API: VISITOR REGISTRATION & SESSION MANAGEMENT
// ============================================================================

// 1. Visitor Registration
app.post('/api/visitor/register', (req, res) => {
  try {
    const { username, age, phone, existingToken } = req.body;

    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Please provide your full name or username.' });
    }
    const parsedAge = parseInt(age, 10);
    if (isNaN(parsedAge) || parsedAge < 1 || parsedAge > 120) {
      return res.status(400).json({ error: 'Please enter a valid age between 1 and 120.' });
    }

    const visitor = DB.registerVisitor({
      username: username.trim(),
      age: parsedAge,
      phone: phone ? phone.trim() : '',
      existingToken
    });

    const conversation = DB.getOrCreateConversation(visitor.id);
    const messages = DB.getMessages(conversation.id);

    // Notify admin
    broadcastToAdmin({
      event: 'visitor_registered',
      visitor,
      conversation
    });

    res.json({
      success: true,
      visitor: {
        id: visitor.id,
        username: visitor.username,
        age: visitor.age,
        phone: visitor.phone
      },
      visitorToken: visitor.visitor_token,
      conversationId: conversation.id,
      messages
    });
  } catch (err) {
    console.error('[API /api/visitor/register error]:', err.message);
    res.status(400).json({ error: err.message || 'Registration failed' });
  }
});

// 2. Validate Session & Load Active Messages
app.get('/api/chat/session', (req, res) => {
  try {
    const visitorToken = req.query.visitorToken || req.headers['x-visitor-token'];

    if (!visitorToken) {
      return res.json({ success: false, requiresRegistration: true });
    }

    const visitor = DB.getVisitorByToken(visitorToken);
    if (!visitor) {
      return res.json({ success: false, requiresRegistration: true });
    }

    const conv = DB.getOrCreateConversation(visitor.id);
    DB.markConversationRead(conv.id, 'visitor');

    const messages = DB.getMessages(conv.id);
    const appointments = DB.getAppointmentsForConversation(conv.id);

    res.json({
      success: true,
      requiresRegistration: false,
      visitor: {
        id: visitor.id,
        username: visitor.username,
        age: visitor.age,
        phone: visitor.phone
      },
      visitorToken: visitor.visitor_token,
      conversationId: conv.id,
      status: conv.status,
      messages,
      appointments
    });
  } catch (err) {
    console.error('[API /api/chat/session error]:', err);
    res.status(500).json({ error: 'Failed to verify session' });
  }
});

// 3. Send Message (Visitor) with Automatic AI Assistant Integration
app.post('/api/chat/send', async (req, res) => {
  try {
    let { visitorToken, messageText, conversationId } = req.body;

    if (!messageText || !messageText.trim()) {
      return res.status(400).json({ error: 'Message text cannot be empty' });
    }
    if (messageText.length > 2500) {
      return res.status(400).json({ error: 'Message exceeds maximum length' });
    }

    if (!visitorToken) {
      return res.status(401).json({ error: 'Registration required before sending messages', requiresRegistration: true });
    }

    const visitor = DB.getVisitorByToken(visitorToken);
    if (!visitor) {
      return res.status(401).json({ error: 'Invalid visitor session token', requiresRegistration: true });
    }

    const conv = DB.getOrCreateConversation(visitor.id);
    const currentConvId = conv.id;

    // 1. Save visitor message
    const visitorMsg = DB.addMessage({
      conversationId: currentConvId,
      senderType: 'visitor',
      senderName: visitor.username,
      messageText: messageText.trim()
    });

    const updatedConv = DB.getConversationById(currentConvId);

    // Broadcast visitor message immediately
    broadcastToAdmin({
      event: 'new_enquiry_message',
      conversationId: currentConvId,
      conversation: updatedConv,
      message: visitorMsg
    });

    broadcastToConversation(currentConvId, {
      event: 'new_message',
      message: visitorMsg
    });

    // Send immediate response back to HTTP caller
    res.json({
      success: true,
      conversationId: currentConvId,
      message: visitorMsg
    });

    // 2. Trigger AI Conversational Assistant
    // Simulate natural clinical reading & typing time
    setTimeout(async () => {
      try {
        // Send typing indicator to visitor
        broadcastToConversation(currentConvId, {
          event: 'typing',
          conversationId: currentConvId,
          senderType: 'admin',
          isTyping: true
        });

        const history = DB.getMessages(currentConvId);
        const aiResponse = await generateAIResponse({
          visitor,
          conversationId: currentConvId,
          messageText,
          history,
          DB
        });

        // Turn off typing indicator
        broadcastToConversation(currentConvId, {
          event: 'typing',
          conversationId: currentConvId,
          senderType: 'admin',
          isTyping: false
        });

        if (aiResponse && aiResponse.replyText) {
          const aiMsg = DB.addMessage({
            conversationId: currentConvId,
            senderType: 'AI',
            senderName: 'AI Clinical Assistant',
            messageText: aiResponse.replyText
          });

          const freshConv = DB.getConversationById(currentConvId);

          // Push AI reply to visitor
          broadcastToConversation(currentConvId, {
            event: 'new_message',
            message: aiMsg,
            appointmentCreated: aiResponse.appointmentCreated || null
          });

          // Push AI reply to admin inbox
          broadcastToAdmin({
            event: 'ai_reply_sent',
            conversationId: currentConvId,
            conversation: freshConv,
            message: aiMsg,
            appointmentCreated: aiResponse.appointmentCreated || null
          });
        }
      } catch (aiErr) {
        console.error('[AI Assistant Error]:', aiErr);
      }
    }, 850);

  } catch (err) {
    console.error('[API /api/chat/send error]:', err);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// 4. Dedicated Appointment Booking Endpoint
app.post('/api/appointments/book', (req, res) => {
  try {
    const {
      visitorToken,
      conversationId,
      patientName,
      patientAge,
      phone,
      appointmentDate,
      preferredTime,
      reasonForVisit
    } = req.body;

    if (!visitorToken) {
      return res.status(401).json({ error: 'Visitor session token required' });
    }

    const visitor = DB.getVisitorByToken(visitorToken);
    if (!visitor) {
      return res.status(401).json({ error: 'Invalid visitor session token' });
    }

    if (!patientName || !phone || !appointmentDate || !preferredTime) {
      return res.status(400).json({ error: 'Patient name, phone, appointment date, and preferred time are required.' });
    }

    const appt = DB.createAppointment({
      visitorId: visitor.id,
      conversationId: conversationId || null,
      patientName,
      patientAge: patientAge ? parseInt(patientAge, 10) : visitor.age,
      phone,
      appointmentDate,
      preferredTime,
      reasonForVisit: reasonForVisit || '',
      status: 'pending'
    });

    // Notify admin
    broadcastToAdmin({
      event: 'new_appointment_booked',
      appointment: appt,
      visitor
    });

    if (conversationId) {
      broadcastToConversation(conversationId, {
        event: 'appointment_confirmed',
        appointment: appt
      });
    }

    res.json({ success: true, appointment: appt });
  } catch (err) {
    console.error('[API /api/appointments/book error]:', err);
    res.status(400).json({ error: err.message || 'Appointment booking failed' });
  }
});

// ============================================================================
// REST API: ADMIN ENDPOINTS (Protected by requireAdmin)
// ============================================================================

// Admin Login
app.post('/api/admin/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const admin = DB.getAdminByEmail(email.trim());
    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = bcrypt.compareSync(password, admin.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { adminId: admin.id, email: admin.email, name: admin.name, role: admin.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Admin verify session
app.get('/api/admin/me', requireAdmin, (req, res) => {
  const admin = DB.getAdminById(req.admin.adminId);
  if (!admin) return res.status(404).json({ error: 'Admin account not found' });
  res.json({ success: true, admin });
});

// List all conversations
app.get('/api/admin/conversations', requireAdmin, (req, res) => {
  try {
    const { status, search } = req.query;
    const conversations = DB.listConversations({ status, search });
    const stats = DB.getStats();
    res.json({ success: true, conversations, stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get single conversation details, messages, and appointments
app.get('/api/admin/conversations/:id', requireAdmin, (req, res) => {
  try {
    const conv = DB.getConversationById(req.params.id);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    DB.markConversationRead(conv.id, 'admin');

    const messages = DB.getMessages(conv.id);
    const appointments = DB.getAppointmentsForConversation(conv.id);

    broadcastToConversation(conv.id, {
      event: 'messages_read_by_admin',
      conversationId: conv.id
    });

    broadcastToAdmin({
      event: 'conversation_marked_read',
      conversationId: conv.id
    });

    res.json({ success: true, conversation: conv, messages, appointments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// Send Admin Reply
app.post('/api/admin/conversations/:id/reply', requireAdmin, (req, res) => {
  try {
    const conversationId = req.params.id;
    const { messageText } = req.body;

    if (!messageText || !messageText.trim()) {
      return res.status(400).json({ error: 'Reply text cannot be empty' });
    }

    const conv = DB.getConversationById(conversationId);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const adminName = req.admin.name || 'Dr. John Smith';
    const message = DB.addMessage({
      conversationId,
      senderType: 'admin',
      senderName: adminName,
      messageText: messageText.trim()
    });

    const updatedConv = DB.getConversationById(conversationId);

    broadcastToConversation(conversationId, {
      event: 'new_message',
      message
    });

    broadcastToAdmin({
      event: 'admin_reply_sent',
      conversationId,
      conversation: updatedConv,
      message
    });

    res.json({ success: true, message, conversation: updatedConv });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send admin reply' });
  }
});

// Update conversation status
app.patch('/api/admin/conversations/:id/status', requireAdmin, (req, res) => {
  try {
    const { status } = req.body;
    const updated = DB.updateConversationStatus(req.params.id, status);

    broadcastToAdmin({
      event: 'conversation_status_changed',
      conversationId: req.params.id,
      status: updated.status,
      conversation: updated
    });

    res.json({ success: true, conversation: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update internal admin notes
app.patch('/api/admin/conversations/:id/notes', requireAdmin, (req, res) => {
  try {
    const { notes } = req.body;
    const updated = DB.updateAdminNotes(req.params.id, notes);
    res.json({ success: true, conversation: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notes' });
  }
});

// List all appointments for Admin
app.get('/api/admin/appointments', requireAdmin, (req, res) => {
  try {
    const { status } = req.query;
    const appointments = DB.listAppointments({ status });
    res.json({ success: true, appointments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Update appointment status
app.patch('/api/admin/appointments/:id/status', requireAdmin, (req, res) => {
  try {
    const { status } = req.body;
    const updated = DB.updateAppointmentStatus(req.params.id, status);

    broadcastToAdmin({
      event: 'appointment_status_changed',
      appointment: updated
    });

    if (updated.conversation_id) {
      broadcastToConversation(updated.conversation_id, {
        event: 'appointment_status_changed',
        appointment: updated
      });
    }

    res.json({ success: true, appointment: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin stats
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  try {
    const stats = DB.getStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ============================================================================
// STATIC FILES & SPA ROUTES
// ============================================================================
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (!isVercelEnv && (require.main === module || process.env.NODE_ENV === 'test')) {
  server.listen(PORT, () => {
    console.log(`[Server] Dr. John Smith Medical Portal running at http://localhost:${PORT}`);
    console.log(`[Server] Admin messaging inbox available at http://localhost:${PORT}/admin`);
    console.log(`[Server] Default Admin Credentials: ${process.env.ADMIN_EMAIL || 'admin@doctor.com'} / ${process.env.ADMIN_PASSWORD || 'DoctorCare@2026'}`);
  });
}

module.exports = app;
module.exports.server = server;
