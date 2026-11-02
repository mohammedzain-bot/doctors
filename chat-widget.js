/**
 * DR. JOHN SMITH · REAL-TIME VISITOR ENQUIRY & AI CHAT CLIENT
 * Features: Visitor Registration, Conversational AI Assistant,
 * Real-time WebSockets, and Automated Appointment Booking.
 */
(function() {
  'use strict';

  let state = {
    isOpen: false,
    isRegistered: false,
    visitor: null,
    visitorToken: localStorage.getItem('doc_visitor_token') || '',
    conversationId: localStorage.getItem('doc_conv_id') || '',
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

  // Inject UI Markup
  function injectUI() {
    if (document.getElementById('doc-chat-root')) return;

    const root = document.createElement('div');
    root.id = 'doc-chat-root';
    root.innerHTML = `
      <!-- Floating Trigger Button -->
      <button class="doc-chat-trigger" id="docChatTrigger" aria-label="Open Medical Enquiry Chat" title="Consult with Dr. Smith's AI Assistant">
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

        <!-- =================================================================
             1. VISITOR REGISTRATION VIEW (Shown before first chat)
             ================================================================= -->
        <div class="doc-chat-register-view" id="docChatRegisterView" style="display:none;">
          <div class="reg-card-header">
            <span class="reg-badge">Patient Intake</span>
            <h3 class="reg-title">Welcome to Dr. Smith's Practice</h3>
            <p class="reg-desc">Please introduce yourself before consulting Dr. Smith's clinic or booking an appointment.</p>
          </div>

          <form id="docRegForm" class="reg-form">
            <div class="reg-field">
              <label class="reg-label" for="regUsername">
                <span>Full Name</span>
              </label>
              <input type="text" id="regUsername" class="reg-input" placeholder="e.g. Rahul Sharma" required autocomplete="name" />
            </div>

            <div class="reg-field">
              <label class="reg-label" for="regAge">
                <span>Age</span>
              </label>
              <input type="number" id="regAge" class="reg-input" placeholder="e.g. 35" min="1" max="120" required />
            </div>

            <div class="reg-field">
              <label class="reg-label" for="regPhone">
                <span>Mobile Number</span>
                <span class="reg-label-opt">(Recommended for WhatsApp &amp; SMS)</span>
              </label>
              <input type="tel" id="regPhone" class="reg-input" placeholder="e.g. +91 94954 92013" autocomplete="tel" />
            </div>

            <div class="reg-error" id="regError"></div>

            <button type="submit" class="reg-submit-btn" id="regSubmitBtn">
              <span>Continue to Chat</span>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>

            <div class="reg-privacy-note">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              <span>Your medical information is kept strictly confidential.</span>
            </div>
          </form>
        </div>

        <!-- =================================================================
             2. CONVERSATION VIEW (Active after registration)
             ================================================================= -->
        <div class="doc-chat-active-view" id="docChatActiveView" style="display:none;">
          <!-- Profile Strip -->
          <div class="doc-chat-profile-strip">
            <span class="doc-chat-profile-tag" id="docProfileTag">
              Patient: <strong id="docProfileNameTag">Visitor</strong>
            </span>
            <button class="doc-chat-profile-btn" id="docChangeProfileBtn">Change Profile</button>
          </div>

          <!-- Messages Stream -->
          <div class="doc-chat-messages" id="docChatMessages">
            <div class="doc-chat-welcome" id="docChatWelcome">
              <div class="doc-chat-welcome-title">Dr. Smith's Clinical Practice</div>
              <div class="doc-chat-welcome-desc">
                Have a clinical question, want to book an appointment, or need clinic timings? Our AI Clinical Assistant and medical team are here to assist.
              </div>
              <div class="doc-chat-chips">
                <button class="doc-chat-chip" data-msg="I want to book an appointment.">📅 Book Appointment</button>
                <button class="doc-chat-chip" data-msg="What are your consultation hours?">🕒 Consultation Hours</button>
                <button class="doc-chat-chip" data-msg="Where is your clinic located?">📍 Clinic Location</button>
                <button class="doc-chat-chip" data-msg="Who is Dr. John Smith? Tell me about his qualifications.">👨‍⚕️ Doctor Credentials</button>
              </div>
            </div>
          </div>

          <!-- Typing Indicator -->
          <div class="doc-chat-typing" id="docChatTyping">
            <span style="font-size:11px;color:#A8B7C2;margin-right:4px;">Assistant is typing</span>
            <div class="doc-chat-dot"></div>
            <div class="doc-chat-dot"></div>
            <div class="doc-chat-dot"></div>
          </div>

          <!-- Message Composer -->
          <div class="doc-chat-composer">
            <textarea
              class="doc-chat-textarea"
              id="docChatInput"
              placeholder="Type your question or booking request..."
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
      </div>
    `;

    document.body.appendChild(root);
    setupEvents();
  }

  // --- Session & Registration Verification ---
  async function checkSession() {
    if (!state.visitorToken) {
      showRegistrationView();
      return;
    }

    try {
      const res = await fetch(`/api/chat/session?visitorToken=${encodeURIComponent(state.visitorToken)}`);
      const data = await res.json();

      if (data.success && !data.requiresRegistration) {
        state.isRegistered = true;
        state.visitor = data.visitor;
        state.conversationId = data.conversationId;
        localStorage.setItem('doc_conv_id', data.conversationId);
        showConversationView();

        if (data.messages && data.messages.length > 0) {
          renderMessages(data.messages);
        }
        connectWebSocket();
      } else {
        showRegistrationView();
      }
    } catch (err) {
      console.warn('[Chat Widget] Offline check session:', err);
      showRegistrationView();
    }
  }

  function showRegistrationView() {
    state.isRegistered = false;
    document.getElementById('docChatRegisterView').style.display = 'flex';
    document.getElementById('docChatActiveView').style.display = 'none';
  }

  function showConversationView() {
    state.isRegistered = true;
    document.getElementById('docChatRegisterView').style.display = 'none';
    document.getElementById('docChatActiveView').style.display = 'flex';

    if (state.visitor) {
      document.getElementById('docProfileNameTag').textContent = `${state.visitor.username} (${state.visitor.age}y)`;
    }
    scrollToBottom();
  }

  // --- WebSocket Real-Time Connection ---
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
            appendMessage(payload.message, payload.appointmentCreated);
            if (payload.message.sender_type === 'AI' || payload.message.sender_type === 'admin') {
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
          } else if (payload.event === 'appointment_confirmed') {
            if (payload.appointment) {
              appendAppointmentCard(payload.appointment);
            }
          }
        } catch (e) {
          console.error('[Chat Widget] WS parse error:', e);
        }
      };

      ws.onclose = () => {
        state.wsConnected = false;
        const statusEl = document.getElementById('docChatConnStatus');
        if (statusEl) statusEl.textContent = 'AI Online';
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = setTimeout(connectWebSocket, 10000);
        startPollingFallback();
      };

      ws.onerror = () => {
        state.wsConnected = false;
        const statusEl = document.getElementById('docChatConnStatus');
        if (statusEl) statusEl.textContent = 'AI Online';
        startPollingFallback();
        try { ws.close(); } catch (e) {}
      };
    } catch (err) {
      console.warn('[Chat Widget] WebSocket unavailable, using real-time polling fallback');
      startPollingFallback();
    }
  }

  let pollInterval = null;
  function startPollingFallback() {
    if (pollInterval) return;
    pollInterval = setInterval(async () => {
      if (state.wsConnected || !state.visitorToken || !state.isOpen) return;
      try {
        const res = await fetch(`/api/chat/session?visitorToken=${encodeURIComponent(state.visitorToken)}`);
        const data = await res.json();
        if (data && data.success && Array.isArray(data.messages)) {
          data.messages.forEach(msg => appendMessage(msg, null, true));
        }
      } catch (e) {}
    }, 3500);
  }

  function renderMessages(messages) {
    const container = document.getElementById('docChatMessages');
    if (!container) return;

    container.querySelectorAll('.doc-chat-bubble-wrap, .doc-chat-appt-card').forEach(el => el.remove());
    messages.forEach(msg => appendMessage(msg, null, false));
    scrollToBottom();
  }

  function appendMessage(msg, appointmentCreated = null, scroll = true) {
    const container = document.getElementById('docChatMessages');
    if (!container) return;

    if (document.getElementById(`msg-${msg.id}`)) return;

    const wrap = document.createElement('div');
    const senderType = msg.sender_type; // 'visitor', 'admin', 'AI'

    let wrapClass = 'is-visitor';
    let senderHtml = '';

    if (senderType === 'AI') {
      wrapClass = 'is-ai';
      senderHtml = `
        <div class="doc-chat-bubble-sender sender-ai">
          <span>AI Clinical Assistant</span>
          <span class="doc-chat-ai-pill">Dr. Smith Clinic</span>
        </div>`;
    } else if (senderType === 'admin') {
      wrapClass = 'is-admin';
      senderHtml = `
        <div class="doc-chat-bubble-sender sender-admin">
          <span>Dr. John Smith</span>
        </div>`;
    }

    wrap.className = `doc-chat-bubble-wrap ${wrapClass}`;
    wrap.id = `msg-${msg.id}`;

    const statusTick = senderType === 'visitor'
      ? `<span class="doc-chat-ticks">${msg.delivery_status === 'read' ? '✓✓' : '✓'}</span>`
      : '';

    wrap.innerHTML = `
      ${senderHtml}
      <div class="doc-chat-bubble">${formatMessageBody(msg.message_text)}</div>
      <div class="doc-chat-bubble-meta">
        <span>${formatTime(msg.created_at)}</span>
        ${statusTick}
      </div>
    `;

    container.appendChild(wrap);

    // If an appointment was booked in this turn, attach card
    if (appointmentCreated) {
      appendAppointmentCard(appointmentCreated);
    }

    if (scroll) scrollToBottom();
  }

  function appendAppointmentCard(appt) {
    const container = document.getElementById('docChatMessages');
    if (!container) return;

    const card = document.createElement('div');
    card.className = 'doc-chat-appt-card';
    card.innerHTML = `
      <div class="appt-card-top">
        <span class="appt-card-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Cardiology Appointment
        </span>
        <span class="appt-card-status appt-status-${appt.status || 'pending'}">${(appt.status || 'pending').toUpperCase()}</span>
      </div>
      <div class="appt-card-row">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <strong>${appt.appointment_date}</strong> at <strong>${appt.preferred_time}</strong>
      </div>
      <div class="appt-card-row">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <span>${escapeHTML(appt.patient_name)}</span>
      </div>
      <div class="appt-card-row">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span>Apollo Hospitals, Greams Lane, Chennai</span>
      </div>
    `;
    container.appendChild(card);
    scrollToBottom();
  }

  function formatMessageBody(text) {
    if (!text) return '';
    // Format basic bold **text** and bullet points
    let escaped = escapeHTML(text);
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return escaped;
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

  async function sendMessage(text) {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();

    if (!state.isRegistered || !state.visitorToken) {
      showRegistrationView();
      return;
    }

    const input = document.getElementById('docChatInput');
    const sendBtn = document.getElementById('docChatSendBtn');
    if (input) input.value = '';
    if (sendBtn) sendBtn.disabled = true;

    sendTypingIndicator(false);

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorToken: state.visitorToken,
          conversationId: state.conversationId,
          messageText: cleanText
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        if (errData.requiresRegistration) {
          showRegistrationView();
          return;
        }
        throw new Error(errData.error || 'Failed to send message');
      }

      const data = await res.json();
      appendMessage(data.message);
    } catch (err) {
      console.error('[Chat Widget] Failed to send message:', err);
      alert('Unable to send message. Please verify your connection.');
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
    const regForm = document.getElementById('docRegForm');
    const regError = document.getElementById('regError');
    const regSubmitBtn = document.getElementById('regSubmitBtn');
    const input = document.getElementById('docChatInput');
    const sendBtn = document.getElementById('docChatSendBtn');
    const changeProfileBtn = document.getElementById('docChangeProfileBtn');

    // Open/Close toggle
    trigger.addEventListener('click', () => {
      state.isOpen = !state.isOpen;
      windowEl.classList.toggle('is-open', state.isOpen);
      if (state.isOpen) {
        state.unreadCount = 0;
        updateBadge();
        if (state.isRegistered) {
          scrollToBottom();
          setTimeout(() => input.focus(), 250);
        } else {
          setTimeout(() => document.getElementById('regUsername').focus(), 250);
        }
      }
    });

    closeBtn.addEventListener('click', () => {
      state.isOpen = false;
      windowEl.classList.remove('is-open');
    });

    // Registration Form Submit
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      regError.style.display = 'none';

      const username = document.getElementById('regUsername').value.trim();
      const age = parseInt(document.getElementById('regAge').value, 10);
      const phone = document.getElementById('regPhone').value.trim();

      if (!username) {
        regError.textContent = 'Please enter your full name or username.';
        regError.style.display = 'block';
        return;
      }

      if (isNaN(age) || age < 1 || age > 120) {
        regError.textContent = 'Please enter a valid age between 1 and 120.';
        regError.style.display = 'block';
        return;
      }

      regSubmitBtn.disabled = true;

      try {
        const res = await fetch('/api/visitor/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            age,
            phone,
            existingToken: state.visitorToken || undefined
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Registration failed');
        }

        state.visitor = data.visitor;
        state.visitorToken = data.visitorToken;
        state.conversationId = data.conversationId;

        localStorage.setItem('doc_visitor_token', state.visitorToken);
        localStorage.setItem('doc_conv_id', state.conversationId);

        showConversationView();

        if (data.messages && data.messages.length > 0) {
          renderMessages(data.messages);
        } else {
          // Send automatic welcoming greeting
          const welcomeText = `Hi, I am ${username} (${age} yrs old).`;
          sendMessage(welcomeText);
        }

        connectWebSocket();
      } catch (err) {
        regError.textContent = err.message;
        regError.style.display = 'block';
      } finally {
        regSubmitBtn.disabled = false;
      }
    });

    // Change profile button
    changeProfileBtn.addEventListener('click', () => {
      showRegistrationView();
    });

    // Textarea input & send button enable/disable
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
      sendBtn.disabled = !input.value.trim();

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
  }

  // Self-start on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectUI();
      checkSession();
    });
  } else {
    injectUI();
    checkSession();
  }
})();
