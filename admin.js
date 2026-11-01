/**
 * DR. JOHN SMITH · REAL-TIME ADMIN MESSAGING INBOX
 * WhatsApp / Instagram DM UX with real-time WebSocket synchronization
 */
(function() {
  'use strict';

  let state = {
    token: localStorage.getItem('doc_admin_token') || '',
    admin: null,
    conversations: [],
    activeConversationId: null,
    activeConversation: null,
    filter: 'all',
    searchQuery: '',
    ws: null,
    wsConnected: false,
    reconnectTimer: null,
    typingTimer: null,
    isTyping: false
  };

  // Subtle audio chime for incoming patient enquiries
  function playEnquiryChime() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, ctx.currentTime); // A4
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (e) {
      // Audio autoplay safe
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

  function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHrs = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHrs / 24);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHrs < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function formatClockTime(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function getInitials(name) {
    if (!name) return 'V';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  // --- Authenticated Fetch Helper ---
  async function apiFetch(endpoint, options = {}) {
    options.headers = options.headers || {};
    if (state.token) {
      options.headers['Authorization'] = `Bearer ${state.token}`;
    }
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    const res = await fetch(endpoint, options);
    if (res.status === 401) {
      handleLogout();
      throw new Error('Unauthorized');
    }
    return res;
  }

  // =========================================================================
  // 1. AUTHENTICATION LIFECYCLE
  // =========================================================================
  async function checkAuth() {
    const authOverlay = document.getElementById('adminAuthOverlay');
    const adminApp = document.getElementById('adminApp');

    if (!state.token) {
      authOverlay.style.display = 'flex';
      adminApp.style.display = 'none';
      return;
    }

    try {
      const res = await apiFetch('/api/admin/me');
      if (res.ok) {
        const data = await res.json();
        state.admin = data.admin;
        authOverlay.style.display = 'none';
        adminApp.style.display = 'flex';
        initAdminApp();
      } else {
        handleLogout();
      }
    } catch (e) {
      handleLogout();
    }
  }

  function handleLogout() {
    state.token = '';
    state.admin = null;
    localStorage.removeItem('doc_admin_token');
    if (state.ws) {
      state.ws.close();
      state.ws = null;
    }
    document.getElementById('adminAuthOverlay').style.display = 'flex';
    document.getElementById('adminApp').style.display = 'none';
  }

  // =========================================================================
  // 2. WEBSOCKET REAL-TIME SYNC
  // =========================================================================
  function connectWebSocket() {
    if (!state.token) return;
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      state.ws = ws;

      ws.onopen = () => {
        state.wsConnected = true;
        // Authenticate as Admin
        ws.send(JSON.stringify({
          action: 'auth_admin',
          token: state.token
        }));
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          if (payload.event === 'new_enquiry_message') {
            handleIncomingEnquiry(payload);
          } else if (payload.event === 'ai_reply_sent') {
            if (state.activeConversationId === payload.conversationId) {
              appendChatMessage(payload.message);
            }
            fetchConversations();
          } else if (payload.event === 'admin_reply_sent') {
            handleAdminReplySent(payload);
          } else if (payload.event === 'new_appointment_booked') {
            playEnquiryChime();
            fetchConversations();
            if (state.activeConversationId === payload.appointment.conversation_id) {
              selectConversation(state.activeConversationId);
            }
          } else if (payload.event === 'appointment_status_changed') {
            fetchConversations();
            if (state.activeConversationId) {
              selectConversation(state.activeConversationId);
            }
          } else if (payload.event === 'typing') {
            if (payload.conversationId === state.activeConversationId) {
              const typingIndicator = document.getElementById('chatAdminTyping');
              if (typingIndicator) {
                typingIndicator.style.display = payload.isTyping ? 'flex' : 'none';
                scrollChatToBottom();
              }
            }
          } else if (payload.event === 'conversation_status_changed') {
            updateConvStatusInState(payload.conversationId, payload.status);
          } else if (payload.event === 'visitor_profile_updated') {
            updateConvProfileInState(payload.conversationId, payload.conversation);
          } else if (payload.event === 'conversation_marked_read') {
            markConvReadInState(payload.conversationId);
          }
        } catch (err) {
          console.error('[Admin WS] Error parsing message:', err);
        }
      };

      ws.onclose = () => {
        state.wsConnected = false;
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = setTimeout(connectWebSocket, 4000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch (e) {
      console.error('[Admin WS] Connection error:', e);
    }
  }

  function handleIncomingEnquiry(payload) {
    const { conversationId, conversation, message } = payload;
    playEnquiryChime();

    // If currently viewing this conversation, append message to stream & mark read immediately
    if (state.activeConversationId === conversationId) {
      appendChatMessage(message);
      // Mark read on server
      apiFetch(`/api/admin/conversations/${conversationId}`).catch(() => {});
    }

    // Refresh conversation list or update item
    fetchConversations();
  }

  function handleAdminReplySent(payload) {
    const { conversationId, message } = payload;
    if (state.activeConversationId === conversationId) {
      appendChatMessage(message);
    }
    fetchConversations();
  }

  function updateConvStatusInState(id, status) {
    const c = state.conversations.find(x => x.id === id);
    if (c) c.status = status;
    if (state.activeConversation && state.activeConversation.id === id) {
      state.activeConversation.status = status;
      updateActiveHeaderStatus(status);
    }
    renderConversationList();
  }

  function updateConvProfileInState(id, updated) {
    const c = state.conversations.find(x => x.id === id);
    if (c) {
      c.visitor_name = updated.visitor_name;
      c.visitor_phone = updated.visitor_phone;
    }
    if (state.activeConversation && state.activeConversation.id === id) {
      state.activeConversation.visitor_name = updated.visitor_name;
      state.activeConversation.visitor_phone = updated.visitor_phone;
      renderActiveConversationHeader(state.activeConversation);
      renderDetailsPanel(state.activeConversation);
    }
    renderConversationList();
  }

  function markConvReadInState(id) {
    const c = state.conversations.find(x => x.id === id);
    if (c) c.unread_count = 0;
    renderConversationList();
  }

  // =========================================================================
  // 3. INBOX LIST & FILTERS
  // =========================================================================
  async function fetchConversations() {
    try {
      if (state.filter === 'appointments') {
        const res = await apiFetch('/api/admin/appointments');
        const data = await res.json();
        renderAppointmentsList(data.appointments || []);
        return;
      }

      const url = `/api/admin/conversations?status=${encodeURIComponent(state.filter)}&search=${encodeURIComponent(state.searchQuery)}`;
      const res = await apiFetch(url);
      if (!res.ok) throw new Error('Fetch failed');
      const data = await res.json();

      state.conversations = data.conversations || [];
      if (data.stats) {
        document.getElementById('countUnread').textContent = data.stats.unread || 0;
        const apptCountEl = document.getElementById('countAppointments');
        if (apptCountEl) apptCountEl.textContent = data.stats.appointmentsPending || 0;
      }
      renderConversationList();
    } catch (err) {
      console.error('[Admin] Failed to load conversations:', err);
    }
  }

  function renderAppointmentsList(appointments) {
    const listEl = document.getElementById('inboxList');
    if (!listEl) return;

    if (appointments.length === 0) {
      listEl.innerHTML = `
        <div class="inbox-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>No booked appointments recorded yet</span>
        </div>
      `;
      return;
    }

    listEl.innerHTML = '';
    appointments.forEach(appt => {
      const item = document.createElement('div');
      item.className = 'conv-item';
      item.innerHTML = `
        <div class="conv-item-avatar" style="border-color:var(--green);color:var(--green);">📅</div>
        <div class="conv-item-content">
          <div class="conv-item-top">
            <span class="conv-item-name">${escapeHTML(appt.patient_name)} (${appt.patient_age || '?'}y)</span>
            <span class="status-pill status-${appt.status === 'confirmed' ? 'resolved' : (appt.status === 'pending' ? 'open' : 'new')}">${appt.status.toUpperCase()}</span>
          </div>
          <div class="conv-item-bottom">
            <span class="conv-item-preview" style="color:var(--txt-main);font-weight:600;">${appt.appointment_date} at ${appt.preferred_time}</span>
          </div>
          <div style="font-size:11px;color:var(--txt-sub);margin-top:2px;">${escapeHTML(appt.reason_for_visit || 'Cardiology Consultation')} · ${escapeHTML(appt.phone)}</div>
        </div>
      `;

      item.addEventListener('click', () => {
        if (appt.conversation_id) {
          selectConversation(appt.conversation_id);
        }
      });
      listEl.appendChild(item);
    });
  }

  function renderConversationList() {
    const listEl = document.getElementById('inboxList');
    if (!listEl) return;

    if (state.conversations.length === 0) {
      listEl.innerHTML = `
        <div class="inbox-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
          <span>No conversations found under "${state.filter}" filter</span>
        </div>
      `;
      return;
    }

    listEl.innerHTML = '';
    state.conversations.forEach(conv => {
      const hasUnread = conv.unread_count > 0;
      const isActive = conv.id === state.activeConversationId;
      const initials = getInitials(conv.visitor_name);
      const displayName = conv.visitor_name ? escapeHTML(conv.visitor_name) : `Anonymous (${conv.id.slice(-6)})`;

      const lastMsgPrefix = conv.last_message_sender === 'admin' ? '<span style="color:var(--cyan)">You: </span>' : '';
      const previewText = conv.last_message_text ? escapeHTML(conv.last_message_text) : 'New enquiry initiated';

      const unreadBadge = hasUnread
        ? `<div class="conv-item-badge">${conv.unread_count > 9 ? '9+' : conv.unread_count}</div>`
        : '';

      const statusPillClass = `status-${conv.status || 'new'}`;

      const item = document.createElement('div');
      item.className = `conv-item ${isActive ? 'active' : ''} ${hasUnread ? 'has-unread' : ''}`;
      item.dataset.id = conv.id;

      item.innerHTML = `
        <div class="conv-item-avatar">${initials}</div>
        <div class="conv-item-content">
          <div class="conv-item-top">
            <span class="conv-item-name">${displayName}</span>
            <span class="conv-item-time">${formatRelativeTime(conv.last_message_at)}</span>
          </div>
          <div class="conv-item-bottom">
            <span class="conv-item-preview">${lastMsgPrefix}${previewText}</span>
            ${unreadBadge}
          </div>
        </div>
      `;

      item.addEventListener('click', () => selectConversation(conv.id));
      listEl.appendChild(item);
    });
  }

  // =========================================================================
  // 4. ACTIVE CONVERSATION SELECTION & DISPLAY
  // =========================================================================
  async function selectConversation(id) {
    state.activeConversationId = id;
    document.getElementById('adminApp').classList.add('chat-open');

    // Update active highlight in sidebar
    document.querySelectorAll('.conv-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id);
    });

    const emptyState = document.getElementById('chatEmptyState');
    const activeView = document.getElementById('chatActiveView');
    emptyState.style.display = 'none';
    activeView.style.display = 'flex';

    // Show loading in stream
    const stream = document.getElementById('chatStream');
    stream.innerHTML = '<div class="inbox-loading"><div class="spinner"></div><span>Loading messages...</span></div>';

    try {
      const res = await apiFetch(`/api/admin/conversations/${id}`);
      if (!res.ok) throw new Error('Failed to load conversation');
      const data = await res.json();

      state.activeConversation = data.conversation;
      renderActiveConversationHeader(data.conversation);
      renderChatStream(data.messages || []);
      renderDetailsPanel(data.conversation);

      // Decrement unread state locally
      const c = state.conversations.find(x => x.id === id);
      if (c && c.unread_count > 0) {
        c.unread_count = 0;
        renderConversationList();
      }

      document.getElementById('adminMessageInput').focus();
    } catch (err) {
      console.error('[Admin] Error opening conversation:', err);
      stream.innerHTML = '<div class="inbox-empty">Failed to load message history.</div>';
    }
  }

  function renderActiveConversationHeader(conv) {
    const initials = getInitials(conv.visitor_name);
    const displayName = conv.visitor_name ? escapeHTML(conv.visitor_name) : `Anonymous Visitor (${conv.id.slice(-6)})`;

    document.getElementById('achAvatar').textContent = initials;
    document.getElementById('achName').textContent = displayName;
    document.getElementById('achPhone').textContent = conv.visitor_phone ? conv.visitor_phone : 'No phone provided';
    document.getElementById('achTime').textContent = `Enquiry ID: ${conv.id.slice(-8)}`;

    updateActiveHeaderStatus(conv.status || 'new');
  }

  function updateActiveHeaderStatus(status) {
    const pill = document.getElementById('achStatusPill');
    const toggleLabel = document.getElementById('toggleStatusLabel');

    pill.className = `status-pill status-${status}`;
    pill.textContent = (status || 'new').toUpperCase();

    if (status === 'resolved') {
      toggleLabel.textContent = 'Reopen Enquiry';
    } else {
      toggleLabel.textContent = 'Mark Resolved';
    }
  }

  function renderChatStream(messages) {
    const stream = document.getElementById('chatStream');
    stream.innerHTML = '';

    if (messages.length === 0) {
      stream.innerHTML = '<div class="inbox-empty"><span>No messages in this enquiry yet.</span></div>';
      return;
    }

    messages.forEach(msg => appendChatMessage(msg, false));
    scrollChatToBottom();
  }

  function appendChatMessage(msg, scroll = true) {
    const stream = document.getElementById('chatStream');
    if (!stream) return;

    // Check if already in stream
    if (document.getElementById(`admin-msg-${msg.id}`)) return;

    // Remove empty placeholder if present
    const empty = stream.querySelector('.inbox-empty');
    if (empty) empty.remove();

    const senderType = msg.sender_type;
    const isVisitor = senderType === 'visitor';
    const isAI = senderType === 'AI';

    const wrap = document.createElement('div');
    wrap.className = `admin-bubble-wrap ${isVisitor ? 'is-visitor' : (isAI ? 'is-ai' : 'is-admin')}`;
    wrap.id = `admin-msg-${msg.id}`;

    let senderName = '';
    if (isVisitor) {
      senderName = state.activeConversation && state.activeConversation.visitor_name
        ? escapeHTML(state.activeConversation.visitor_name)
        : 'Visitor';
    } else if (isAI) {
      senderName = '<span class="ai-badge-sm">AI Clinical Assistant</span> Dr. Smith Practice';
    } else {
      senderName = 'You (Dr. John Smith)';
    }

    const tick = !isVisitor && !isAI
      ? `<span class="admin-tick">${msg.delivery_status === 'read' ? '✓✓' : '✓'}</span>`
      : '';

    wrap.innerHTML = `
      <div class="admin-bubble-sender">${senderName}</div>
      <div class="admin-bubble">${escapeHTML(msg.message_text)}</div>
      <div class="admin-bubble-meta">
        <span>${formatClockTime(msg.created_at)}</span>
        ${tick}
      </div>
    `;

    stream.appendChild(wrap);
    if (scroll) scrollChatToBottom();
  }

  function scrollChatToBottom() {
    const stream = document.getElementById('chatStream');
    if (stream) stream.scrollTop = stream.scrollHeight;
  }

  // =========================================================================
  // 5. SENDING REPLIES
  // =========================================================================
  async function sendAdminReply(text) {
    if (!state.activeConversationId || !text || !text.trim()) return;

    const input = document.getElementById('adminMessageInput');
    const sendBtn = document.getElementById('adminSendBtn');
    input.value = '';
    sendBtn.disabled = true;
    input.style.height = '42px';

    sendAdminTyping(false);

    try {
      const res = await apiFetch(`/api/admin/conversations/${state.activeConversationId}/reply`, {
        method: 'POST',
        body: { messageText: text.trim() }
      });

      if (!res.ok) throw new Error('Reply failed');
      const data = await res.json();
      appendChatMessage(data.message);
      fetchConversations();
    } catch (err) {
      console.error('[Admin] Error sending reply:', err);
      alert('Failed to send reply. Please verify server connection.');
    }
  }

  function sendAdminTyping(isTyping) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN && state.activeConversationId) {
      state.ws.send(JSON.stringify({
        action: 'typing',
        conversationId: state.activeConversationId,
        isTyping: !!isTyping
      }));
    }
  }

  // =========================================================================
  // 6. DETAILS PANEL & ENQUIRY ACTIONS
  // =========================================================================
  function renderDetailsPanel(conv) {
    if (!conv) return;

    const initials = getInitials(conv.visitor_name);
    const displayName = conv.visitor_name ? conv.visitor_name : 'Anonymous Visitor';

    document.getElementById('detAvatar').textContent = initials;
    document.getElementById('detName').textContent = displayName;

    const ageEl = document.getElementById('detAge');
    if (ageEl) {
      ageEl.textContent = conv.visitor_age ? `Patient Age: ${conv.visitor_age} years` : 'Age: Not recorded';
    }

    const badge = document.getElementById('detStatusBadge');
    badge.className = `status-pill status-${conv.status || 'new'}`;
    badge.textContent = (conv.status || 'new').toUpperCase();

    // Render appointments
    const apptsList = document.getElementById('detApptsList');
    if (apptsList) {
      if (conv.appointments && conv.appointments.length > 0) {
        apptsList.innerHTML = '';
        conv.appointments.forEach(appt => {
          const item = document.createElement('div');
          item.className = 'det-appt-item';
          item.innerHTML = `
            <div class="det-appt-header">
              <span class="det-appt-date">📅 ${appt.appointment_date} · ${appt.preferred_time}</span>
              <select class="det-appt-status-select" data-id="${appt.id}">
                <option value="pending" ${appt.status === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="confirmed" ${appt.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                <option value="cancelled" ${appt.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                <option value="completed" ${appt.status === 'completed' ? 'selected' : ''}>Completed</option>
              </select>
            </div>
            <div style="font-size:11px;color:var(--txt-sub);">Reason: ${escapeHTML(appt.reason_for_visit || 'Cardiology Consultation')}</div>
            <div style="font-size:10.5px;color:var(--txt-muted);">Contact: ${escapeHTML(appt.phone)}</div>
          `;

          const selectEl = item.querySelector('.det-appt-status-select');
          selectEl.addEventListener('change', async (e) => {
            const newStatus = e.target.value;
            try {
              await apiFetch(`/api/admin/appointments/${appt.id}/status`, {
                method: 'PATCH',
                body: { status: newStatus }
              });
              appt.status = newStatus;
              fetchConversations();
            } catch (err) {
              alert('Failed to update appointment status');
            }
          });
          apptsList.appendChild(item);
        });
      } else {
        apptsList.innerHTML = '<span class="det-no-appts">No appointment requests logged yet.</span>';
      }
    }

    // Call button
    const callBtn = document.getElementById('detCallBtn');
    if (conv.visitor_phone) {
      callBtn.href = `tel:${conv.visitor_phone.replace(/\s+/g, '')}`;
      callBtn.style.opacity = '1';
      callBtn.style.pointerEvents = 'auto';
    } else {
      callBtn.removeAttribute('href');
      callBtn.style.opacity = '0.4';
      callBtn.style.pointerEvents = 'none';
    }

    // WhatsApp button
    const waBtn = document.getElementById('detWhatsAppBtn');
    if (conv.visitor_phone) {
      const cleanPhone = conv.visitor_phone.replace(/[^\d]/g, '');
      waBtn.href = `https://wa.me/${cleanPhone}?text=Hello%20${encodeURIComponent(displayName)}%2C%20following%20up%20on%20your%20cardiology%20consultation%20enquiry%20with%20Dr.%20John%20Smith.`;
      waBtn.style.opacity = '1';
      waBtn.style.pointerEvents = 'auto';
    } else {
      waBtn.removeAttribute('href');
      waBtn.style.opacity = '0.4';
      waBtn.style.pointerEvents = 'none';
    }

    // Editable Inputs
    document.getElementById('detInputName').value = conv.visitor_name || '';
    document.getElementById('detInputPhone').value = conv.visitor_phone || '';

    // Metadata
    document.getElementById('detConvId').textContent = conv.id;
    document.getElementById('detCreatedTime').textContent = new Date(conv.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    document.getElementById('detLastTime').textContent = new Date(conv.last_message_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

    // Notes
    document.getElementById('detAdminNotes').value = conv.admin_notes || '';
  }

  async function toggleActiveStatus() {
    if (!state.activeConversation) return;
    const current = state.activeConversation.status || 'new';
    const nextStatus = current === 'resolved' ? 'open' : 'resolved';

    try {
      const res = await apiFetch(`/api/admin/conversations/${state.activeConversation.id}/status`, {
        method: 'PATCH',
        body: { status: nextStatus }
      });

      if (!res.ok) throw new Error('Status update failed');
      const data = await res.json();
      state.activeConversation.status = nextStatus;
      updateActiveHeaderStatus(nextStatus);
      renderDetailsPanel(state.activeConversation);
      fetchConversations();
    } catch (err) {
      console.error('[Admin] Error updating status:', err);
    }
  }

  async function saveVisitorDetails() {
    if (!state.activeConversation) return;
    const name = document.getElementById('detInputName').value.trim();
    const phone = document.getElementById('detInputPhone').value.trim();

    try {
      const res = await apiFetch(`/api/admin/conversations/${state.activeConversation.id}/visitor`, {
        method: 'PATCH',
        body: { name, phone }
      });

      if (!res.ok) throw new Error('Details update failed');
      const data = await res.json();
      state.activeConversation.visitor_name = name;
      state.activeConversation.visitor_phone = phone;
      renderActiveConversationHeader(state.activeConversation);
      renderDetailsPanel(state.activeConversation);
      fetchConversations();
      alert('Visitor contact details updated successfully.');
    } catch (err) {
      console.error('[Admin] Error saving visitor details:', err);
      alert('Failed to update visitor details.');
    }
  }

  async function saveAdminNotes() {
    if (!state.activeConversation) return;
    const notes = document.getElementById('detAdminNotes').value.trim();

    try {
      const res = await apiFetch(`/api/admin/conversations/${state.activeConversation.id}/notes`, {
        method: 'PATCH',
        body: { notes }
      });

      if (!res.ok) throw new Error('Notes update failed');
      state.activeConversation.admin_notes = notes;
      alert('Private clinical note saved.');
    } catch (err) {
      console.error('[Admin] Error saving notes:', err);
      alert('Failed to save notes.');
    }
  }

  // =========================================================================
  // 7. SETUP EVENT LISTENERS
  // =========================================================================
  function setupEventListeners() {
    // Login form
    const loginForm = document.getElementById('adminLoginForm');
    const authError = document.getElementById('authError');
    const submitBtn = document.getElementById('authSubmitBtn');

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      authError.style.display = 'none';
      submitBtn.disabled = true;

      const email = document.getElementById('adminEmail').value.trim();
      const password = document.getElementById('adminPassword').value;

      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Login failed');
        }

        state.token = data.token;
        state.admin = data.admin;
        localStorage.setItem('doc_admin_token', state.token);

        document.getElementById('adminAuthOverlay').style.display = 'none';
        document.getElementById('adminApp').style.display = 'flex';
        initAdminApp();
      } catch (err) {
        authError.textContent = err.message;
        authError.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
      }
    });

    // Logout
    document.getElementById('adminLogoutBtn').addEventListener('click', handleLogout);

    // Refresh
    document.getElementById('refreshBtn').addEventListener('click', () => {
      fetchConversations();
    });

    // Search
    const searchInput = document.getElementById('inboxSearchInput');
    const searchClear = document.getElementById('searchClearBtn');

    let debounceTimer;
    searchInput.addEventListener('input', () => {
      searchClear.style.display = searchInput.value ? 'block' : 'none';
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.searchQuery = searchInput.value.trim();
        fetchConversations();
      }, 300);
    });

    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchClear.style.display = 'none';
      state.searchQuery = '';
      fetchConversations();
    });

    // Filter Tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.filter = tab.dataset.filter;
        fetchConversations();
      });
    });

    // Back button (Mobile view)
    document.getElementById('achBackBtn').addEventListener('click', () => {
      document.getElementById('adminApp').classList.remove('chat-open');
    });

    // Toggle Details Sidebar
    document.getElementById('toggleDetailsBtn').addEventListener('click', () => {
      document.getElementById('detailsSidebar').classList.toggle('is-collapsed');
    });
    document.getElementById('detailsCloseBtn').addEventListener('click', () => {
      document.getElementById('detailsSidebar').classList.add('is-collapsed');
    });

    // Status Toggle
    document.getElementById('toggleStatusBtn').addEventListener('click', toggleActiveStatus);

    // Details Save Buttons
    document.getElementById('detSaveContactBtn').addEventListener('click', saveVisitorDetails);
    document.getElementById('detSaveNotesBtn').addEventListener('click', saveAdminNotes);

    // Quick Templates
    document.querySelectorAll('.qt-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const text = chip.dataset.text;
        const input = document.getElementById('adminMessageInput');
        input.value = text;
        input.dispatchEvent(new Event('input'));
        input.focus();
      });
    });

    // Composer Input & Send
    const composerInput = document.getElementById('adminMessageInput');
    const sendBtn = document.getElementById('adminSendBtn');

    composerInput.addEventListener('input', () => {
      composerInput.style.height = 'auto';
      composerInput.style.height = Math.min(composerInput.scrollHeight, 120) + 'px';
      sendBtn.disabled = !composerInput.value.trim();

      if (!state.isTyping) {
        state.isTyping = true;
        sendAdminTyping(true);
      }
      clearTimeout(state.typingTimer);
      state.typingTimer = setTimeout(() => {
        state.isTyping = false;
        sendAdminTyping(false);
      }, 1500);
    });

    composerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (composerInput.value.trim()) {
          sendAdminReply(composerInput.value);
        }
      }
    });

    sendBtn.addEventListener('click', () => {
      if (composerInput.value.trim()) {
        sendAdminReply(composerInput.value);
      }
    });
  }

  function initAdminApp() {
    connectWebSocket();
    fetchConversations();
  }

  // Entry point
  document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    checkAuth();
  });

})();
