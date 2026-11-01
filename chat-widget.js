/**
 * DR. JOHN SMITH · REAL-TIME VISITOR ENQUIRY CHAT CLIENT
 * Connects securely to backend WebSocket & REST API with visitor token isolation.
 */
(function() {
  'use strict';

  // State
  let state = {
    isOpen: false,
    visitorId: localStorage.getItem('doc_visitor_id') || '',
    visitorToken: localStorage.getItem('doc_visitor_token') || '',
    conversationId: localStorage.getItem('doc_conv_id') || '',
    visitorName: localStorage.getItem('doc_visitor_name') || '',
    visitorPhone: localStorage.getItem('doc_visitor_phone') || '',
    unreadCount: 0,
    ws: null,
    wsConnected: false,
    reconnectTimer: null,
    typingTimer: null,
    isTyping: false
  };

  // Web Audio subtle chime for messages
  function playNotificationChime() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch (e) {
      // Audio autoplay policy safe
    }
  }

  // Inject UI Markup
  function injectUI() {
    if (document.getElementById('doc-chat-root')) return;

    const root = document.createElement('div');
    root.id = 'doc-chat-root';
    root.innerHTML = `
      <!-- Floating Trigger Button -->
      <button class="doc-chat-trigger" id="docChatTrigger" aria-label="Open Medical Enquiry Chat" title="Consult with Dr. Smith's Team">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <div class="doc-chat-pulse"></div>
        <div class="doc-chat-badge" id="docChatBadge" style="display:none;">0</div>
      </button>

      <!-- Chat Panel -->
      <div class="doc-chat-window" id="docChatWindow" role="dialog" aria-modal="true" aria-label="Doctor Enquiry Chat">
        <!-- Header -->
        <div class="doc-chat-header">
          <div class="doc-chat-head-profile">
            <div class="doc-chat-avatar">
              JS
              <div class="doc-chat-avatar-dot" title="Clinic online"></div>
            </div>
            <div class="doc-chat-head-info">
              <span class="doc-chat-head-name">
                Dr. John Smith
                <svg class="doc-chat-verified" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
              </span>
              <span class="doc-chat-head-title">
                Cardiology · <span class="doc-chat-status-text" id="docChatConnStatus">Direct Enquiry</span>
              </span>
            </div>
          </div>
          <button class="doc-chat-close-btn" id="docChatCloseBtn" aria-label="Close Chat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <!-- Privacy & Emergency Notice -->
        <div class="doc-chat-notice">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>Confidential Enquiry · Not for emergencies. In acute emergencies, call 112.</span>
        </div>

        <!-- Visitor Contact Strip -->
        <div class="doc-chat-profile-strip">
          <span class="doc-chat-profile-tag" id="docProfileTag">
            Visitor: <strong>${escapeHTML(state.visitorName || 'Anonymous')}</strong>
          </span>
          <button class="doc-chat-profile-btn" id="docProfileToggleBtn">Edit Details</button>
        </div>

        <!-- Optional Details Edit Drawer -->
        <div class="doc-chat-profile-drawer" id="docProfileDrawer">
          <div class="doc-chat-drawer-inputs">
            <input type="text" id="docVisitorNameInput" class="doc-chat-input-sm" placeholder="Your name (optional)" value="${escapeHTML(state.visitorName)}" />
            <input type="tel" id="docVisitorPhoneInput" class="doc-chat-input-sm" placeholder="Mobile number" value="${escapeHTML(state.visitorPhone)}" />
          </div>
          <div class="doc-chat-drawer-actions">
            <button class="doc-chat-btn-xs doc-chat-btn-cancel" id="docProfileCancelBtn">Cancel</button>
            <button class="doc-chat-btn-xs doc-chat-btn-save" id="docProfileSaveBtn">Save</button>
          </div>
        </div>

        <!-- Messages Stream -->
        <div class="doc-chat-messages" id="docChatMessages">
          <div class="doc-chat-welcome">
            <div class="doc-chat-welcome-title">Welcome to Dr. Smith's Practice</div>
            <div class="doc-chat-welcome-desc">
              Have a clinical question, consultation enquiry, or want to schedule an appointment? Send a message below and our team will assist you.
            </div>
            <div class="doc-chat-chips">
              <button class="doc-chat-chip" data-msg="I want to book an appointment.">📅 Book Appointment</button>
              <button class="doc-chat-chip" data-msg="What are your consultation hours?">🕒 Consultation Hours</button>
              <button class="doc-chat-chip" data-msg="Where is your clinic located?">📍 Clinic Location</button>
              <button class="doc-chat-chip" data-msg="I would like more information about your cardiac services.">❤️ Cardiac Services</button>
            </div>
          </div>
        </div>

        <!-- Typing Indicator -->
        <div class="doc-chat-typing" id="docChatTyping">
          <span style="font-size:11px;color:#A8B7C2;margin-right:4px;">Dr. Smith's team is typing</span>
          <div class="doc-chat-dot"></div>
          <div class="doc-chat-dot"></div>
          <div class="doc-chat-dot"></div>
        </div>

        <!-- Message Composer -->
        <div class="doc-chat-composer">
          <textarea
            class="doc-chat-textarea"
            id="docChatInput"
            placeholder="Type your message or enquiry..."
            rows="1"
          ></textarea>
          <button class="doc-chat-send-btn" id="docChatSendBtn" aria-label="Send message" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    setupEvents();
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // --- API & State Handling ---
  async function initSession() {
    try {
      const res = await fetch('/api/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId: state.visitorId || undefined,
          visitorToken: state.visitorToken || undefined,
          visitorName: state.visitorName || undefined,
          visitorPhone: state.visitorPhone || undefined
        })
      });

      if (!res.ok) throw new Error('Session initialization failed');
      const data = await res.json();

      state.visitorId = data.visitorId;
      state.visitorToken = data.visitorToken;
      state.conversationId = data.conversationId;
      state.visitorName = data.visitorName || state.visitorName;
      state.visitorPhone = data.visitorPhone || state.visitorPhone;

      localStorage.setItem('doc_visitor_id', state.visitorId);
      localStorage.setItem('doc_visitor_token', state.visitorToken);
      localStorage.setItem('doc_conv_id', state.conversationId);
      if (state.visitorName) localStorage.setItem('doc_visitor_name', state.visitorName);
      if (state.visitorPhone) localStorage.setItem('doc_visitor_phone', state.visitorPhone);

      updateProfileTag();

      // Render historical messages
      if (data.messages && data.messages.length > 0) {
        renderMessages(data.messages);
      }

      // Connect WebSocket
      connectWebSocket();
    } catch (err) {
      console.warn('[Chat Widget] Running in offline / initial mode:', err.message);
    }
  }

  function connectWebSocket() {
    if (!state.conversationId || !state.visitorToken) return;
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      state.ws = ws;

      ws.onopen = () => {
        state.wsConnected = true;
        document.getElementById('docChatConnStatus').textContent = 'Online';
        // Authenticate visitor socket
        ws.send(JSON.stringify({
          action: 'auth_visitor',
          conversationId: state.conversationId,
          visitorToken: state.visitorToken
        }));
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          if (payload.event === 'new_message') {
            appendMessage(payload.message);
            if (payload.message.sender_type === 'admin') {
              playNotificationChime();
              if (!state.isOpen) {
                state.unreadCount++;
                updateBadge();
              }
            }
          } else if (payload.event === 'typing') {
            if (payload.senderType === 'admin') {
              toggleTyping(payload.isTyping);
            }
          } else if (payload.event === 'messages_read_by_admin') {
            markAllDeliveredAsRead();
          }
        } catch (e) {
          console.error('[Chat Widget] WS parse error:', e);
        }
      };

      ws.onclose = () => {
        state.wsConnected = false;
        document.getElementById('docChatConnStatus').textContent = 'Connecting...';
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = setTimeout(connectWebSocket, 4000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch (err) {
      console.error('[Chat Widget] WebSocket error:', err);
    }
  }

  function renderMessages(messages) {
    const container = document.getElementById('docChatMessages');
    if (!container) return;

    // Remove existing bubbles (preserve welcome card)
    container.querySelectorAll('.doc-chat-bubble-wrap, .doc-chat-date-divider').forEach(el => el.remove());

    messages.forEach(msg => appendMessage(msg, false));
    scrollToBottom();
  }

  function appendMessage(msg, scroll = true) {
    const container = document.getElementById('docChatMessages');
    if (!container) return;

    // Check if message already exists
    if (document.getElementById(`msg-${msg.id}`)) return;

    const wrap = document.createElement('div');
    wrap.className = `doc-chat-bubble-wrap ${msg.sender_type === 'visitor' ? 'is-visitor' : 'is-admin'}`;
    wrap.id = `msg-${msg.id}`;

    const senderLabel = msg.sender_type === 'visitor'
      ? ''
      : `<div class="doc-chat-bubble-sender">
          <span>Dr. John Smith</span>
         </div>`;

    const statusTick = msg.sender_type === 'visitor'
      ? `<span class="doc-chat-ticks">${msg.delivery_status === 'read' ? '✓✓' : '✓'}</span>`
      : '';

    wrap.innerHTML = `
      ${senderLabel}
      <div class="doc-chat-bubble">${escapeHTML(msg.message_text)}</div>
      <div class="doc-chat-bubble-meta">
        <span>${formatTime(msg.created_at)}</span>
        ${statusTick}
      </div>
    `;

    container.appendChild(wrap);
    if (scroll) scrollToBottom();
  }

  function markAllDeliveredAsRead() {
    document.querySelectorAll('.doc-chat-bubble-wrap.is-visitor .doc-chat-ticks').forEach(el => {
      el.textContent = '✓✓';
    });
  }

  function toggleTyping(show) {
    const el = document.getElementById('docChatTyping');
    if (el) {
      el.classList.toggle('is-visible', !!show);
      scrollToBottom();
    }
  }

  function scrollToBottom() {
    const container = document.getElementById('docChatMessages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function updateBadge() {
    const badge = document.getElementById('docChatBadge');
    if (!badge) return;
    if (state.unreadCount > 0) {
      badge.textContent = state.unreadCount > 9 ? '9+' : state.unreadCount;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  function updateProfileTag() {
    const tag = document.getElementById('docProfileTag');
    if (tag) {
      tag.innerHTML = `Visitor: <strong>${escapeHTML(state.visitorName || 'Anonymous')}</strong> ${state.visitorPhone ? '· ' + escapeHTML(state.visitorPhone) : ''}`;
    }
  }

  async function sendMessage(text) {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();

    const input = document.getElementById('docChatInput');
    const sendBtn = document.getElementById('docChatSendBtn');
    if (input) input.value = '';
    if (sendBtn) sendBtn.disabled = true;

    // Send stop typing
    sendTypingIndicator(false);

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: state.conversationId || undefined,
          visitorId: state.visitorId || undefined,
          visitorToken: state.visitorToken || undefined,
          messageText: cleanText,
          visitorName: state.visitorName || undefined,
          visitorPhone: state.visitorPhone || undefined
        })
      });

      if (!res.ok) throw new Error('Send failed');
      const data = await res.json();

      if (data.conversationId && data.conversationId !== state.conversationId) {
        state.conversationId = data.conversationId;
        state.visitorToken = data.visitorToken;
        localStorage.setItem('doc_conv_id', state.conversationId);
        localStorage.setItem('doc_visitor_token', state.visitorToken);
        connectWebSocket();
      }

      appendMessage(data.message);
    } catch (err) {
      console.error('[Chat Widget] Failed to send message:', err);
      // Fallback local bubble with error mark
      alert('Unable to connect to server. Please check your internet connection.');
    }
  }

  function sendTypingIndicator(isTyping) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN && state.conversationId) {
      state.ws.send(JSON.stringify({
        action: 'typing',
        conversationId: state.conversationId,
        visitorToken: state.visitorToken,
        isTyping: !!isTyping
      }));
    }
  }

  // --- Setup DOM Events ---
  function setupEvents() {
    const trigger = document.getElementById('docChatTrigger');
    const windowEl = document.getElementById('docChatWindow');
    const closeBtn = document.getElementById('docChatCloseBtn');
    const input = document.getElementById('docChatInput');
    const sendBtn = document.getElementById('docChatSendBtn');
    const profileToggleBtn = document.getElementById('docProfileToggleBtn');
    const profileDrawer = document.getElementById('docProfileDrawer');
    const profileCancelBtn = document.getElementById('docProfileCancelBtn');
    const profileSaveBtn = document.getElementById('docProfileSaveBtn');

    // Toggle open/close
    trigger.addEventListener('click', () => {
      state.isOpen = !state.isOpen;
      windowEl.classList.toggle('is-open', state.isOpen);
      if (state.isOpen) {
        state.unreadCount = 0;
        updateBadge();
        scrollToBottom();
        setTimeout(() => input.focus(), 250);
      }
    });

    closeBtn.addEventListener('click', () => {
      state.isOpen = false;
      windowEl.classList.remove('is-open');
    });

    // Textarea input & send button enable/disable
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
      sendBtn.disabled = !input.value.trim();

      // Trigger typing
      if (!state.isTyping) {
        state.isTyping = true;
        sendTypingIndicator(true);
      }
      clearTimeout(state.typingTimer);
      state.typingTimer = setTimeout(() => {
        state.isTyping = false;
        sendTypingIndicator(false);
      }, 1500);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (input.value.trim()) {
          sendMessage(input.value);
          input.style.height = '38px';
        }
      }
    });

    sendBtn.addEventListener('click', () => {
      if (input.value.trim()) {
        sendMessage(input.value);
        input.style.height = '38px';
      }
    });

    // Quick chips
    document.querySelectorAll('.doc-chat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const msg = chip.getAttribute('data-msg');
        sendMessage(msg);
      });
    });

    // Profile details drawer
    profileToggleBtn.addEventListener('click', () => {
      profileDrawer.classList.toggle('is-open');
    });

    profileCancelBtn.addEventListener('click', () => {
      profileDrawer.classList.remove('is-open');
    });

    profileSaveBtn.addEventListener('click', async () => {
      const nameInput = document.getElementById('docVisitorNameInput').value.trim();
      const phoneInput = document.getElementById('docVisitorPhoneInput').value.trim();

      state.visitorName = nameInput;
      state.visitorPhone = phoneInput;
      localStorage.setItem('doc_visitor_name', state.visitorName);
      localStorage.setItem('doc_visitor_phone', state.visitorPhone);

      updateProfileTag();
      profileDrawer.classList.remove('is-open');

      if (state.conversationId && state.visitorToken) {
        try {
          await fetch('/api/chat/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conversationId: state.conversationId,
              visitorToken: state.visitorToken,
              visitorName: state.visitorName,
              visitorPhone: state.visitorPhone
            })
          });
        } catch (e) {
          console.error('[Chat Widget] Profile update error:', e);
        }
      }
    });
  }

  // Self-start on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectUI();
      initSession();
    });
  } else {
    injectUI();
    initSession();
  }
})();
