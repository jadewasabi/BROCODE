const API_BASE = 'https://bro-code.vercel.app';

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

let allPosts = [];
let postsCache = { ids: [], timestamp: 0 };
const CACHE_TTL = 5000;
let pendingCommentFetches = {};

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

async function loadPosts(forceRefresh) {
  var now = Date.now();
  var cached = postsCache;
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
    var data = await api('/api/posts?limit=50');
    allPosts = Array.isArray(data.posts) ? data.posts : [];
    postsCache = { ids: allPosts.map(function(p) { return p.id; }), timestamp: Date.now() };
    applySearchAndRender();
  } catch (e) {
    console.warn('Failed to fetch posts:', e);
  }
}

async function loadCommentsForPost(postId, commentListEl) {
  if (pendingCommentFetches[postId]) return;
  pendingCommentFetches[postId] = true;
  try {
    var data = await api('/api/posts/' + encodeURIComponent(postId) + '/comment?limit=10');
    var comments = Array.isArray(data.comments) ? data.comments : [];
    var post = allPosts.find(function(p) { return String(p.id) === String(postId); });
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
  var html = '';
  var sliced = comments.slice(-5).reverse();
  for (var i = 0; i < sliced.length; i++) {
    var c = sliced[i];
    html += '<div class="comment"><strong>' + escapeHtml(c.username) + '</strong>: ' + escapeHtml(c.text) + '</div>';
  }
  commentListEl.innerHTML = html;
}

function sortPosts() {
  allPosts.sort(function(a, b) {
    var aUp = a.isUpvoted || a.upvotedAt;
    var bUp = b.isUpvoted || b.upvotedAt;
    if (aUp && !bUp) return -1;
    if (!aUp && bUp) return 1;
    if (aUp && bUp) return (b.upvotedAt || 0) - (a.upvotedAt || 0);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

function renderPosts(filtered) {
  var postsEl = document.getElementById('posts');
  postsEl.innerHTML = '';

  if (!filtered.length) {
    postsEl.innerHTML = '<div class="small">No posts yet.</div>';
    return;
  }

  var currentUser = parseJwt(getToken()).sub;

  for (var i = 0; i < filtered.length; i++) {
    var p = filtered[i];
    var el = document.createElement('div');
    el.className = 'post';

    var isOwner = currentUser === p.username;
    var commentCount = p.commentCount || 0;

    var html = '';
    html += '<div class="post-head">';
    html += '  <div>';
    html += '    <div class="post-user">' + escapeHtml(p.username) + '</div>';
    html += '    <div class="post-meta">' + escapeHtml(fmtTime(p.createdAt)) + '</div>';
    html += '  </div>';
    html += '  <div class="post-meta" style="display:flex;gap:8px;align-items:center;">';
    html += '    <span>#' + escapeHtml(String(p.id)) + '</span>';
    if (isOwner) {
      html += '    <button class="btn delete-btn" data-delete="' + p.id + '" title="Delete your post">🗑️ Delete</button>';
    }
    html += '  </div>';
    html += '</div>';

    if (p.imageUrl) {
      html += '<div class="post-img"><img src="' + escapeHtml(p.imageUrl) + '" alt="post image" /></div>';
    }
    if (p.text) {
      html += '<div class="post-content">' + escapeHtml(p.text) + '</div>';
    }

    html += '<div class="actions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">';
    html += '  <button class="btn react-btn upvote-btn" data-react="upvote" data-postid="' + p.id + '" title="Upvote to push to top">';
    html += '    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg> Upvote';
    html += '  </button>';
    if (p.username !== currentUser) {
      html += '  <button class="btn msg-user-btn" data-msguser="' + p.username + '" title="Message ' + escapeHtml(p.username) + '"><i class="fas fa-comment"></i> Message</button>';
    }
    html += '</div>';

    html += '<div class="comment-box">';
    html += '  <div class="comment-list" data-commentlist="' + p.id + '">';
    html += '    <div class="small">Loading comments...' + (commentCount > 0 ? ' (' + commentCount + ' total)' : '') + '</div>';
    html += '  </div>';
    html += '  <form class="comment-form" data-commentform="' + p.id + '">';
    html += '    <input type="text" required maxlength="300" placeholder="Write a comment..." />';
    html += '    <button class="btn" type="submit">Comment</button>';
    html += '  </form>';
    html += '</div>';

    el.innerHTML = html;
    postsEl.appendChild(el);

    var commentListEl = el.querySelector('[data-commentlist="' + p.id + '"]');
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
  var q = (document.getElementById('search').value || '').trim().toLowerCase();
  if (!q) return renderPosts(allPosts);
  var filtered = allPosts.filter(function(p) {
    return String(p.username || '').toLowerCase().includes(q) || String(p.text || '').toLowerCase().includes(q);
  });
  renderPosts(filtered);
}

var debouncedSearch = debounce(applySearchAndRender, 200);

function updatePostInCache(postId, updater) {
  var idx = allPosts.findIndex(function(p) { return String(p.id) === String(postId); });
  if (idx === -1) return null;
  allPosts[idx] = updater(allPosts[idx]);
  return allPosts[idx];
}

async function handleCreatePost(e) {
  e.preventDefault();
  var t = requireAuth();
  if (!t) return;

  var textEl = document.getElementById('postText');
  var fileInput = document.getElementById('postImage');
  var text = (textEl.value || '').trim();
  var imageUrl = '';

  var maybeFiles = fileInput && fileInput.files;
  if (maybeFiles && maybeFiles[0]) {
    imageUrl = await new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(String(reader.result || '')); };
      reader.onerror = reject;
      reader.readAsDataURL(maybeFiles[0]);
    });
  } else if (fileInput && fileInput.type === 'text') {
    imageUrl = (fileInput.value || '').trim();
  }

  if (!text && !imageUrl) {
    var err = document.getElementById('postError');
    err.style.display = 'block';
    err.textContent = 'Write something or provide an image URL.';
    return;
  }

  var optimisticPost = {
    id: '...',
    username: parseJwt(getToken()).sub,
    text: text || null,
    imageUrl: imageUrl || null,
    createdAt: Math.floor(Date.now() / 1000),
    reactions: { likes: 0, loves: 0 },
    _comments: [],
    commentCount: 0
  };
  allPosts.unshift(optimisticPost);
  applySearchAndRender();

  try {
    var data = await api('/api/posts', { method: 'POST', body: { text: text || null, imageUrl: imageUrl || null } });
    textEl.value = '';
    if (fileInput) fileInput.value = '';
    document.getElementById('postError').style.display = 'none';

    if (data && data.post) {
      var idx = allPosts.findIndex(function(p) { return p.id === '...'; });
      if (idx !== -1) {
        data.post._comments = [];
        data.post.commentCount = 0;
        allPosts[idx] = data.post;
      }
    }
    applySearchAndRender();
  } catch (e) {
    allPosts = allPosts.filter(function(p) { return p.id !== '...'; });
    applySearchAndRender();
    var err = document.getElementById('postError');
    err.style.display = 'block';
    err.textContent = e.message || 'Failed to create post.';
  }
}

async function handleCommentSubmit(e) {
  e.preventDefault();
  var form = e.target;
  var postId = form.getAttribute('data-commentform');
  var input = form.querySelector('input');
  var text = (input.value || '').trim();
  if (!text) return;

  var currentUser = parseJwt(getToken()).sub;
  var optimisticComment = { username: currentUser, text: text, createdAt: Math.floor(Date.now() / 1000) };
  var post = updatePostInCache(postId, function(p) {
    var comments = p._comments || [];
    p._comments = comments.concat([optimisticComment]);
    p.commentCount = (p.commentCount || 0) + 1;
    return p;
  });

  var commentListEl = document.querySelector('[data-commentlist="' + postId + '"]');
  if (commentListEl && post) renderComments(commentListEl, post._comments);
  input.value = '';

  try {
    await api('/api/posts/' + encodeURIComponent(postId) + '/comment', { method: 'POST', body: { text: text } });
  } catch (e) {
    updatePostInCache(postId, function(p) {
      p._comments = (p._comments || []).filter(function(c) { return c !== optimisticComment; });
      p.commentCount = Math.max(0, (p.commentCount || 1) - 1);
      return p;
    });
    if (commentListEl && post) renderComments(commentListEl, post._comments);
  }
}

async function handleReactClick(e) {
  var btn = e.target.closest('[data-react]');
  if (!btn) return;
  var postId = btn.getAttribute('data-postid');
  var type = btn.getAttribute('data-react');
  if (type !== 'upvote') return;

  var post = updatePostInCache(postId, function(p) {
    p.isUpvoted = true;
    p.upvotedAt = Math.floor(Date.now() / 1000);
    return p;
  });

  if (post) {
    sortPosts();
    applySearchAndRender();
  }

  try {
    await api('/api/posts/' + encodeURIComponent(postId) + '/react', { method: 'POST', body: { reaction: type } });
    setTimeout(function() { loadPosts(true); }, 2000);
  } catch (e) {
    await loadPosts(true);
  }
}

async function handleDeleteClick(e) {
  var btn = e.target.closest('[data-delete]');
  if (!btn) return;
  var postId = btn.getAttribute('data-delete');
  if (!confirm('Are you sure you want to delete this post?')) return;

  allPosts = allPosts.filter(function(p) { return String(p.id) !== String(postId); });
  applySearchAndRender();

  try {
    await api('/api/posts/' + encodeURIComponent(postId) + '/delete', { method: 'DELETE' });
  } catch (e) {
    await loadPosts(true);
  }
}

function handleMsgUserClick(e) {
  var btn = e.target.closest('[data-msguser]');
  if (!btn) return;
  var username = btn.getAttribute('data-msguser');
  window.location.href = 'messages.html?user=' + encodeURIComponent(username);
}

function handleLogout() {
  localStorage.removeItem(tokenKey);
  window.location.href = 'join.html';
}

window.addEventListener('DOMContentLoaded', async function() {
  requireAuth();

  document.getElementById('postForm').addEventListener('submit', handleCreatePost);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.getElementById('messagesBtn').addEventListener('click', function() {
    window.location.href = 'messages.html';
  });
  document.getElementById('search').addEventListener('input', debouncedSearch);
  document.getElementById('posts').addEventListener('submit', handleCommentSubmit);
  document.getElementById('posts').addEventListener('click', handleReactClick);
  document.getElementById('posts').addEventListener('click', handleDeleteClick);
  document.getElementById('posts').addEventListener('click', handleMsgUserClick);

  await loadPosts();
});
