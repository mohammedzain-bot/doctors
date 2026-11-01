'use strict';

const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const DB = require('./db.js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'doctor_luxury_medical_secret_key_2026';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security Headers (CSP, CORS, Frame options)
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
        const conv = DB.getConversationByToken(conversationId, visitorToken);
        if (conv) {
          ws.role = 'visitor';
          ws.conversationId = conversationId;
          if (!conversationSockets.has(conversationId)) {
            conversationSockets.set(conversationId, new Set());
          }
          conversationSockets.get(conversationId).add(ws);
          ws.send(JSON.stringify({ event: 'auth_success', role: 'visitor', conversationId }));
        } else {
          ws.send(JSON.stringify({ event: 'auth_error', message: 'Invalid conversation credentials' }));
        }
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

// Heartbeat interval for stale connections
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

// ============================================================================
// REST API: VISITOR CHAT ENDPOINTS
// ============================================================================

// 1. Initialize or resume a conversation session
app.post('/api/chat/session', (req, res) => {
  try {
    let { visitorId, visitorToken, visitorName, visitorPhone } = req.body;

    if (!visitorId || typeof visitorId !== 'string') {
      visitorId = 'vis_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    }
    if (!visitorToken || typeof visitorToken !== 'string') {
      visitorToken = 'tok_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }

    const conversation = DB.getOrCreateConversation({
      visitorId,
      visitorToken,
      visitorName: visitorName || '',
      visitorPhone: visitorPhone || ''
    });

    const messages = DB.getMessages(conversation.id);

    res.json({
      success: true,
      conversationId: conversation.id,
      visitorId: conversation.visitor_id,
      visitorToken: conversation.visitor_token,
      visitorName: conversation.visitor_name,
      visitorPhone: conversation.visitor_phone,
      status: conversation.status,
      messages
    });
  } catch (err) {
    console.error('[API /api/chat/session error]:', err);
    res.status(500).json({ error: 'Failed to initialize chat session' });
  }
});

// 2. Fetch conversation messages (Visitor authentication enforced via visitorToken)
app.get('/api/chat/messages', (req, res) => {
  try {
    const conversationId = req.query.conversationId;
    const visitorToken = req.query.visitorToken || req.headers['x-visitor-token'];

    if (!conversationId || !visitorToken) {
      return res.status(400).json({ error: 'conversationId and visitorToken required' });
    }

    const conv = DB.getConversationByToken(conversationId, visitorToken);
    if (!conv) {
      return res.status(403).json({ error: 'Access denied: Invalid conversation credentials' });
    }

    // Mark admin messages as read by visitor
    DB.markConversationRead(conversationId, 'visitor');

    const messages = DB.getMessages(conversationId);
    res.json({ success: true, conversation: conv, messages });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve messages' });
  }
});

// 3. Send a message from visitor (creates enquiry automatically)
app.post('/api/chat/send', (req, res) => {
  try {
    let { conversationId, visitorId, visitorToken, messageText, visitorName, visitorPhone } = req.body;

    if (!messageText || !messageText.trim()) {
      return res.status(400).json({ error: 'Message text cannot be empty' });
    }

    // Sanitize input length
    if (messageText.length > 2000) {
      return res.status(400).json({ error: 'Message exceeds maximum length of 2000 characters' });
    }

    // If conversation doesn't exist yet, create one automatically
    let conv = null;
    if (conversationId && visitorToken) {
      conv = DB.getConversationByToken(conversationId, visitorToken);
    }

    if (!conv) {
      if (!visitorId) visitorId = 'vis_' + Math.random().toString(36).slice(2, 10);
      if (!visitorToken) visitorToken = 'tok_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      conv = DB.getOrCreateConversation({
        visitorId,
        visitorToken,
        visitorName: visitorName || '',
        visitorPhone: visitorPhone || ''
      });
      conversationId = conv.id;
    } else {
      // Update name/phone if visitor provided in payload
      if (visitorName || visitorPhone) {
        conv = DB.updateVisitorDetails(conversationId, {
          name: visitorName || undefined,
          phone: visitorPhone || undefined
        });
      }
    }

    const senderDisplayName = conv.visitor_name || 'Visitor';
    const message = DB.addMessage({
      conversationId,
      senderType: 'visitor',
      senderName: senderDisplayName,
      messageText: messageText.trim()
    });

    const updatedConv = DB.getConversationById(conversationId);

    // Broadcast to Admin real-time inbox
    broadcastToAdmin({
      event: 'new_enquiry_message',
      conversationId,
      conversation: updatedConv,
      message
    });

    // Broadcast to any visitor socket connected for this conversation
    broadcastToConversation(conversationId, {
      event: 'new_message',
      message
    });

    res.json({
      success: true,
      conversationId,
      visitorId: conv.visitor_id,
      visitorToken: conv.visitor_token,
      message,
      conversation: updatedConv
    });
  } catch (err) {
    console.error('[API /api/chat/send error]:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// 4. Update visitor details optionally
app.post('/api/chat/profile', (req, res) => {
  try {
    const { conversationId, visitorToken, visitorName, visitorPhone } = req.body;
    if (!conversationId || !visitorToken) {
      return res.status(400).json({ error: 'conversationId and visitorToken required' });
    }

    const conv = DB.getConversationByToken(conversationId, visitorToken);
    if (!conv) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updated = DB.updateVisitorDetails(conversationId, {
      name: visitorName !== undefined ? visitorName.trim() : undefined,
      phone: visitorPhone !== undefined ? visitorPhone.trim() : undefined
    });

    broadcastToAdmin({
      event: 'visitor_profile_updated',
      conversationId,
      conversation: updated
    });

    res.json({ success: true, conversation: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
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
    console.error('[Admin Login Error]:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Admin verify session
app.get('/api/admin/me', requireAdmin, (req, res) => {
  const admin = DB.getAdminById(req.admin.adminId);
  if (!admin) return res.status(404).json({ error: 'Admin account not found' });
  res.json({ success: true, admin });
});

// List all enquiries with search, filters, and unread counts
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

// Get single conversation details and messages
app.get('/api/admin/conversations/:id', requireAdmin, (req, res) => {
  try {
    const conv = DB.getConversationById(req.params.id);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Mark visitor messages as read by admin
    DB.markConversationRead(conv.id, 'admin');

    const messages = DB.getMessages(conv.id);

    // Inform visitor that their messages were read
    broadcastToConversation(conv.id, {
      event: 'messages_read_by_admin',
      conversationId: conv.id
    });

    // Notify other admin sessions
    broadcastToAdmin({
      event: 'conversation_marked_read',
      conversationId: conv.id
    });

    res.json({ success: true, conversation: conv, messages });
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

    // Push to visitor real-time
    broadcastToConversation(conversationId, {
      event: 'new_message',
      message
    });

    // Push to admin inbox real-time
    broadcastToAdmin({
      event: 'admin_reply_sent',
      conversationId,
      conversation: updatedConv,
      message
    });

    res.json({ success: true, message, conversation: updatedConv });
  } catch (err) {
    console.error('[Admin Reply Error]:', err);
    res.status(500).json({ error: 'Failed to send admin reply' });
  }
});

// Update conversation status (new, open, resolved)
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

// Update visitor details from admin panel
app.patch('/api/admin/conversations/:id/visitor', requireAdmin, (req, res) => {
  try {
    const { name, phone } = req.body;
    const updated = DB.updateVisitorDetails(req.params.id, { name, phone });

    broadcastToAdmin({
      event: 'visitor_profile_updated',
      conversationId: req.params.id,
      conversation: updated
    });

    res.json({ success: true, conversation: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update visitor info' });
  }
});

// System Stats
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
// Explicit admin route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Serve static project files
app.use(express.static(__dirname));

// Fallback to index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`[Server] Dr. John Smith Medical Portal running at http://localhost:${PORT}`);
  console.log(`[Server] Admin messaging inbox available at http://localhost:${PORT}/admin`);
  console.log(`[Server] Default Admin Credentials: ${process.env.ADMIN_EMAIL || 'admin@doctor.com'} / ${process.env.ADMIN_PASSWORD || 'DoctorCare@2026'}`);
});
