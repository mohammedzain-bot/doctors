'use strict';

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'enquiries.db');
const db = new DatabaseSync(DB_PATH);

// Initialize tables
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    visitor_token TEXT NOT NULL,
    visitor_name TEXT DEFAULT '',
    visitor_phone TEXT DEFAULT '',
    status TEXT DEFAULT 'new',
    admin_notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    last_message_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_type TEXT NOT NULL,
    sender_name TEXT DEFAULT '',
    message_text TEXT NOT NULL,
    delivery_status TEXT DEFAULT 'sent',
    created_at TEXT DEFAULT (datetime('now')),
    read_at TEXT,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_conv_visitor ON conversations(visitor_id);
  CREATE INDEX IF NOT EXISTS idx_conv_token ON conversations(visitor_token);
  CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status);
  CREATE INDEX IF NOT EXISTS idx_conv_last_msg ON conversations(last_message_at DESC);
  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_msg_created ON messages(created_at ASC);
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
  // --- Admin Queries ---
  getAdminByEmail(email) {
    return db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  },

  getAdminById(id) {
    return db.prepare('SELECT id, email, name, role, created_at FROM admins WHERE id = ?').get(id);
  },

  // --- Visitor & Conversation Queries ---
  getOrCreateConversation({ visitorId, visitorToken, visitorName = '', visitorPhone = '' }) {
    if (!visitorId || !visitorToken) {
      throw new Error('visitorId and visitorToken are required');
    }

    // Look for existing conversation by visitorToken or visitorId
    const existing = db.prepare(`
      SELECT * FROM conversations
      WHERE visitor_token = ? OR visitor_id = ?
      ORDER BY last_message_at DESC
      LIMIT 1
    `).get(visitorToken, visitorId);

    if (existing) {
      // Update name/phone if provided and previously blank
      let nameToUpdate = existing.visitor_name;
      let phoneToUpdate = existing.visitor_phone;
      let updated = false;

      if (visitorName && visitorName.trim() && visitorName.trim() !== existing.visitor_name) {
        nameToUpdate = visitorName.trim();
        updated = true;
      }
      if (visitorPhone && visitorPhone.trim() && visitorPhone.trim() !== existing.visitor_phone) {
        phoneToUpdate = visitorPhone.trim();
        updated = true;
      }

      if (updated) {
        db.prepare(`
          UPDATE conversations
          SET visitor_name = ?, visitor_phone = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(nameToUpdate, phoneToUpdate, existing.id);
        existing.visitor_name = nameToUpdate;
        existing.visitor_phone = phoneToUpdate;
      }

      return existing;
    }

    // Create new conversation
    const id = 'conv_' + crypto.randomUUID();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    db.prepare(`
      INSERT INTO conversations (id, visitor_id, visitor_token, visitor_name, visitor_phone, status, created_at, updated_at, last_message_at)
      VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?)
    `).run(id, visitorId, visitorToken, visitorName.trim(), visitorPhone.trim(), now, now, now);

    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  },

  getConversationById(id) {
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  },

  getConversationByToken(id, token) {
    return db.prepare('SELECT * FROM conversations WHERE id = ? AND visitor_token = ?').get(id, token);
  },

  listConversations({ status = 'all', search = '' } = {}) {
    let query = `
      SELECT 
        c.*,
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
        LOWER(c.visitor_name) LIKE ? OR 
        LOWER(c.visitor_phone) LIKE ? OR
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

  // --- Messages Queries ---
  addMessage({ conversationId, senderType, senderName = '', messageText }) {
    if (!conversationId || !senderType || !messageText || !messageText.trim()) {
      throw new Error('conversationId, senderType, and non-empty messageText are required');
    }

    const cleanText = messageText.trim();
    const id = 'msg_' + crypto.randomUUID();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_type, sender_name, message_text, delivery_status, created_at)
      VALUES (?, ?, ?, ?, ?, 'delivered', ?)
    `).run(id, conversationId, senderType, senderName, cleanText, now);

    // Update conversation last_message_at and status
    // If visitor sends a message to a resolved conversation, automatically reopen it to 'open'
    const conv = db.prepare('SELECT status FROM conversations WHERE id = ?').get(conversationId);
    let nextStatus = conv ? conv.status : 'new';
    if (senderType === 'visitor') {
      if (nextStatus === 'resolved') {
        nextStatus = 'open';
      } else if (nextStatus === 'new') {
        // remains new or open
      }
    } else if (senderType === 'admin') {
      if (nextStatus === 'new') {
        nextStatus = 'open';
      }
    }

    db.prepare(`
      UPDATE conversations 
      SET last_message_at = ?, updated_at = ?, status = ?
      WHERE id = ?
    `).run(now, now, nextStatus, conversationId);

    return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
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
      // Admin reads visitor's messages
      db.prepare(`
        UPDATE messages
        SET read_at = ?, delivery_status = 'read'
        WHERE conversation_id = ? AND sender_type = 'visitor' AND read_at IS NULL
      `).run(now, conversationId);
    } else {
      // Visitor reads admin's messages
      db.prepare(`
        UPDATE messages
        SET read_at = ?, delivery_status = 'read'
        WHERE conversation_id = ? AND sender_type = 'admin' AND read_at IS NULL
      `).run(now, conversationId);
    }
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

    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
  },

  updateAdminNotes(conversationId, notes) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    db.prepare(`
      UPDATE conversations
      SET admin_notes = ?, updated_at = ?
      WHERE id = ?
    `).run(notes || '', now, conversationId);

    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
  },

  updateVisitorDetails(conversationId, { name, phone }) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    db.prepare(`
      UPDATE conversations
      SET visitor_name = COALESCE(?, visitor_name),
          visitor_phone = COALESCE(?, visitor_phone),
          updated_at = ?
      WHERE id = ?
    `).run(name !== undefined ? name : null, phone !== undefined ? phone : null, now, conversationId);

    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
  },

  getStats() {
    const total = db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
    const unread = db.prepare(`
      SELECT COUNT(DISTINCT conversation_id) as count 
      FROM messages 
      WHERE sender_type = 'visitor' AND read_at IS NULL
    `).get().count;
    const open = db.prepare("SELECT COUNT(*) as count FROM conversations WHERE status = 'open'").get().count;
    const resolved = db.prepare("SELECT COUNT(*) as count FROM conversations WHERE status = 'resolved'").get().count;

    return { total, unread, open, resolved };
  }
};

module.exports = DB;
