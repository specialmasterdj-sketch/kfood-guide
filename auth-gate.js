// Kimchi Mart auth gate — drop this <script> into every page that needs
// gated access. Uses Firebase Auth (Google sign-in) + RTDB users/{uid}
// to check approval. Bootstrap admins (OWNER/전무) auto-approve on first
// login. Anyone else lands in 'pending' until a manager+ approves.
//
// Usage: <script type="module" src="./auth-gate.js?v=1"></script>
// Place BEFORE the page's main scripts so window.__currentUser is set.

import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getDatabase, ref, get, set, update, onValue } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';

const cfg = { apiKey:"AIzaSyDGZc-qPqtX6KxqxzC0n7iE0X_eOhLpqrM", authDomain:"kimchi-mart-order.firebaseapp.com", databaseURL:"https://kimchi-mart-order-default-rtdb.firebaseio.com", projectId:"kimchi-mart-order" };
const app = getApps().length ? getApp() : initializeApp(cfg);
const auth = getAuth(app);
const db = getDatabase(app);

// Bootstrap administrators — auto-approved with full権限 on first login.
// Email match is case-insensitive. Add more here when needed.
const BOOTSTRAP_ADMINS = {
  'specialmasterdj@gmail.com': { role: 'OWNER',     branch: '*', name: 'DJ' },
  'byhoki64@gmail.com':        { role: 'EXECUTIVE', branch: '*', name: 'B.H.K' },
};
function bootstrapFor(email){
  if (!email) return null;
  return BOOTSTRAP_ADMINS[email.toLowerCase()] || null;
}

// Pages exempt from the gate (login page itself, plus the public lookup so
// store-floor barcode scanning keeps working without forcing auth on
// shared kiosks). Add more here if needed.
const EXEMPT_PATHS = ['/auth.html', '/lookup.html'];
function isExemptPath(){
  const p = location.pathname.toLowerCase();
  return EXEMPT_PATHS.some(x => p.endsWith(x));
}

// Build the blocking overlay shown to pending / blocked users. Re-uses the
// existing host page styles for fonts so it doesn't look out of place.
function showOverlay({ kind, user, profile }){
  const existing = document.getElementById('__authGateOv');
  if (existing) existing.remove();
  const ov = document.createElement('div');
  ov.id = '__authGateOv';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(245,247,250,.98);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Segoe UI","Malgun Gothic",Arial,sans-serif';
  let title, body, color;
  if (kind === 'pending') {
    color = '#0369a1'; title = '🔒 매니저 승인 대기 중';
    body = `이 계정은 아직 승인되지 않았습니다.<br>매니저가 승인하면 자동으로 입장됩니다.`;
  } else if (kind === 'blocked') {
    color = '#dc2626'; title = '🚫 접근 차단됨';
    body = `이 계정은 차단되었습니다.<br>매니저에게 문의하세요.`;
  } else {
    color = '#dc2626'; title = '⚠️ 오류';
    body = '권한 정보를 불러올 수 없습니다.';
  }
  ov.innerHTML = `
    <div style="background:#fff;border-radius:18px;padding:34px 28px;max-width:420px;width:100%;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.10)">
      <div style="font-size:3.2em;margin-bottom:8px">🔒</div>
      <h1 style="font-size:1.3em;color:${color};margin-bottom:14px;font-weight:800">${title}</h1>
      <div style="color:#6b7280;font-size:.95em;line-height:1.6;margin-bottom:18px">${body}</div>
      ${user?.photoURL ? `<img src="${user.photoURL}" style="width:60px;height:60px;border-radius:50%;margin:0 auto 8px;display:block">` : ''}
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:10px 14px;font-size:.85em;color:#374151;margin-bottom:14px">
        ${user?.displayName ? `<b>${escapeHtml(user.displayName)}</b><br>` : ''}
        <span style="color:#6b7280">${escapeHtml(user?.email || '')}</span>
      </div>
      <button id="__authGateLogout" style="background:#374151;color:#fff;border:0;border-radius:10px;padding:10px 22px;font-weight:700;font-size:.92em;cursor:pointer">로그아웃</button>
    </div>`;
  document.body.appendChild(ov);
  document.getElementById('__authGateLogout').onclick = async () => {
    try { await signOut(auth); } catch(e){}
    location.href = './auth.html';
  };
}
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

// Sync the Firebase user profile into chat.me localStorage so existing
// pages (chat.html, tasks.html, etc.) that read chat.me keep working
// without modification. Eventually they should switch to window.__currentUser
// directly, but this keeps the migration painless.
function syncToChatMe(profile){
  if (!profile) return;
  try {
    const existing = JSON.parse(localStorage.getItem('chat.me') || '{}');
    const next = {
      ...existing,
      uid: profile.uid,
      email: profile.email,
      name: profile.name || existing.name,
      role: profile.role || existing.role,
      branch: profile.branch === '*' ? (existing.branch || 'HOLLYWOOD') : (profile.branch || existing.branch),
      photoURL: profile.photoURL || existing.photoURL,
      authProvider: 'google',
    };
    localStorage.setItem('chat.me', JSON.stringify(next));
    window.__currentUser = next;
    window.dispatchEvent(new CustomEvent('km-auth-ready', { detail: next }));
  } catch(e){ console.warn('syncToChatMe failed', e); }
}

// Core gate. Subscribes to Firebase auth state + RTDB users/{uid} so a
// manager approving this user immediately drops the overlay without a
// reload. The page keeps the overlay on top of itself instead of
// blanking the body so reload isn't strictly required either way.
let __unsubProfile = null;
function watchProfile(user){
  if (__unsubProfile) { try { __unsubProfile(); } catch(e){} __unsubProfile = null; }
  const r = ref(db, 'users/' + user.uid);
  __unsubProfile = onValue(r, async (snap) => {
    let profile = snap.val();
    if (!profile) {
      // First-time login — create record. Bootstrap admins get auto-approved.
      const boot = bootstrapFor(user.email);
      profile = {
        email: user.email,
        name: boot?.name || user.displayName || user.email.split('@')[0],
        photoURL: user.photoURL || null,
        status: boot ? 'approved' : 'pending',
        role: boot?.role || null,
        branch: boot?.branch || null,
        createdAt: Date.now(),
        approvedAt: boot ? Date.now() : null,
        approvedBy: boot ? 'bootstrap' : null,
      };
      try { await set(r, profile); } catch(e){ console.warn('create user record failed', e); }
    }
    profile.uid = user.uid;
    if (profile.status === 'approved') {
      const ov = document.getElementById('__authGateOv');
      if (ov) ov.remove();
      syncToChatMe(profile);
    } else if (profile.status === 'pending') {
      showOverlay({ kind:'pending', user, profile });
    } else if (profile.status === 'blocked') {
      showOverlay({ kind:'blocked', user, profile });
    }
  });
}

onAuthStateChanged(auth, (user) => {
  if (isExemptPath()) return; // login page handles its own flow
  if (!user) {
    // Not signed in — bounce to login, preserving where they were going
    const ret = encodeURIComponent(location.pathname + location.search);
    location.replace('./auth.html?return=' + ret);
    return;
  }
  watchProfile(user);
});

// Expose minimal API for pages that want to read auth state directly
window.__authGate = {
  signOut: () => signOut(auth).then(() => location.href = './auth.html'),
  getCurrentUser: () => window.__currentUser || null,
};
