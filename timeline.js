// IMPORTANT: If you are hosting timeline.html on GitHub Pages / file://,
// set API_BASE to your Vercel deployment URL (origin only).
// Example: const API_BASE = 'https://aid4programmers.vercel.app';
// TODO: set this to your Vercel app origin (leave trailing slash off).
// If you deploy to Vercel, set it to: https://<YOUR_VERCE_L_APP>.vercel.app
const API_BASE = 'https://aid-4-prog.vercel.app';



// If you open timeline.html from local filesystem, set API_BASE to your Vercel domain.
// Example: const API_BASE = 'https://your-project.vercel.app';


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
  if (body instanceof FormData) {
    // not used currently
  } else if (body) {
    headers['Content-Type'] = 'application/json';
  }
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

let allPosts = [];

function renderPosts(filtered) {
  const postsEl = document.getElementById('posts');
  postsEl.innerHTML = '';
  if (!filtered.length) {
    postsEl.innerHTML = '<div class="small">No posts yet.</div>';
    return;
  }

  for (const p of filtered) {
    const el = document.createElement('div');
    el.className = 'post';

    const commentHtml = (p.comments || [])
      .slice(-5)
      .map(
        (c) =>
          `<div class="comment"><strong>${escapeHtml(c.username)}</strong>: ${escapeHtml(c.text)}</div>`
      )
      .join('');

    el.innerHTML = `
      <div class="post-head">
        <div>
          <div class="post-user">${escapeHtml(p.username)}</div>
          <div class="post-meta">${escapeHtml(fmtTime(p.createdAt))}</div>
        </div>
        <div class="post-meta">#${escapeHtml(String(p.id))}</div>
      </div>

      ${p.imageUrl ? `<div class="post-img"><img src="${escapeHtml(p.imageUrl)}" alt="post image" /></div>` : ''}

      ${p.text ? `<div class="post-content">${escapeHtml(p.text)}</div>` : ''}

      <div class="actions">
        <button class="btn react-btn" data-react="like" data-postid="${p.id}"><span class="icon">👍</span> Like (<span class="likeCount">${p.reactions?.likes ?? 0}</span>)</button>
        <button class="btn react-btn" data-react="love" data-postid="${p.id}"><span class="icon">❤️</span> Love (<span class="loveCount">${p.reactions?.loves ?? 0}</span>)</button>
      </div>

      <div class="comment-box">
        <div class="comment-list">${commentHtml || '<div class="small">No comments yet.</div>'}</div>
        <form class="comment-form" data-commentform="${p.id}">
          <input type="text" required maxlength="300" placeholder="Write a comment..." />
          <button class="btn" type="submit">Comment</button>
        </form>
      </div>
    `;

    postsEl.appendChild(el);
  }
}

async function loadPosts() {
  const data = await api('/api/posts');
  allPosts = Array.isArray(data.posts) ? data.posts : [];

  // Debug to verify timeline GET response and that renderPosts is fed data
  console.log('loadPosts GET /api/posts =>', data);
  console.log('allPosts length:', allPosts.length);
  console.log('posts array from response:', data?.posts);
  if (data && data.env) console.log('GET /api/posts env:', data.env);


  applySearchAndRender();
}


function applySearchAndRender() {
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

async function handleCreatePost(e) {
  e.preventDefault();
  const t = requireAuth();
  if (!t) return;

  const text = document.getElementById('postText').value.trim();
// NOTE: <input type="file"> requires multipart/form-data; right now backend expects imageUrl.
// This UI still lets you choose a file; we convert it to a data URL (demo). For production, upload should be done separately.
let imageUrl = '';
const fileEl = document.getElementById('postImage');
const file = fileEl && fileEl.files && fileEl.files[0];
if (file) {
  imageUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
} else {
  imageUrl = '';
}

  if (!text && !imageUrl) {

    const err = document.getElementById('postError');
    err.style.display = 'block';
    err.textContent = 'Write something or provide an image URL.';
    return;
  }

const payload = {
    text: text || null,
    imageUrl: imageUrl || null,
  };

  try {
    const created = await api('/api/posts', { method: 'POST', body: payload });
    // helpful for debugging if it isn't rendering
    console.log('post created:', created);
  } catch (err) {
    const msg = err?.message || String(err);
    const errEl = document.getElementById('postError');
    errEl.style.display = 'block';
    errEl.textContent = msg;
    return;
  }


  document.getElementById('postText').value = '';
  document.getElementById('postImage').value = '';
  await loadPosts();
}

async function handleCommentSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const postId = form.getAttribute('data-commentform');
  const input = form.querySelector('input');
  const text = (input.value || '').trim();
  if (!text) return;

const created = await api(`/api/posts/${encodeURIComponent(postId)}/comment`, {
    method: 'POST',
    body: { text },
  });
  console.log('comment created:', created);

  input.value = '';
  await loadPosts();
}

async function handleReactClick(e) {
  const btn = e.target.closest('[data-react]');
  if (!btn) return;

  const postId = btn.getAttribute('data-postid');
  const type = btn.getAttribute('data-react');

const updated = await api(`/api/posts/${encodeURIComponent(postId)}/react`, {
    method: 'POST',
    body: { reaction: type },
  });
  console.log('reaction updated:', updated);

  await loadPosts();
}

function handleLogout() {
  localStorage.removeItem(tokenKey);
  window.location.href = 'join.html';
}

window.addEventListener('DOMContentLoaded', async () => {
  requireAuth();

  document.getElementById('postForm').addEventListener('submit', handleCreatePost);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.getElementById('search').addEventListener('input', applySearchAndRender);
  document.getElementById('posts').addEventListener('submit', handleCommentSubmit);
  document.getElementById('posts').addEventListener('click', handleReactClick);

  await loadPosts();
});

