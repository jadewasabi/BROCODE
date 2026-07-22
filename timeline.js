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

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers['Authorization'] = `Bearer ${t}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

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
    return new Date(ts * 1000).toLocaleString();
  } catch (_) {
    return '';
  }
}

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (_) {
    return {};
  }
}

// ======== In-Memory Cache ========
let allPosts = [];
let postsCache = { ids: [], timestamp: 0 };
const CACHE_TTL = 5000;
let pendingCommentFetches = {};

// ======== Debounce Utility ========
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ======== Load Posts with Cache ========
async function loadPosts(forceRefresh = false) {
  const now = Date.now();
  const cached = postsCache;

  if (!forceRefresh && cached.ids.length > 0 && now - cached.timestamp < CACHE_TTL) {
    return applySearchAndRender();
  }

  if (!forceRefresh && cached.ids.length > 0 && now - cached.timestamp < CACHE_TTL * 2) {
    applySearchAndRender();
    fetchAndUpdatePosts();
    return;
  }

  await fetchAndUpdatePosts();
}

async function fetchAndUpdatePosts() {
  try {
    const data = await api('/api/posts?limit=50');
    allPosts = Array.isArray(data.posts) ? data.posts : [];
    postsCache = {
      ids: allPosts.map(p => p.id),
      timestamp: Date.now(),
    };
    applySearchAndRender();
  } catch (e) {
    console.warn('Failed to fetch posts:', e);
  }
}

// ======== Lazy Load Comments ========
async function loadCommentsForPost(postId, commentListEl) {
  if (pendingCommentFetches[postId]) return;
  pendingCommentFetches[postId] = true;

  try {
    const data = await api(`/api/posts/${encodeURIComponent(postId)}/comment?limit=10`);
    const comments = Array.isArray(data.comments) ? data.comments : [];

    const post = allPosts.find(p => String(p.id) === String(postId));
    if (post) post._comments = comments;

    renderComments(commentListEl, comments);
  } catch (e) {
    console.warn('Failed to load comments:', e);
  } finally {
    delete pendingCommentFetches[postId];
  }
}

function renderComments(commentListEl, comments) {
  if (!comments || comments.length === 0) {
    commentListEl.innerHTML = '<div class="small">No comments yet.</div>';
    return;
  }
  commentListEl.innerHTML = comments
    .slice(-5)
    .reverse()
    .map(
      (c) =>
        `<div class="comment"><strong>${escapeHtml(c.username)}</strong>: ${escapeHtml(
          c.text
        )}</div>`
    )
    .join('');
}

function sortPosts() {
  allPosts.sort((a, b) => {
    const aUp = a.isUpvoted || a.upvotedAt;
    const bUp = b.isUpvoted || b.upvotedAt;
    if (aUp && !bUp) return -1;
    if (!aUp && bUp) return 1;
    if (aUp && bUp) return (b.upvotedAt || 0) - (a.upvotedAt || 0);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

// ======== Render Posts ========
function renderPosts(filtered) {
  const postsEl = document.getElementById('posts');
  postsEl.innerHTML = '';

  if (!filtered.length) {
    postsEl.innerHTML = '<div class="small">No posts yet.</div>';
    return;
  }

  const currentUser = parseJwt(getToken()).sub;

  for (const p of filtered) {
    const el = document.createElement('div');
    el.className = 'post';

    const isOwner = currentUser === p.username;
    const commentCount = p.commentCount || 0;

    el.innerHTML = `
      <div class="post-head">
        <div>
          <div class="post-user">${escapeHtml(p.username)}</div>
          <div class="post-meta">${escapeHtml(fmtTime(p.createdAt))}</div>
        <div class="post-meta" style="display:flex;gap:8px;align-items:center;">
          <span>#${escapeHtml(String(p.id))}</span>
          ${isOwner ? `<button class="btn delete-btn" data-delete="${p.id}" title="Delete your post">🗑️ Delete</button>` : ''}
        </div>

      ${p.imageUrl ? `<div class="post-img"><img src="${escapeHtml(p.imageUrl)}" alt="post image" /></div>` : ''}

      ${p.text ? `<div class="post-content">${escapeHtml(p.text)}</div>` : ''}

      <div class="actions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button class="btn react-btn upvote-btn" data-react="upvote" data-postid="${p.id}" title="Upvote to push to top">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="18 15 12 9 6 15"></polyline>
          </svg>
          Upvote
        </button>
        ${p.username !== currentUser ? `<button class="btn msg-user-btn" data-msguser="${p.username}" title="Message ${escapeHtml(p.username)}">
          <i class="fas fa-comment"></i> Message
        </button>` : ''}
      </div>

      <div class="comment-box">
        <div class="comment-list" data-commentlist="${p.id}">
          <div class="small">Loading comments... ${commentCount > 0 ? `(${commentCount} total)` : ''}</div>
        <form class="comment-form" data-commentform="${p.id}">
          <input type="text" required maxlength="300" placeholder="Write a comment..." />
          <button class="btn" type="submit">Comment</button>
        </form>
      </div>
    `;

    postsEl.appendChild(el);

    const commentListEl = el.querySelector(`[data-commentlist="${p.id}"]`);
    if (commentListEl) {
      if (p._comments) {
        renderComments(commentListEl, p._comments);
      } else {
        loadCommentsForPost(p.id, commentListEl);
      }
    }
  }
}

function applySearchAndRender() {
  sortPosts();

  const q = (document.getElementById('search').value || '').trim().toLowerCase();
  if (!q) return renderPosts(allPosts);

  const filtered = allPosts.filter((p) => {
    return (
      String(p.username || '').toLowerCase().includes(q) ||
      String(p.text || '').toLowerCase().includes(q)
    );
  });

  renderPosts(filtered);
}

const debouncedSearch = debounce(applySearchAndRender, 200);

function updatePostInCache(postId, updater) {
  const idx = allPosts.findIndex(p => String(p.id) === String(postId));
  if (idx === -1) return null;
  allPosts[idx] = updater(allPosts[idx]);
  return allPosts[idx];
}

// ======== Handlers ========
async function handleCreatePost(e) {
  e.preventDefault();
  const t = requireAuth();
  if (!t) return;

  const textEl = document.getElementById('postText');
  const fileInput = document.getElementById('postImage');

  const text = (textEl.value || '').trim();
  let imageUrl = '';

  const maybeFiles = fileInput?.files;
  if (maybeFiles && maybeFiles[0]) {
    imageUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(maybeFiles[0]);
    });
  } else if (fileInput && fileInput.type === 'text') {
    imageUrl = (fileInput.value || '').trim();
  }

  if (!text && !imageUrl) {
    const err = document.getElementById('postError');
    err.style.display = 'block';
    err.textContent = 'Write something or provide an image URL.';
    return;
  }

  const optimisticPost = {
    id: '...',
    username: parseJwt(getToken()).sub,
    text: text || null,
    imageUrl: imageUrl || null,
    createdAt: Math.floor(Date.now() / 1000),
    reactions: { likes: 0, loves: 0 },
    _comments: [],
    commentCount: 0,
  };
  allPosts.unshift(optimisticPost);
  applySearchAndRender();

  try {
    const data = await api('/api/posts', { method: 'POST', body: { text: text || null, imageUrl: imageUrl || null } });
    textEl.value = '';
    if (fileInput) fileInput.value = '';
    document.getElementById('postError').style.display = 'none';

    if (data && data.post) {
      const idx = allPosts.findIndex(p => p.id === '...');
      if (idx !== -1) {
        data.post._comments = [];
        data.post.commentCount = 0;
        allPosts[idx] = data.post;
      }
    }
    applySearchAndRender();
  } catch (e) {
    allPosts = allPosts.filter(p => p.id !== '...');
    applySearchAndRender();
    const err = document.getElementById('postError');
    err.style.display = 'block';
    err.textContent = e.message || 'Failed to create post.';
  }
}

async function handleCommentSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const postId = form.getAttribute('data-commentform');
  const input = form.querySelector('input');
  const text = (input.value || '').trim();
  if (!text) return;

  const currentUser = parseJwt(getToken()).sub;

  const optimisticComment = { username: currentUser, text, createdAt: Math.floor(Date.now() / 1000) };
  const post = updatePostInCache(postId, p => {
    const comments = p._comments || [];
    p._comments = [...comments, optimisticComment];
    p.commentCount = (p.commentCount || 0) + 1;
    return p;
  });

  const commentListEl = document.querySelector(`[data-commentlist="${postId}"]`);
  if (commentListEl && post) renderComments(commentListEl, post._comments);

  input.value = '';

  try {
    await api(`/api/posts/${encodeURIComponent(postId)}/comment`, {
      method: 'POST',
      body: { text },
    });
  } catch (e) {
    updatePostInCache(postId, p => {
      p._comments = (p._comments || []).filter(c => c !== optimisticComment);
      p.commentCount = Math.max(0, (p.commentCount || 1) - 1);
      return p;
    });
    if (commentListEl && post) renderComments(commentListEl, post._comments);
  }
}

async function handleReactClick(e) {
  const btn = e.target.closest('[data-react]');
  if (!btn) return;

  const postId = btn.getAttribute('data-postid');
  const type = btn.getAttribute('data-react');

  if (type !== 'upvote') return;

  const post = updatePostInCache(postId, p => {
    p.isUpvoted = true;
    p.upvotedAt = Math.floor(Date.now() / 1000);
    return p;
  });

  if (post) {
    sortPosts();
    applySearchAndRender();
  }

  try {
    await api(`/api/posts/${encodeURIComponent(postId)}/react`, {
      method: 'POST',
      body: { reaction: type },
    });
    setTimeout(() => loadPosts(true), 2000);
  } catch {
    await loadPosts(true);
  }
}

async function handleDeleteClick(e) {
  const btn = e.target.closest('[data-delete]');
  if (!btn) return;

  const postId = btn.getAttribute('data-delete');
  if (!confirm('Are you sure you want to delete this post?')) return;

  allPosts = allPosts.filter(p => String(p.id) !== String(postId));
  applySearchAndRender();

  try {
    await api(`/api/posts/${encodeURIComponent(postId)}/delete`, { method: 'DELETE' });
  } catch {
    await loadPosts(true);
  }
}

function handleMsgUserClick(e) {
  const btn = e.target.closest('[data-msguser]');
  if (!btn) return;
  const username = btn.getAttribute('data-msguser');
  window.location.href = `messages.html?user=${encodeURIComponent(username)}`;
}

function handleLogout() {
  localStorage.removeItem(tokenKey);
  window.location.href = 'join.html';
}

window.addEventListener('DOMContentLoaded', async () => {
  requireAuth();

  document.getElementById('postForm').addEventListener('submit', handleCreatePost);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.getElementById('messagesBtn').addEventListener('click', () => {
    window.location.href = 'messages.html';
  });
  document.getElementById('search').addEventListener('input', debouncedSearch);
  document.getElementById('posts').addEventListener('submit', handleCommentSubmit);
  document.getElementById('posts').addEventListener('click', handleReactClick);
  document.getElementById('posts').addEventListener('click', handleDeleteClick);
  document.getElementById('posts').addEventListener('click', handleMsgUserClick);

  await loadPosts();
});
