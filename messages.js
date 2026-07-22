const API_BASE = 'https://bro-codie.vercel.app';
const tokenKey = 'aid4_token';

function getToken() {
  return localStorage.getItem(tokenKey) || '';
}

function requireAuth() {
  const t = getToken();
  if (!t) {
    window.location.href = 'join.html';
    return null;
  }
  return t;
}

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    return JSON.parse(jsonPayload);
  } catch (_) {
    return {};
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '<')
    .replaceAll('>', '>')
    .replaceAll('"', '"')
    .replaceAll("'", '&#039;');
}

function fmtTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts * 1000);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const opts = isToday ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return d.toLocaleString(undefined, opts);
  } catch { return ''; }
}

function fmtDateSeparator(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers['Authorization'] = `Bearer ${t}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(API_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && data.error) msg = data.error;
    } catch (_) {}
    throw new Error(msg);
  }
  return res.json().catch(() => ({}));
}

let conversations = [];
let currentConvId = null;
let currentConvUser = null;
let messagesCache = {};
let pollingInterval = null;
const POLL_INTERVAL = 3000;

const convListEl = document.getElementById('convList');
const convSearchEl = document.getElementById('convSearch');
const chatPlaceholder = document.getElementById('chatPlaceholder');
const activeChat = document.getElementById('activeChat');
const chatUserName = document.getElementById('chatUserName');
const chatAvatar = document.getElementById('chatAvatar');
const chatUserStatus = document.getElementById('chatUserStatus');
const messagesArea = document.getElementById('messagesArea');
const chatForm = document.getElementById('chatForm');
const msgInput = document.getElementById('msgInput');
const backBtn = document.getElementById('backBtn');
const newChatBtn = document.getElementById('newChatBtn');
const newChatModal = document.getElementById('newChatModal');
const newChatUser = document.getElementById('newChatUser');
const newChatError = document.getElementById('newChatError');
const modalCancel = document.getElementById('modalCancel');
const modalStart = document.getElementById('modalStart');
const convSidebar = document.getElementById('convSidebar');

async function loadConversations() {
  try {
    const data = await api('/api/messages');
    conversations = Array.isArray(data.conversations) ? data.conversations : [];
    renderConversations();
  } catch (e) {
    console.warn('Failed to load conversations:', e);
  }
}

function renderConversations() {
  const q = (convSearchEl.value || '').trim().toLowerCase();
  let filtered = conversations;
  if (q) {
    filtered = conversations.filter(c => c.withUser.toLowerCase().includes(q));
  }

  if (filtered.length === 0) {
    convListEl.innerHTML = '<div class="no-convs">' + (q ? 'No conversations found' : 'No conversations yet. Start a new chat!') + '</div>';
    return;
  }

  convListEl.innerHTML = filtered.map(c => {
    const lastMsg = c.lastMessage;
    let preview = 'No messages yet';
    if (lastMsg) {
      if (lastMsg.unsent) preview = 'Message unsent';
      else preview = lastMsg.text.substring(0, 50) + (lastMsg.text.length > 50 ? '...' : '');
    }
    const initial = c.withUser.charAt(0).toUpperCase();
    const isActive = c.conversationId === currentConvId;

    return '<div class="conv-item ' + (isActive ? 'active' : '') + '" data-convid="' + c.conversationId + '" data-user="' + c.withUser + '">' +
      '<div class="conv-avatar">' + initial + '</div>' +
      '<div class="conv-info">' +
        '<div class="conv-name">' + escapeHtml(c.withUser) + '</div>' +
        '<div class="conv-preview">' + escapeHtml(preview) + '</div>' +
      '</div>' +
      '<div class="conv-time">' + (lastMsg ? fmtTime(lastMsg.createdAt) : '') + '</div>' +
    '</div>';
  }).join('');

  convListEl.querySelectorAll('.conv-item').forEach(el => {
    el.addEventListener('click', function() {
      const convId = el.getAttribute('data-convid');
      const user = el.getAttribute('data-user');
      openConversation(convId, user);
    });
  });
}

async function openConversation(convId, withUser) {
  if (currentConvId === convId) return;

  currentConvId = convId;
  currentConvUser = withUser;

  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
  const activeItem = document.querySelector('[data-convid="' + convId + '"]');
  if (activeItem) activeItem.classList.add('active');

  if (window.innerWidth <= 860) {
    convSidebar.classList.add('hide');
    document.getElementById('chatPanel').classList.add('show');
  }

  chatUserName.textContent = withUser;
  chatAvatar.textContent = withUser.charAt(0).toUpperCase();
  chatUserStatus.textContent = 'Online';

  chatPlaceholder.style.display = 'none';
  activeChat.style.display = 'flex';

  await loadMessages(convId);
  startPolling(convId);
}

async function loadMessages(convId) {
  try {
    const data = await api('/api/messages/' + encodeURIComponent(convId) + '?limit=100');
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    messagesCache[convId] = msgs.reverse();
    renderMessages(convId);
  } catch (e) {
    console.warn('Failed to load messages:', e);
  }
}

function renderMessages(convId) {
  const msgs = messagesCache[convId] || [];
  const currentUser = parseJwt(getToken()).sub;

  if (msgs.length === 0) {
    messagesArea.innerHTML = '<div class="no-msgs-placeholder" style="flex:1;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.25);font-size:0.9rem;">Send a message to start the conversation</div>';
    return;
  }

  let html = '';
  let lastDate = null;

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    const msgDate = fmtDateSeparator(msg.createdAt);
    if (msgDate !== lastDate) {
      html += '<div class="date-separator">' + msgDate + '</div>';
      lastDate = msgDate;
    }

    const isSent = msg.from === currentUser;
    const rowClass = isSent ? 'sent' : 'received';

    if (msg.unsent) {
      html += '<div class="message-row ' + rowClass + '">' +
        '<div class="message-unsent">' + (isSent ? 'You unsent a message' : 'Message was unsent') + '</div>' +
      '</div>';
    } else {
      html += '<div class="message-row ' + rowClass + '">' +
        '<div class="message-bubble">' +
          escapeHtml(msg.text) +
          '<div class="message-time">' + fmtTime(msg.createdAt) + '</div>' +
          (isSent ? '<button class="unsend-btn" data-msgid="' + msg.id + '" title="Unsend message"><i class="fas fa-times"></i></button>' : '') +
        '</div>' +
      '</div>';
    }
  }

  messagesArea.innerHTML = html;
  messagesArea.scrollTop = messagesArea.scrollHeight;

  messagesArea.querySelectorAll('.unsend-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const msgId = btn.getAttribute('data-msgid');
      unsendMessage(msgId);
    });
  });
}

function startPolling(convId) {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(async function() {
    if (!currentConvId || currentConvId !== convId) return;
    try {
      const data = await api('/api/messages/' + encodeURIComponent(convId) + '?limit=100');
      const msgs = Array.isArray(data.messages) ? data.messages.reverse() : [];
      const currentLen = (messagesCache[convId] || []).length;

      if (msgs.length !== currentLen) {
        messagesCache[convId] = msgs;
        renderMessages(convId);
        loadConversations();
      }
    } catch (e) {}
  }, POLL_INTERVAL);
}

chatForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  const text = (msgInput.value || '').trim();
  if (!text || !currentConvUser) return;

  const currentUser = parseJwt(getToken()).sub;

  const optimisticMsg = {
    id: 'pending',
    from: currentUser,
    to: currentConvUser,
    text: text,
    createdAt: Math.floor(Date.now() / 1000),
  };

  if (messagesCache[currentConvId]) {
    messagesCache[currentConvId].push(optimisticMsg);
  } else {
    messagesCache[currentConvId] = [optimisticMsg];
  }
  renderMessages(currentConvId);
  msgInput.value = '';

  try {
    const data = await api('/api/messages', { method: 'POST', body: { to: currentConvUser, text: text } });
    if (data && data.message) {
      const cache = messagesCache[currentConvId] || [];
      const idx = cache.findIndex(function(m) { return m.id === 'pending'; });
      if (idx !== -1) cache[idx] = data.message;
      renderMessages(currentConvId);
    }
    loadConversations();
  } catch (e) {
    const cache = messagesCache[currentConvId] || [];
    messagesCache[currentConvId] = cache.filter(function(m) { return m.id !== 'pending'; });
    renderMessages(currentConvId);
  }
});

async function unsendMessage(msgId) {
  if (!confirm('Unsend this message?')) return;

  const cache = messagesCache[currentConvId] || [];
  const msg = cache.find(function(m) { return m.id === msgId; });
  if (msg) {
    msg.unsent = true;
    delete msg.text;
    renderMessages(currentConvId);
  }

  try {
    await api('/api/messages/' + encodeURIComponent(currentConvId), { method: 'DELETE', body: { msgId: msgId } });
    loadConversations();
  } catch (e) {
    loadMessages(currentConvId);
  }
}

newChatBtn.addEventListener('click', function() {
  newChatModal.classList.add('open');
  newChatUser.value = '';
  newChatError.style.display = 'none';
  newChatUser.focus();
});

modalCancel.addEventListener('click', function() {
  newChatModal.classList.remove('open');
});

modalStart.addEventListener('click', async function() {
  const username = (newChatUser.value || '').trim();
  if (!username) {
    newChatError.textContent = 'Please enter a username';
    newChatError.style.display = 'block';
    return;
  }

  const existing = conversations.find(function(c) { return c.withUser === username; });
  if (existing) {
    newChatModal.classList.remove('open');
    openConversation(existing.conversationId, existing.withUser);
    return;
  }

  try {
    const data = await api('/api/messages', { method: 'POST', body: { to: username, text: 'Hello!' } });
    if (data && data.ok) {
      newChatModal.classList.remove('open');
      await loadConversations();
      const newConv = conversations.find(function(c) { return c.withUser === username; });
      if (newConv) openConversation(newConv.conversationId, newConv.withUser);
    }
  } catch (e) {
    const errMsg = e.message || 'Failed to start conversation';
    if (errMsg.toLowerCase().includes('not found') || errMsg.toLowerCase().includes('user')) {
      newChatError.textContent = 'User not found. Please check the username.';
    } else {
      newChatError.textContent = errMsg;
    }
    newChatError.style.display = 'block';
  }
});

newChatUser.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') modalStart.click();
});

backBtn.addEventListener('click', function() {
  convSidebar.classList.remove('hide');
  document.getElementById('chatPanel').classList.remove('show');
  if (pollingInterval) clearInterval(pollingInterval);
  currentConvId = null;
  currentConvUser = null;
});

convSearchEl.addEventListener('input', function() { renderConversations(); });

function handleLogout() {
  if (pollingInterval) clearInterval(pollingInterval);
  localStorage.removeItem(tokenKey);
  window.location.href = 'join.html';
}

document.querySelector('.sidebar-header').insertAdjacentHTML('beforeend',
  '<button class="new-chat-btn" id="logoutBtnMsg" title="Logout" style="background:rgba(239,68,68,0.15);border-color:rgba(239,68,68,0.3);color:#ef4444;margin-left:auto;">' +
    '<i class="fas fa-sign-out-alt"></i>' +
  '</button>'
);
document.getElementById('logoutBtnMsg').addEventListener('click', handleLogout);

async function startConversationWithUser(username) {
  if (!username) return;

  const existing = conversations.find(function(c) { return c.withUser === username; });
  if (existing) {
    openConversation(existing.conversationId, existing.withUser);
    return;
  }

  try {
    const data = await api('/api/messages', { method: 'POST', body: { to: username, text: 'Hello!' } });
    if (data && data.ok) {
      await loadConversations();
      const newConv = conversations.find(function(c) { return c.withUser === username; });
      if (newConv) {
        openConversation(newConv.conversationId, newConv.withUser);
      } else {
        chatUserName.textContent = username;
        chatAvatar.textContent = username.charAt(0).toUpperCase();
        chatUserStatus.textContent = 'Online';
        chatPlaceholder.style.display = 'none';
        activeChat.style.display = 'flex';
        currentConvUser = username;
        currentConvId = 'temp:' + username;
      }
    }
  } catch (e) {
    alert('Could not start conversation: ' + e.message);
  }
}

window.addEventListener('DOMContentLoaded', async function() {
  requireAuth();
  await loadConversations();

  const params = new URLSearchParams(window.location.search);
  const targetUser = params.get('user');
  if (targetUser) {
    startConversationWithUser(targetUser);
  }
});
