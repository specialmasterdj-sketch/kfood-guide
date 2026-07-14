// Kimchi Mart auth gate — drop this <script> into every page that needs
// gated access. Uses Firebase Auth (Google sign-in) + RTDB users/{uid}
// to check approval. Bootstrap admins (OWNER/전무) auto-approve on first
// login. Anyone else lands in 'pending' until a manager+ approves.
//
// Usage: <script type="module" src="./auth-gate.js?v=5"></script>
// Place BEFORE the page's main scripts so window.__currentUser is set.
//
// ⚡ v5 (2026-07-13) 전 지점 재인증 루프 수정:
//   전화 인증 직후 RTDB 실시간연결(SDK onValue) auth 부착이 지연/유실되면 프로필이
//   영영 안 와서 → 화면 무한 로딩 → 28초 escape → fresh=1 강제 로그아웃 → 재인증 루프.
//   auth.html 이 이미 쓰는 REST+명시토큰+재시도 방식을 게이트에도 1차로 적용하고,
//   onValue 는 라이브 승인 갱신용 best-effort 로만 사용. 실패 시엔 조용히 튕기지 않고
//   정확한 원인(HTTP 코드)을 화면에 표시 + km.authTrace 에 기록.

import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence, indexedDBLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getDatabase, ref, get, set, update, onValue } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';

const cfg = { apiKey:"AIzaSyBwL0Wa1Q8aFhZp5hsn9gTw5aZwXUdAVy4", authDomain:"kimchi-mart-order.firebaseapp.com", databaseURL:"https://kimchi-mart-order-default-rtdb.firebaseio.com", projectId:"kimchi-mart-order" };
const app = getApps().length ? getApp() : initializeApp(cfg);
const auth = getAuth(app);
const db = getDatabase(app);
// 명시적 persistence — IndexedDB 우선 (PWA · iOS 에서 cookie/localStorage
// 보다 오래 살아남음), 실패 시 localStorage fallback. 페이지 이동 / 앱 재시작
// 마다 재로그인 요구되는 핵심 원인이 persistence 미설정이었음.
setPersistence(auth, indexedDBLocalPersistence)
  .catch(() => setPersistence(auth, browserLocalPersistence))
  .catch(e => console.warn('[auth-gate] setPersistence failed', e));

// 🩺 진단 breadcrumb — 마지막 40개 이벤트를 localStorage 에 남겨 auth.html 이
// 로그인 화면에서 '왜 튕겼는지' 자동 표시. 원격 진단(스크린샷 한 장)용.
function gateTrace(ev, extra){
  try {
    const k = 'km.authTrace';
    const a = JSON.parse(localStorage.getItem(k) || '[]');
    a.push({ t: Date.now(), p: (location.pathname.split('/').pop() || '/'), e: ev, x: extra == null ? null : String(extra).slice(0, 120) });
    while (a.length > 40) a.shift();
    localStorage.setItem(k, JSON.stringify(a));
  } catch(_){}
}
// 로그인 화면으로 돌려보낼 때 사유 전달 — auth.html 진단 박스가 읽음.
function setBounce(reason){
  try { sessionStorage.setItem('km.authBounce', JSON.stringify({ t: Date.now(), from: location.pathname.split('/').pop(), reason })); } catch(_){}
}

// Bootstrap administrators — auto-approved with full権限 on first login.
// Email match is case-insensitive. Add more here when needed.
const BOOTSTRAP_ADMINS = {
  'specialmasterdj@gmail.com': { role: 'OWNER',     branch: '*', name: 'DJ' },
  'byhoki64@gmail.com':        { role: 'EXECUTIVE', branch: '*', name: 'B.H.K' },
  'kdaisy81@yahoo.com':        { role: 'OWNER',     branch: '*', name: 'Sun Kim' },
};
function bootstrapFor(email){
  if (!email) return null;
  return BOOTSTRAP_ADMINS[email.toLowerCase()] || null;
}
// 전화번호 로그인 관리자 자동승인 (E.164 +1XXXXXXXXXX). auth.html 의 BOOTSTRAP_PHONES 와 동기 유지.
const BOOTSTRAP_PHONES = {
  '+13059264744': { role: 'EXECUTIVE', branch: '*', name: 'B.H.K' },
  '+19544945025': { role: 'OWNER',     branch: '*', name: 'DJ' },
};
function bootstrapForPhone(phone){ return phone ? (BOOTSTRAP_PHONES[String(phone).trim()] || null) : null; }
function bootstrapForUser(user){ return bootstrapFor(user && user.email) || bootstrapForPhone(user && user.phoneNumber); }

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
        <span style="color:#6b7280">${escapeHtml(user?.email || user?.phoneNumber || '')}</span>
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

// ⚠️ 프로필 읽기/생성 실패 — 예전처럼 조용히 로그아웃·리다이렉트(=재인증 루프) 하지 않고
// 정확한 원인을 화면에 남김. 401/permission 이면 서버 규칙 문제 → 스크린샷으로 원인 확정 가능.
function showGateError(user, errText, what){
  const existing = document.getElementById('__authGateOv');
  if (existing) existing.remove();
  const isPerm = /401|403|permission/i.test(String(errText||''));
  const hint = isPerm
    ? '접근 권한 문제로 보입니다.<br><b>이 화면을 캡처해 매니저/사장님께 보내주세요.</b>'
    : '네트워크 문제일 수 있습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.';
  const ov = document.createElement('div');
  ov.id = '__authGateOv';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(245,247,250,.98);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Segoe UI","Malgun Gothic",Arial,sans-serif';
  ov.innerHTML = `
    <div style="background:#fff;border-radius:18px;padding:30px 26px;max-width:420px;width:100%;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.10)">
      <div style="font-size:3em;margin-bottom:8px">⚠️</div>
      <h1 style="font-size:1.2em;color:#b45309;margin-bottom:12px;font-weight:800">${what || '계정 정보를 불러오지 못했습니다'}</h1>
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:9px 12px;font-size:.85em;color:#92400e;font-weight:700;margin-bottom:12px">오류: ${escapeHtml(errText || 'unknown')} · ${escapeHtml(location.pathname.split('/').pop() || '')}</div>
      <div style="color:#6b7280;font-size:.92em;line-height:1.6;margin-bottom:16px">${hint}</div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:8px 12px;font-size:.8em;color:#6b7280;margin-bottom:16px">${escapeHtml(user?.email || user?.phoneNumber || '')}</div>
      <button id="__gateRetry" style="background:#1a5c3a;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-weight:800;font-size:.95em;cursor:pointer;width:100%;margin-bottom:8px">🔄 다시 시도</button>
      <button id="__gateOut" style="background:#f1f5f9;color:#374151;border:0;border-radius:10px;padding:10px;font-weight:700;font-size:.88em;cursor:pointer;width:100%">로그아웃 후 재로그인</button>
    </div>`;
  document.body.appendChild(ov);
  document.getElementById('__gateRetry').onclick = () => location.reload();
  document.getElementById('__gateOut').onclick = async () => {
    try { await signOut(auth); } catch(_){}
    setBounce('gate-error-manual-relogin: ' + (errText || ''));
    location.href = './auth.html';
  };
}

// Sync the Firebase user profile into chat.me localStorage so existing
// pages (chat.html, tasks.html, etc.) that read chat.me keep working
// without modification. Eventually they should switch to window.__currentUser
// directly, but this keeps the migration painless.
function syncToChatMe(profile){
  if (!profile) return;
  try {
    const existing = JSON.parse(localStorage.getItem('chat.me') || '{}');
    const boot = bootstrapFor(profile.email);
    // 이름 결정 정책:
    //  1) Bootstrap admin (DJ, B.H.K) → canonical name
    //  2) 로컬에 본인이 직접 선택한 개인 이름 있음 → 절대 덮어쓰지 않음
    //  3) 둘 다 아니면 — Firebase profile name 이 generic ("manager","Staff") 이면 빈 문자열로 두고
    //     chat.html 의 me-modal 이 본인 이름 선택을 강제. profile.name 을 그대로 박으면
    //     공유 계정 사용자가 "manager"/"Staff" 로 메시지 올림.
    const GENERIC = ['staff','manager','employee','admin','user','직원','매니저','스태프','사원','관리자'];
    function _isGeneric(n){ return !n || GENERIC.includes(String(n).toLowerCase().trim()); }
    let finalName;
    if (boot) {
      finalName = boot.name;
    } else if (existing.name && !_isGeneric(existing.name)) {
      finalName = existing.name;
    } else if (profile.name && !_isGeneric(profile.name)) {
      finalName = profile.name;
    } else {
      finalName = '';   // ← me-modal 강제 트리거
    }
    // 🔐 SECURITY (2026-05-14): role 은 RTDB users/{uid}/role 이 권위 — 다만
    // 정상 매니저들 (RTDB users 레코드에 role 미설정인 케이스가 있음) 의
    // 권한이 사라지지 않도록 existing.role fallback 유지. 진짜 OWNER 가장
    // 차단은 RTDB rules (users/{uid}/role write 권한) + apps.html identity
    // picker 의 매니저급 role 픽 거부로 처리.
    const authoritativeRole = profile.role || existing.role || '';
    const isMgr = ['OWNER','EXECUTIVE','MANAGER','ASSISTANT_MANAGER','SUPERVISOR'].includes(authoritativeRole);
    // 🔒 2026-05-15: 비매니저(스태프)는 RTDB users/{uid}/branch 가 권위 —
    // chat.me.branch 가 다르면 강제 보정. 코럴 직원이 헐리우드 들어가 입력하던
    // 사건 해결. profile.branch === '*' 는 글로벌 admin(DJ/B.H.K) 한정으로만 의미.
    let authoritativeBranch;
    if (isMgr) {
      // 매니저급은 다른 지점 참고 가능 — 기존 chat.me 우선
      authoritativeBranch = existing.branch || (profile.branch === '*' ? 'HOLLYWOOD' : profile.branch) || 'HOLLYWOOD';
    } else {
      // 스태프 — RTDB profile.branch 강제. '*' 면 폴백.
      authoritativeBranch = (profile.branch && profile.branch !== '*') ? profile.branch
                          : (existing.branch || 'HOLLYWOOD');
      if (existing.branch && existing.branch !== authoritativeBranch) {
        console.warn('[auth-gate] 스태프 chat.me.branch (' + existing.branch + ') ≠ RTDB (' + authoritativeBranch + ') — 강제 보정');
      }
    }
    const next = {
      ...existing,
      uid: profile.uid,
      email: profile.email,
      name: finalName,
      status: profile.status || existing.status,
      role: authoritativeRole,
      branch: authoritativeBranch,
      photoURL: profile.photoURL || existing.photoURL,
      isManager: isMgr,
      authProvider: 'google',
    };
    localStorage.setItem('chat.me', JSON.stringify(next));
    window.__currentUser = next;
    window.dispatchEvent(new CustomEvent('km-auth-ready', { detail: next }));
  } catch(e){ console.warn('syncToChatMe failed', e); }
}

// ===== REST + 명시 토큰 헬퍼 (auth.html 과 동일 패턴) =====
// 전화 인증 직후 토큰이 RTDB 에 전파되기 전 첫 요청이 401/네트워크로 실패하는
// 케이스 → 토큰 강제 갱신하며 3회 재시도.
async function _restGetProfile(user){
  let tok = '';
  try { tok = await user.getIdToken(); } catch(_){}
  let lastErr = null;
  for (let i = 0; i < 3; i++){
    try {
      const r = await fetch(cfg.databaseURL + '/users/' + user.uid + '.json?auth=' + encodeURIComponent(tok), { cache:'no-store' });
      if (r.ok) return { ok: true, val: await r.json() };
      lastErr = 'HTTP ' + r.status;
    } catch(e){ lastErr = (e && e.message) || String(e); }
    await new Promise(res => setTimeout(res, 400 + i*300));
    try { tok = await user.getIdToken(true); } catch(_){}
  }
  return { ok: false, err: lastErr || 'unknown' };
}
async function _restPutProfile(user, profile){
  let tok = '';
  try { tok = await user.getIdToken(); } catch(_){}
  let lastErr = null;
  for (let i = 0; i < 3; i++){
    try {
      const r = await fetch(cfg.databaseURL + '/users/' + user.uid + '.json?auth=' + encodeURIComponent(tok), {
        method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(profile) });
      if (r.ok) return { ok: true };
      lastErr = 'HTTP ' + r.status;
    } catch(e){ lastErr = (e && e.message) || String(e); }
    await new Promise(res => setTimeout(res, 400 + i*300));
    try { tok = await user.getIdToken(true); } catch(_){}
  }
  return { ok: false, err: lastErr || 'unknown' };
}
async function _restGet(path, user){
  try {
    const tok = await user.getIdToken();
    const r = await fetch(cfg.databaseURL + '/' + path + '.json?auth=' + encodeURIComponent(tok), { cache:'no-store' });
    if (r.ok) return await r.json();
  } catch(_){}
  return undefined;   // 실패 (null 데이터와 구분)
}

// Core gate — v5: 프로필 확인은 REST(재시도)로 즉시 결정, onValue 는 라이브 승인
// 갱신용 best-effort. 매니저 승인 반영은 pending 상태에서 15초 REST 폴링이 백업.
let __unsubProfile = null;
let __gateResolved = false;   // 프로필 결정(또는 명시적 에러 표시) 완료 — 28초 escape 억제
let __gateBusy = false;
let __gateUid = null;
let __pendingPoll = null;

function applyStatus(user, profile){
  profile.uid = user.uid;
  __gateResolved = true;
  if (profile.status === 'approved') {
    const ov = document.getElementById('__authGateOv');
    if (ov) ov.remove();
    if (__pendingPoll) { clearInterval(__pendingPoll); __pendingPoll = null; }
    syncToChatMe(profile);
  } else if (profile.status === 'pending') {
    showOverlay({ kind:'pending', user, profile });
    // onValue 가 죽어있어도 매니저 승인이 반영되도록 REST 폴링 백업
    if (!__pendingPoll) {
      __pendingPoll = setInterval(async () => {
        try {
          const res = await _restGetProfile(user);
          if (res.ok && res.val) applyStatus(user, res.val);
        } catch(_){}
      }, 15000);
    }
  } else if (profile.status === 'blocked') {
    // 🔒 SECURITY (2026-05-28): 차단 시 즉시 토큰 무효화 + localStorage 제거.
    // 토큰을 살려두면 콘솔에서 chat.me 조작으로 우회 가능. signOut → 토큰 만료
    // → RTDB rules 가 모든 요청 거부. 차단 화면 3초 보여주고 강제 redirect.
    if (__pendingPoll) { clearInterval(__pendingPoll); __pendingPoll = null; }
    showOverlay({ kind:'blocked', user, profile });
    try { localStorage.removeItem('chat.me'); } catch(_){}
    try { sessionStorage.clear(); } catch(_){}
    Promise.resolve(signOut(auth)).catch(()=>{});
    setTimeout(() => { try { location.replace('./auth.html?blocked=1'); } catch(_){} }, 3500);
  }
}

function _attachLiveProfile(user){
  if (__unsubProfile) { try { __unsubProfile(); } catch(e){} __unsubProfile = null; }
  try {
    const r = ref(db, 'users/' + user.uid);
    __unsubProfile = onValue(r,
      (snap) => { const p = snap.val(); if (p) applyStatus(user, p); },
      (err)  => { gateTrace('gate:onValue-err', err && (err.code || err.message)); });
  } catch(e){ gateTrace('gate:onValue-attach-fail', e && e.message); }
}

async function watchProfile(user){
  // onAuthStateChanged 다중 발화 / visibilitychange 재진입 가드
  if (__gateBusy) return;
  if (__gateResolved && __gateUid === user.uid) return;
  __gateBusy = true;
  __gateUid = user.uid;
  try {
    gateTrace('gate:profile-check', user.phoneNumber || user.email || user.uid.slice(0,8));
    const res = await _restGetProfile(user);
    if (!res.ok) {
      // 예전: SDK onValue 만 기다리다 무한 로딩 → escape → 강제 로그아웃 루프.
      // 이제: 원인(HTTP 코드)을 화면에 표시하고 멈춤 — 세션은 유지 (재시도 가능).
      gateTrace('gate:profile-read-fail', res.err);
      __gateResolved = true;
      showGateError(user, res.err, '계정 정보를 불러오지 못했습니다');
      return;
    }
    let profile = res.val;
    if (!profile) {
      // First-time login — create record. Bootstrap admins get auto-approved.
      const boot = bootstrapForUser(user);
      // 방식2: 매니저가 미리 등록한 전화번호(phoneRoster)면 PIN·승인 없이 자동 승인.
      let roster = null;
      if (!boot && user.phoneNumber) {
        try {
          const rk = String(user.phoneNumber).replace(/\D/g, '');
          const v = await _restGet('phoneRoster/' + rk, user);
          if (v) roster = v;
        } catch(_){}
      }
      const eff = boot || roster;
      // 사용자가 auth.html 에서 가입 직전 직접 고른 지점/이름이 chat.me 에 있으면
      // users/{uid} 에도 미리 채워둠 — 어드민 승인 페이지에서 매장이 빈칸으로 뜨던 문제.
      let preBranch = null, preName = null, preRole = null;
      try {
        const me = JSON.parse(localStorage.getItem('chat.me') || '{}');
        if (me && typeof me === 'object') {
          if (me.branch && me.branch !== '*') preBranch = me.branch;
          if (me.name) preName = me.name;
          if (me.role) preRole = me.role;
        }
      } catch(_){}

      // 신규 가입자 PIN 검증 — bootstrap/roster 가 아니면 매장 PIN 일치해야 가입 허용.
      // 모르는 사람이 본인 gmail 로 임의 가입하던 문제 차단.
      if (!eff) {
        let joinPin = '';
        try { joinPin = sessionStorage.getItem('km.joinPin') || ''; } catch(_){}
        // PIN 비어있거나 매장 안 골랐으면 가입 차단
        if (!joinPin || !preBranch) {
          gateTrace('gate:pin-missing-signout', (preBranch||'') + '/' + (user.phoneNumber||user.email||''));
          setBounce('신규 계정으로 인식됨 — 매장 가입 PIN 필요 (기존 직원이라면 users 기록/전화번호 명단 문제)');
          await signOut(auth).catch(()=>{});
          const msg = '🔐 매장 가입 PIN이 필요합니다.\n매니저에게 본인 매장 4자리 PIN을 받아 입력해주세요.';
          try { alert(msg); } catch(_){}
          try { sessionStorage.removeItem('km.joinPin'); } catch(_){}
          location.replace('./auth.html');
          return;
        }
        // RTDB 의 매장 PIN 과 비교 (REST — SDK get 은 전화인증 직후 hang 가능)
        const dbPin = await _restGet('joinPins/' + preBranch, user);
        if (dbPin === undefined) {
          gateTrace('gate:pin-verify-fail', preBranch);
          setBounce('매장 PIN 검증 실패 (읽기 오류)');
          await signOut(auth).catch(()=>{});
          try { alert('PIN 검증 실패. 다시 시도하세요.'); } catch(_){}
          location.replace('./auth.html');
          return;
        }
        if (!dbPin || String(dbPin).trim() !== String(joinPin).trim()) {
          gateTrace('gate:pin-mismatch', preBranch);
          setBounce('매장 PIN 불일치');
          await signOut(auth).catch(()=>{});
          try { alert('❌ 매장 PIN이 일치하지 않습니다. 매니저에게 다시 확인하세요.'); } catch(_){}
          try { sessionStorage.removeItem('km.joinPin'); } catch(_){}
          location.replace('./auth.html');
          return;
        }
        // 검증 통과 — PIN 흔적 제거 (재사용 방지)
        try { sessionStorage.removeItem('km.joinPin'); } catch(_){}
      }

      profile = {
        email: user.email || null,
        phone: user.phoneNumber || null,
        name: boot?.name || roster?.name || preName || user.displayName || (user.email ? user.email.split('@')[0] : (user.phoneNumber || ('user-' + String(user.uid).slice(0,5)))),
        photoURL: user.photoURL || null,
        status: eff ? 'approved' : 'pending',
        role: boot?.role || roster?.role || preRole || null,
        branch: boot?.branch || roster?.branch || preBranch || null,
        createdAt: Date.now(),
        approvedAt: eff ? Date.now() : null,
        approvedBy: boot ? 'bootstrap' : (roster ? 'roster' : null),
      };
      const put = await _restPutProfile(user, profile);
      if (!put.ok) {
        gateTrace('gate:profile-create-fail', put.err);
        __gateResolved = true;
        showGateError(user, put.err, '계정 생성에 실패했습니다');
        return;
      }
    } else {
      // Existing record — if email is in BOOTSTRAP_ADMINS but the record
      // is still pending or missing role/branch (e.g. created before the
      // bootstrap entry was added), upgrade it in place. Without this,
      // pages like approve.html that gate on profile.role keep rejecting.
      const boot = bootstrapForUser(user);
      if (boot && (profile.status !== 'approved' || profile.role !== boot.role || profile.name !== boot.name)) {
        const upgraded = Object.assign({}, profile, {
          status: 'approved',
          role: boot.role,
          branch: boot.branch,
          name: boot.name,
          approvedAt: profile.approvedAt || Date.now(),
          approvedBy: profile.approvedBy || 'bootstrap-upgrade',
        });
        const put = await _restPutProfile(user, upgraded);
        if (put.ok) profile = upgraded;
        else gateTrace('gate:bootstrap-upgrade-fail', put.err);
      }
    }
    gateTrace('gate:profile-ok', profile.status + '/' + (profile.role || '') );
    applyStatus(user, profile);
    _attachLiveProfile(user);   // 라이브 승인/차단 갱신 (best-effort)
  } finally {
    __gateBusy = false;
  }
}

// 페이지 이동마다 즉시 redirect 하던 게 전 지점 불만 (iOS / 느린 망에서
// IndexedDB persistence 가 200ms~수초 늦게 복원되는 동안 잠깐 null 로 발화됨).
// chat.me 에 이전에 로그인한 흔적 있으면 Firebase auth 가 복원될 때까지 너그럽게 기다림.
// (uid 없는 옛 형식 chat.me 도 호환 — email 또는 name+branch 만 있어도 로그인 흔적으로 인정)
let __redirected = false;
let __waitingForRestore = false;

async function _maybeRedirect(user){
  if (isExemptPath()) return;
  // 🚨 2026-05-15: 익명 사용자 함정 차단 — fb-auth-fetch / km-firebase 가
  // 익명 가입 fallback 으로 만든 user 가 managed 페이지에 도달하면 auth-gate
  // 가 watchProfile → joinPin 체크 → signOut → redirect 사이클 hang.
  // 익명 user 는 무조건 로그아웃 + auth.html 로.
  if (user && user.isAnonymous) {
    console.warn('[auth-gate] anonymous user on managed page → forcing sign-out + redirect');
    gateTrace('gate:anonymous-signout');
    try { await signOut(auth); } catch(_){}
    if (!__redirected) {
      __redirected = true;
      setBounce('익명 세션 감지 — 재로그인 필요');
      const ret = encodeURIComponent(location.pathname + location.search);
      location.replace('./auth.html?fresh=1&return=' + ret);
    }
    return;
  }
  if (user) {
    __waitingForRestore = false;
    watchProfile(user);
    return;
  }
  // 동시에 두 번 안 들어오게 — onAuthStateChanged 가 multiple 발화 가능
  if (__waitingForRestore) return;

  let cached = null;
  try { cached = JSON.parse(localStorage.getItem('chat.me') || 'null'); } catch(_){}
  // 옛 chat.me 형식도 호환: uid 없어도 email / name+branch 만 있으면 "전에 로그인함" 인정.
  const hadPreviousLogin = cached && (
    cached.email ||
    cached.uid ||
    (cached.name && cached.branch)
  );

  // 2026-06-08 사장님 지시 (앱 느려짐 조사): 20초 대기는 happy-path 사용자에게
  // 너무 길어서 로그인 느낌. iOS Safari IndexedDB cold-start 대부분 3초 이내
  // 완료 → 5초로 줄임. 그래도 안 되면 로그인 페이지로 (사용자가 재시도 가능).
  // ⚡ v5: chat.me 가 없어도(지워졌어도) 1.5초는 기다림 — 세션 복원이 리다이렉트에
  // 지는 race 로 멀쩡히 로그인된 사용자가 로그인 화면으로 튕기던 케이스 방지.
  __waitingForRestore = true;
  const waitMs = hadPreviousLogin ? 5000 : 1500;
  const restored = await new Promise(resolve => {
    let done = false;
    const finish = (u) => { if (!done){ done = true; resolve(u); } };
    const TIMEOUT = setTimeout(() => finish(null), waitMs);
    const poll = setInterval(() => {
      if (auth.currentUser){ clearInterval(poll); clearTimeout(TIMEOUT); finish(auth.currentUser); }
    }, 120);
  });
  __waitingForRestore = false;
  if (restored){
    console.info('[auth-gate] auth restored from persistence');
    gateTrace('gate:restored-late');
    watchProfile(restored);
    return;
  }
  if (hadPreviousLogin) console.warn('[auth-gate] persistence empty — redirecting to login');
  // 🛡️ Race fix: 폴링 끝났어도 다른 onAuthStateChanged 발화가 watchProfile 호출했을
  // 가능성 — 프로필 확인이 시작됐으면 redirect 막음 (불필요한 cycle 방지).
  if (__unsubProfile || __gateResolved || __gateBusy) return;
  if (__redirected) return;
  __redirected = true;
  gateTrace('gate:redirect-login', hadPreviousLogin ? 'session-restore-timeout' : 'no-login-history');
  setBounce(hadPreviousLogin ? '로그인 세션 복원 실패 (기기에서 세션이 사라짐)' : '');
  const ret = encodeURIComponent(location.pathname + location.search);
  location.replace('./auth.html?return=' + ret);
}

onAuthStateChanged(auth, (user) => { _maybeRedirect(user); });

// 🚨 2026-05-15: 로딩 무한 spinner 방지 — 페이지 로드 28초 후에도 auth 결정 안
// 났으면 사용자에게 escape 옵션 제공. ⚡ v5: escape 가 fresh=1(강제 로그아웃) 로
// 보내던 것이 재인증 루프의 마지막 고리 — 이제 기본 버튼은 로그아웃 없이 auth.html
// (세션 살아있으면 자동 복귀), 강제 초기화는 별도 버튼.
setTimeout(() => {
  if (isExemptPath()) return;
  // 프로필 확인이 이미 끝났으면(정상/에러표시 포함) 통과
  if (__unsubProfile || __gateResolved) return;
  if (auth.currentUser && !auth.currentUser.isAnonymous) return;
  if (document.getElementById('__authGateEscape')) return;
  gateTrace('gate:escape-28s');
  setBounce('28초 로그인 확인 실패 (escape 화면)');
  const esc = document.createElement('div');
  esc.id = '__authGateEscape';
  esc.style.cssText = 'position:fixed;inset:0;background:rgba(245,247,250,.98);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Segoe UI","Malgun Gothic",Arial,sans-serif';
  esc.innerHTML = ''
    + '<div style="background:#fff;border-radius:18px;padding:34px 28px;max-width:420px;width:100%;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.10)">'
    +   '<div style="font-size:3em;margin-bottom:8px">⏳</div>'
    +   '<h1 style="font-size:1.2em;color:#dc2626;margin-bottom:14px;font-weight:800">로딩이 너무 오래 걸려요</h1>'
    +   '<div style="color:#6b7280;font-size:.92em;line-height:1.6;margin-bottom:18px">'
    +     '28초 동안 로그인 확인이 안 됐습니다.<br>로그인 화면으로 이동해서 다시 시도해 주세요.'
    +   '</div>'
    +   '<button onclick="location.replace(\'./auth.html\')" style="background:#1a5c3a;color:#fff;border:0;border-radius:10px;padding:13px 28px;font-weight:800;font-size:.95em;cursor:pointer;font-family:inherit;width:100%;margin-bottom:8px">🔁 로그인 화면으로</button>'
    +   '<button onclick="location.reload()" style="background:#f1f5f9;color:#374151;border:0;border-radius:10px;padding:11px;font-weight:700;font-size:.88em;cursor:pointer;font-family:inherit;width:100%;margin-bottom:8px">🔄 페이지 새로고침</button>'
    +   '<button onclick="location.replace(\'./auth.html?fresh=1\')" style="background:#fff;color:#b91c1c;border:1px solid #fecaca;border-radius:10px;padding:10px;font-weight:700;font-size:.82em;cursor:pointer;font-family:inherit;width:100%">🧹 완전 초기화 후 처음부터 로그인</button>'
    + '</div>';
  document.body.appendChild(esc);
}, 28000);

// PWA / 모바일 브라우저 — 백그라운드에서 돌아왔을 때 IndexedDB 가
// 늦게 깨면 잘못된 logout 으로 보임. visibilitychange 에서 currentUser
// 다시 확인. 이미 로그인된 상태면 noop.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !auth.currentUser && !__redirected){
    // 한 번 더 시도 — currentUser 가 곧 채워질 가능성
    setTimeout(() => {
      if (auth.currentUser){
        console.info('[auth-gate] resumed — auth restored on visibility change');
        watchProfile(auth.currentUser);
      }
    }, 500);
  }
});

// Expose minimal API for pages that want to read auth state directly
window.__authGate = {
  signOut: () => signOut(auth).then(() => location.href = './auth.html'),
  getCurrentUser: () => window.__currentUser || null,
};
