'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
require('dotenv').config();

let DatabaseSync = null;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (e) {
  console.warn('[Database] node:sqlite not available on this Node runtime, activating fallback store.');
}

const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION);
let DB_PATH;
if (isVercel) {
  const tmpDbPath = path.join(os.tmpdir(), 'enquiries.db');
  const seedDbPath = path.join(__dirname, 'enquiries.db');
  if (!fs.existsSync(tmpDbPath) && fs.existsSync(seedDbPath)) {
    try {
      fs.copyFileSync(seedDbPath, tmpDbPath);
      console.log('[Database] Seed database copied to tmpdir for Vercel execution:', tmpDbPath);
    } catch (e) {
      console.warn('[Database] Could not copy seed db to tmpdir:', e.message);
    }
  }
  DB_PATH = tmpDbPath;
} else {
  DB_PATH = path.join(__dirname, 'enquiries.db');
}

function createFallbackDb() {
  const storeFile = path.join(os.tmpdir(), 'enquiries_fallback.json');
  let data = {
    visitors: [],
    conversations: [],
    messages: [],
    appointments: [],
    admins: []
  };

  if (fs.existsSync(storeFile)) {
    try {
      data = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
      if (!Array.isArray(data.visitors)) data.visitors = [];
      if (!Array.isArray(data.conversations)) data.conversations = [];
      if (!Array.isArray(data.messages)) data.messages = [];
      if (!Array.isArray(data.appointments)) data.appointments = [];
      if (!Array.isArray(data.admins)) data.admins = [];
    } catch (e) {}
  }

  function save() {
    try {
      fs.writeFileSync(storeFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}
  }

  return {
    exec(sql) {},
    prepare(sql) {
      const s = sql.trim().replace(/\s+/g, ' ');
      return {
        get(...params) {
          if (s.includes('FROM admins WHERE email = ?')) {
            return data.admins.find(a => a.email.toLowerCase() === (params[0] || '').toLowerCase()) || null;
          }
          if (s.includes('FROM admins WHERE id = ?')) {
            return data.admins.find(a => a.id === params[0]) || null;
          }
          if (s.includes('FROM visitors WHERE visitor_token = ?')) {
            return data.visitors.find(v => v.visitor_token === params[0]) || null;
          }
          if (s.includes('FROM visitors WHERE id = ?')) {
            return data.visitors.find(v => v.id === params[0]) || null;
          }
          if (s.includes('FROM conversations WHERE visitor_id = ?')) {
            const list = data.conversations.filter(c => c.visitor_id === params[0])
              .sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
            return list[0] || null;
          }
          if (s.includes('FROM conversations c JOIN visitors v') && s.includes('WHERE c.id = ? AND c.visitor_id = ?')) {
            const conv = data.conversations.find(c => c.id === params[0] && c.visitor_id === params[1]);
            if (!conv) return null;
            const vis = data.visitors.find(v => v.id === conv.visitor_id) || {};
            return { ...conv, visitor_name: vis.username, visitor_phone: vis.phone, visitor_age: vis.age };
          }
          if (s.includes('FROM conversations c JOIN visitors v') && s.includes('WHERE c.visitor_id = ?')) {
            const list = data.conversations.filter(c => c.visitor_id === params[0])
              .sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
            if (!list[0]) return null;
            const conv = list[0];
            const vis = data.visitors.find(v => v.id === conv.visitor_id) || {};
            return { ...conv, visitor_name: vis.username, visitor_phone: vis.phone, visitor_age: vis.age };
          }
          if (s.includes('FROM conversations c JOIN visitors v') && s.includes('WHERE c.id = ?')) {
            const conv = data.conversations.find(c => c.id === params[0]);
            if (!conv) return null;
            const vis = data.visitors.find(v => v.id === conv.visitor_id) || {};
            return { ...conv, visitor_name: vis.username, visitor_phone: vis.phone, visitor_age: vis.age };
          }
          if (s.includes('FROM conversations WHERE id = ?')) {
            return data.conversations.find(c => c.id === params[0]) || null;
          }
          if (s.includes('FROM appointments WHERE id = ?')) {
            return data.appointments.find(a => a.id === params[0]) || null;
          }
          if (s.includes('COUNT(*) as total_conversations')) {
            return {
              total_conversations: data.conversations.length,
              unread_messages: data.messages.filter(m => m.sender_type === 'visitor' && !m.read_at).length,
              total_appointments: data.appointments.length,
              pending_appointments: data.appointments.filter(a => a.status === 'pending').length
            };
          }
          return null;
        },
        all(...params) {
          if (s.includes('FROM messages WHERE conversation_id = ?')) {
            return data.messages.filter(m => m.conversation_id === params[0])
              .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          }
          if (s.includes('FROM appointments')) {
            let list = [...data.appointments];
            if (params.length > 0 && params[0] && params[0] !== 'all') {
              list = list.filter(a => a.status === params[0] || a.conversation_id === params[0]);
            }
            return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          }
          if (s.includes('FROM conversations c JOIN visitors v')) {
            let list = data.conversations.map(c => {
              const vis = data.visitors.find(v => v.id === c.visitor_id) || {};
              const cMsgs = data.messages.filter(m => m.conversation_id === c.id)
                .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
              const lastMsg = cMsgs[cMsgs.length - 1];
              const unread = cMsgs.filter(m => m.sender_type === 'visitor' && !m.read_at).length;
              return {
                ...c,
                visitor_name: vis.username || 'Visitor',
                visitor_phone: vis.phone || '',
                visitor_age: vis.age || null,
                last_message_text: lastMsg ? lastMsg.message_text : '',
                last_message_sender: lastMsg ? lastMsg.sender_type : '',
                unread_count: unread
              };
            });
            if (params.length > 0 && typeof params[0] === 'string' && !params[0].startsWith('%')) {
              list = list.filter(c => c.status === params[0]);
            }
            const searchParam = params.find(p => typeof p === 'string' && p.startsWith('%'));
            if (searchParam) {
              const term = searchParam.replace(/%/g, '').toLowerCase();
              list = list.filter(c => 
                (c.visitor_name && c.visitor_name.toLowerCase().includes(term)) ||
                (c.visitor_phone && c.visitor_phone.includes(term)) ||
                (c.last_message_text && c.last_message_text.toLowerCase().includes(term))
              );
            }
            return list.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
          }
          return [];
        },
        run(...params) {
          if (s.includes('INSERT INTO admins')) {
            const [id, email, password_hash, name, role] = params;
            data.admins.push({ id, email, password_hash, name, role: role || 'admin', created_at: new Date().toISOString() });
            save();
            return { changes: 1 };
          }
          if (s.includes('INSERT INTO visitors')) {
            const [id, username, age, phone, visitor_token, created_at, updated_at] = params;
            data.visitors.push({ id, username, age, phone, visitor_token, created_at, updated_at });
            save();
            return { changes: 1 };
          }
          if (s.includes('UPDATE visitors SET username = ?')) {
            const [username, age, phone, id] = params;
            const vis = data.visitors.find(v => v.id === id);
            if (vis) {
              vis.username = username;
              vis.age = age;
              vis.phone = phone;
              vis.updated_at = new Date().toISOString();
            }
            save();
            return { changes: 1 };
          }
          if (s.includes('INSERT INTO conversations')) {
            const [id, visitor_id, created_at, updated_at, last_message_at] = params;
            data.conversations.push({
              id,
              visitor_id,
              status: 'new',
              admin_notes: '',
              created_at,
              updated_at,
              last_message_at
            });
            save();
            return { changes: 1 };
          }
          if (s.includes('UPDATE conversations SET status = ?')) {
            const [status, updated_at, id] = params;
            const conv = data.conversations.find(c => c.id === id);
            if (conv) {
              conv.status = status;
              conv.updated_at = updated_at;
            }
            save();
            return { changes: 1 };
          }
          if (s.includes('UPDATE conversations SET admin_notes = ?')) {
            const [notes, updated_at, id] = params;
            const conv = data.conversations.find(c => c.id === id);
            if (conv) {
              conv.admin_notes = notes;
              conv.updated_at = updated_at;
            }
            save();
            return { changes: 1 };
          }
          if (s.includes('UPDATE conversations SET last_message_at = ?')) {
            const [last_message_at, updated_at, id] = params;
            const conv = data.conversations.find(c => c.id === id);
            if (conv) {
              conv.last_message_at = last_message_at;
              conv.updated_at = updated_at;
            }
            save();
            return { changes: 1 };
          }
          if (s.includes('INSERT INTO messages')) {
            const [id, conversation_id, sender_type, sender_name, message_text, delivery_status, created_at] = params;
            data.messages.push({
              id,
              conversation_id,
              sender_type,
              sender_name,
              message_text,
              delivery_status: delivery_status || 'sent',
              created_at,
              read_at: null
            });
            save();
            return { changes: 1 };
          }
          if (s.includes("UPDATE messages SET delivery_status = 'read'")) {
            const [read_at, conversation_id, sender_type] = params;
            data.messages.forEach(m => {
              if (m.conversation_id === conversation_id && m.sender_type === sender_type && !m.read_at) {
                m.delivery_status = 'read';
                m.read_at = read_at;
              }
            });
            save();
            return { changes: 1 };
          }
          if (s.includes('INSERT INTO appointments')) {
            const [id, visitor_id, conversation_id, patient_name, patient_age, phone, appointment_date, preferred_time, reason_for_visit, status, created_at] = params;
            data.appointments.push({
              id,
              visitor_id,
              conversation_id,
              patient_name,
              patient_age,
              phone,
              appointment_date,
              preferred_time,
              reason_for_visit,
              status: status || 'pending',
              created_at
            });
            save();
            return { changes: 1 };
          }
          if (s.includes('UPDATE appointments SET status = ? WHERE id = ?')) {
            const [status, id] = params;
            const appt = data.appointments.find(a => a.id === id);
            if (appt) {
              appt.status = status;
            }
            save();
            return { changes: 1 };
          }
          return { changes: 0 };
        }
      };
    }
  };
}

let db;
if (DatabaseSync) {
  try {
    db = new DatabaseSync(DB_PATH);
  } catch (err) {
    console.warn('[Database] Could not initialize DatabaseSync, using fallback:', err.message);
    db = createFallbackDb();
  }
} else {
  db = createFallbackDb();
}

// Optional Supabase client initialization
let supabase = null;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (supabaseUrl && supabaseKey) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[Database] Supabase integration initialized successfully:', supabaseUrl);
  } catch (err) {
    console.warn('[Database] Supabase init warning:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- 1. Visitors Table
  CREATE TABLE IF NOT EXISTS visitors (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    age INTEGER NOT NULL,
    phone TEXT,
    visitor_token TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- 2. Conversations Table
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    status TEXT DEFAULT 'new', -- 'new', 'open', 'resolved'
    admin_notes TEXT DEFAULT '',
    last_message_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
  );

  -- 3. Messages Table (sender_type: 'visitor', 'admin', 'AI')
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_type TEXT NOT NULL, -- 'visitor', 'admin', 'AI'
    sender_name TEXT DEFAULT '',
    message_text TEXT NOT NULL,
    delivery_status TEXT DEFAULT 'sent', -- 'sent', 'delivered', 'read'
    created_at TEXT DEFAULT (datetime('now')),
    read_at TEXT,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  -- 4. Appointments Table
  CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    conversation_id TEXT,
    patient_name TEXT NOT NULL,
    patient_age INTEGER,
    phone TEXT NOT NULL,
    appointment_date TEXT NOT NULL,
    preferred_time TEXT NOT NULL,
    reason_for_visit TEXT DEFAULT '',
    status TEXT DEFAULT 'pending', -- 'pending', 'confirmed', 'cancelled', 'completed'
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
  );

  -- 5. Admins Table
  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_vis_token ON visitors(visitor_token);
  CREATE INDEX IF NOT EXISTS idx_conv_vis ON conversations(visitor_id);
  CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status);
  CREATE INDEX IF NOT EXISTS idx_conv_last_msg ON conversations(last_message_at DESC);
  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_msg_created ON messages(created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_appt_vis ON appointments(visitor_id);
  CREATE INDEX IF NOT EXISTS idx_appt_status ON appointments(status);
  CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(appointment_date);
`);

// Seed default administrator if not present
const defaultAdminEmail = process.env.ADMIN_EMAIL || 'admin@doctor.com';
const defaultAdminPassword = process.env.ADMIN_PASSWORD || 'DoctorCare@2026';
const defaultAdminName = process.env.ADMIN_NAME || 'Dr. John Smith Team';

const existingAdmin = db.prepare('SELECT id FROM admins WHERE email = ?').get(defaultAdminEmail);
if (!existingAdmin) {
  const adminId = 'admin_' + crypto.randomUUID();
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(defaultAdminPassword, salt);
  db.prepare(`
    INSERT INTO admins (id, email, password_hash, name, role)
    VALUES (?, ?, ?, ?, 'admin')
  `).run(adminId, defaultAdminEmail, hash, defaultAdminName);
  console.log(`[Database] Seeded initial admin account: ${defaultAdminEmail}`);
}

const DB = {
  // ── VISITOR REGISTRATION & LOOKUP ──────────────────────────────────────────
  registerVisitor({ username, age, phone = '', existingToken = null }) {
    if (!username || !username.trim()) {
      throw new Error('Name/Username is required.');
    }
    const parsedAge = parseInt(age, 10);
    if (isNaN(parsedAge) || parsedAge < 1 || parsedAge > 120) {
      throw new Error('Please enter a valid age between 1 and 120.');
    }

    const cleanName = username.trim();
    const cleanPhone = phone ? phone.trim() : '';

    // If an existing token is provided and valid, update the visitor profile
    if (existingToken) {
      const existing = db.prepare('SELECT * FROM visitors WHERE visitor_token = ?').get(existingToken);
      if (existing) {
        db.prepare(`
          UPDATE visitors
          SET username = ?, age = ?, phone = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(cleanName, parsedAge, cleanPhone, existing.id);

        const updatedVisitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(existing.id);

        // Optional Supabase sync
        if (supabase) {
          supabase.from('visitors').upsert({
            id: updatedVisitor.id,
            username: updatedVisitor.username,
            age: updatedVisitor.age,
            phone: updatedVisitor.phone,
            updated_at: new Date().toISOString()
          }).then(() => {}).catch(e => console.warn('[Supabase Sync]:', e.message));
        }

        return updatedVisitor;
      }
    }

    // Create new visitor profile
    const id = 'vis_' + crypto.randomUUID();
    const token = 'tok_' + crypto.randomBytes(24).toString('hex');
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    db.prepare(`
      INSERT INTO visitors (id, username, age, phone, visitor_token, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, cleanName, parsedAge, cleanPhone, token, now, now);

    const visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(id);

    // Optional Supabase sync
    if (supabase) {
      supabase.from('visitors').insert({
        id: visitor.id,
        username: visitor.username,
        age: visitor.age,
        phone: visitor.phone,
        created_at: new Date().toISOString()
      }).then(() => {}).catch(e => console.warn('[Supabase Sync]:', e.message));
    }

    return visitor;
  },

  getVisitorById(id) {
    return db.prepare('SELECT * FROM visitors WHERE id = ?').get(id);
  },

  getVisitorByToken(token) {
    if (!token) return null;
    return db.prepare('SELECT * FROM visitors WHERE visitor_token = ?').get(token);
  },

  // ── CONVERSATIONS ──────────────────────────────────────────────────────────
  getOrCreateConversation(visitorId) {
    if (!visitorId) throw new Error('visitorId required');

    const existing = db.prepare(`
      SELECT * FROM conversations
      WHERE visitor_id = ?
      ORDER BY last_message_at DESC
      LIMIT 1
    `).get(visitorId);

    if (existing) {
      return existing;
    }

    const id = 'conv_' + crypto.randomUUID();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    db.prepare(`
      INSERT INTO conversations (id, visitor_id, status, created_at, updated_at, last_message_at)
      VALUES (?, ?, 'new', ?, ?, ?)
    `).run(id, visitorId, now, now, now);

    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);

    if (supabase) {
      supabase.from('conversations').insert({
        id: conv.id,
        visitor_id: conv.visitor_id,
        status: conv.status,
        created_at: new Date().toISOString()
      }).then(() => {}).catch(e => console.warn('[Supabase Sync]:', e.message));
    }

    return conv;
  },

  getConversationById(id) {
    return db.prepare(`
      SELECT c.*, v.username as visitor_name, v.phone as visitor_phone, v.age as visitor_age
      FROM conversations c
      JOIN visitors v ON c.visitor_id = v.id
      WHERE c.id = ?
    `).get(id);
  },

  getConversationForVisitor(visitorId, conversationId = null) {
    if (conversationId) {
      return db.prepare(`
        SELECT c.*, v.username as visitor_name, v.phone as visitor_phone, v.age as visitor_age
        FROM conversations c
        JOIN visitors v ON c.visitor_id = v.id
        WHERE c.id = ? AND c.visitor_id = ?
      `).get(conversationId, visitorId);
    }
    return db.prepare(`
      SELECT c.*, v.username as visitor_name, v.phone as visitor_phone, v.age as visitor_age
      FROM conversations c
      JOIN visitors v ON c.visitor_id = v.id
      WHERE c.visitor_id = ?
      ORDER BY c.last_message_at DESC
      LIMIT 1
    `).get(visitorId);
  },

  listConversations({ status = 'all', search = '' } = {}) {
    let query = `
      SELECT 
        c.*,
        v.username as visitor_name,
        v.phone as visitor_phone,
        v.age as visitor_age,
        (
          SELECT message_text FROM messages 
          WHERE conversation_id = c.id 
          ORDER BY created_at DESC LIMIT 1
        ) as last_message_text,
        (
          SELECT sender_type FROM messages 
          WHERE conversation_id = c.id 
          ORDER BY created_at DESC LIMIT 1
        ) as last_message_sender,
        (
          SELECT COUNT(*) FROM messages 
          WHERE conversation_id = c.id 
          AND sender_type = 'visitor' 
          AND read_at IS NULL
        ) as unread_count
      FROM conversations c
      JOIN visitors v ON c.visitor_id = v.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      if (status === 'unread') {
        query += ` AND (
          SELECT COUNT(*) FROM messages 
          WHERE conversation_id = c.id 
          AND sender_type = 'visitor' 
          AND read_at IS NULL
        ) > 0 `;
      } else {
        query += ` AND c.status = ? `;
        params.push(status);
      }
    }

    if (search && search.trim()) {
      const searchTerm = `%${search.trim().toLowerCase()}%`;
      query += ` AND (
        LOWER(v.username) LIKE ? OR 
        LOWER(v.phone) LIKE ? OR
        LOWER(c.id) LIKE ? OR
        EXISTS (
          SELECT 1 FROM messages m 
          WHERE m.conversation_id = c.id 
          AND LOWER(m.message_text) LIKE ?
        )
      ) `;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    query += ` ORDER BY c.last_message_at DESC`;

    return db.prepare(query).all(...params);
  },

  updateConversationStatus(conversationId, status) {
    const valid = ['new', 'open', 'resolved'];
    if (!valid.includes(status)) {
      throw new Error(`Invalid status. Allowed: ${valid.join(', ')}`);
    }
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    db.prepare(`
      UPDATE conversations
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(status, now, conversationId);

    if (supabase) {
      supabase.from('conversations').update({ status, updated_at: new Date().toISOString() })
        .eq('id', conversationId)
        .then(() => {}).catch(e => console.warn('[Supabase Sync]:', e.message));
    }

    return this.getConversationById(conversationId);
  },

  updateAdminNotes(conversationId, notes) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    db.prepare(`
      UPDATE conversations
      SET admin_notes = ?, updated_at = ?
      WHERE id = ?
    `).run(notes || '', now, conversationId);

    return this.getConversationById(conversationId);
  },

  // ── MESSAGES ───────────────────────────────────────────────────────────────
  addMessage({ conversationId, senderType, senderName = '', messageText }) {
    if (!conversationId || !senderType || !messageText || !messageText.trim()) {
      throw new Error('conversationId, senderType, and messageText are required');
    }

    // senderType can be: 'visitor', 'admin', 'AI'
    const cleanText = messageText.trim();
    const id = 'msg_' + crypto.randomUUID();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_type, sender_name, message_text, delivery_status, created_at)
      VALUES (?, ?, ?, ?, ?, 'delivered', ?)
    `).run(id, conversationId, senderType, senderName, cleanText, now);

    // Update conversation last_message_at and auto-status
    const conv = db.prepare('SELECT status FROM conversations WHERE id = ?').get(conversationId);
    let nextStatus = conv ? conv.status : 'new';
    if (senderType === 'visitor') {
      if (nextStatus === 'resolved') nextStatus = 'open';
    } else if (senderType === 'admin') {
      if (nextStatus === 'new') nextStatus = 'open';
    }

    db.prepare(`
      UPDATE conversations 
      SET last_message_at = ?, updated_at = ?, status = ?
      WHERE id = ?
    `).run(now, now, nextStatus, conversationId);

    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);

    if (supabase) {
      supabase.from('messages').insert({
        id: msg.id,
        conversation_id: msg.conversation_id,
        sender_type: msg.sender_type,
        sender_name: msg.sender_name,
        message_text: msg.message_text,
        delivery_status: msg.delivery_status,
        created_at: new Date().toISOString()
      }).then(() => {}).catch(e => console.warn('[Supabase Sync]:', e.message));
    }

    return msg;
  },

  getMessages(conversationId) {
    return db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(conversationId);
  },

  markConversationRead(conversationId, readerType = 'admin') {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    if (readerType === 'admin') {
      db.prepare(`
        UPDATE messages
        SET read_at = ?, delivery_status = 'read'
        WHERE conversation_id = ? AND sender_type = 'visitor' AND read_at IS NULL
      `).run(now, conversationId);
    } else {
      db.prepare(`
        UPDATE messages
        SET read_at = ?, delivery_status = 'read'
        WHERE conversation_id = ? AND (sender_type = 'admin' OR sender_type = 'AI') AND read_at IS NULL
      `).run(now, conversationId);
    }
  },

  // ── APPOINTMENTS ───────────────────────────────────────────────────────────
  createAppointment({
    visitorId,
    conversationId = null,
    patientName,
    patientAge = null,
    phone,
    appointmentDate,
    preferredTime,
    reasonForVisit = '',
    status = 'pending'
  }) {
    if (!visitorId || !patientName || !phone || !appointmentDate || !preferredTime) {
      throw new Error('visitorId, patientName, phone, appointmentDate, and preferredTime are required.');
    }

    const id = 'appt_' + crypto.randomUUID();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    db.prepare(`
      INSERT INTO appointments (
        id, visitor_id, conversation_id, patient_name, patient_age, phone,
        appointment_date, preferred_time, reason_for_visit, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, visitorId, conversationId, patientName.trim(), patientAge || null,
      phone.trim(), appointmentDate.trim(), preferredTime.trim(),
      reasonForVisit ? reasonForVisit.trim() : '', status, now
    );

    const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);

    if (supabase) {
      supabase.from('appointments').insert({
        id: appt.id,
        visitor_id: appt.visitor_id,
        conversation_id: appt.conversation_id,
        patient_name: appt.patient_name,
        patient_age: appt.patient_age,
        phone: appt.phone,
        appointment_date: appt.appointment_date,
        preferred_time: appt.preferred_time,
        reason_for_visit: appt.reason_for_visit,
        status: appt.status,
        created_at: new Date().toISOString()
      }).then(() => {}).catch(e => console.warn('[Supabase Sync]:', e.message));
    }

    return appt;
  },

  listAppointments({ status = 'all' } = {}) {
    let query = `
      SELECT a.*, v.username as visitor_username, v.age as visitor_profile_age
      FROM appointments a
      JOIN visitors v ON a.visitor_id = v.id
    `;
    const params = [];
    if (status && status !== 'all') {
      query += ` WHERE a.status = ? `;
      params.push(status);
    }
    query += ` ORDER BY a.appointment_date ASC, a.created_at DESC`;

    return db.prepare(query).all(...params);
  },

  getAppointmentsForConversation(conversationId) {
    return db.prepare(`
      SELECT * FROM appointments
      WHERE conversation_id = ?
      ORDER BY created_at DESC
    `).all(conversationId);
  },

  updateAppointmentStatus(id, status) {
    const valid = ['pending', 'confirmed', 'cancelled', 'completed'];
    if (!valid.includes(status)) {
      throw new Error(`Invalid appointment status. Allowed: ${valid.join(', ')}`);
    }
    db.prepare(`
      UPDATE appointments
      SET status = ?
      WHERE id = ?
    `).run(status, id);

    if (supabase) {
      supabase.from('appointments').update({ status }).eq('id', id)
        .then(() => {}).catch(e => console.warn('[Supabase Sync]:', e.message));
    }

    return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  },

  // ── ADMIN AUTH ─────────────────────────────────────────────────────────────
  getAdminByEmail(email) {
    return db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  },

  getAdminById(id) {
    return db.prepare('SELECT id, email, name, role, created_at FROM admins WHERE id = ?').get(id);
  },

  getStats() {
    const totalConversations = db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
    const unread = db.prepare(`
      SELECT COUNT(DISTINCT conversation_id) as count 
      FROM messages 
      WHERE sender_type = 'visitor' AND read_at IS NULL
    `).get().count;
    const open = db.prepare("SELECT COUNT(*) as count FROM conversations WHERE status = 'open'").get().count;
    const resolved = db.prepare("SELECT COUNT(*) as count FROM conversations WHERE status = 'resolved'").get().count;
    const totalAppointments = db.prepare('SELECT COUNT(*) as count FROM appointments').get().count;
    const pendingAppointments = db.prepare("SELECT COUNT(*) as count FROM appointments WHERE status = 'pending'").get().count;

    return {
      total: totalConversations,
      unread,
      open,
      resolved,
      appointmentsTotal: totalAppointments,
      appointmentsPending: pendingAppointments
    };
  }
};

module.exports = DB;
