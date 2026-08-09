// ============================================================
// me-persist.js — chat.me localStorage 영구화 백업 레이어
// ============================================================
// 목적: iOS Safari ITP 7일 룰 / 브라우저 데이터 정리로 chat.me 가
// localStorage에서 사라져도 cookie + IndexedDB 백업에서 자동 복원.
//
// 사용: 모든 페이지에서 다른 스크립트보다 먼저 로드.
//   <script src="./me-persist.js?v=1"></script>
//
// 동작:
//   1) 즉시 cookie 에서 chat.me 동기 복원 시도 (가장 빠름)
//   2) IndexedDB 에서 비동기 복원 (cookie 도 비어있을 때)
//   3) localStorage.setItem('chat.me', ...) 호출을 가로채 cookie + IDB 미러링
// ============================================================
(function(){
  'use strict';

  var KEY = 'chat.me';
  var COOKIE_NAME = 'chat_me';
  var COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1년 (Safari ITP는 7일로 제한하지만 그래도 백업)
  var IDB_NAME = 'kimchi_persist';
  var IDB_STORE = 'kv';

  // ---------- Cookie helpers ----------
  function setCookie(name, value){
    try {
      var v = encodeURIComponent(value);
      // SameSite=Lax 로 외부 도메인 누수 방지, Secure 는 HTTPS 에서만
      var secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = name + '=' + v + '; Max-Age=' + COOKIE_MAX_AGE + '; Path=/; SameSite=Lax' + secure;
    } catch(e){}
  }
  function getCookie(name){
    try {
      var prefix = name + '=';
      var parts = document.cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        if (p.indexOf(prefix) === 0) return decodeURIComponent(p.substring(prefix.length));
      }
    } catch(e){}
    return null;
  }
  function deleteCookie(name){
    try { document.cookie = name + '=; Max-Age=0; Path=/; SameSite=Lax'; } catch(e){}
  }

  // ---------- IndexedDB helpers (async, 자체적으로 복원) ----------
  function openIdb(){
    return new Promise(function(resolve, reject){
      try {
        var req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = function(){ try { req.result.createObjectStore(IDB_STORE); } catch(e){} };
        req.onsuccess = function(){ resolve(req.result); };
        req.onerror = function(){ reject(req.error); };
      } catch(e){ reject(e); }
    });
  }
  function idbSet(value){
    return openIdb().then(function(db){
      return new Promise(function(resolve, reject){
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(value, KEY);
          tx.oncomplete = function(){ resolve(); };
          tx.onerror = function(){ reject(tx.error); };
        } catch(e){ reject(e); }
      });
    }).catch(function(){ /* IDB 없으면 무시 */ });
  }
  function idbGet(){
    return openIdb().then(function(db){
      return new Promise(function(resolve){
        try {
          var tx = db.transaction(IDB_STORE, 'readonly');
          var req = tx.objectStore(IDB_STORE).get(KEY);
          req.onsuccess = function(){ resolve(req.result || null); };
          req.onerror = function(){ resolve(null); };
        } catch(e){ resolve(null); }
      });
    }).catch(function(){ return null; });
  }
  function idbDel(){
    return openIdb().then(function(db){
      return new Promise(function(resolve){
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).delete(KEY);
          tx.oncomplete = function(){ resolve(); };
          tx.onerror = function(){ resolve(); };
        } catch(e){ resolve(); }
      });
    }).catch(function(){});
  }

  // ---------- 동기 복원: cookie 우선 (페이지 로드와 함께 즉시 적용) ----------
  function restoreFromCookieSync(){
    try {
      if (localStorage.getItem(KEY)) return false; // 이미 있으면 패스
      var v = getCookie(COOKIE_NAME);
      if (v) {
        // 유효한 JSON 인지 한 번 파싱해 확인 후 그대로 저장
        JSON.parse(v);
        // setItem 가로채기 패치 전이라 직접 setItem 사용해도 무한 루프 X
        localStorage.setItem(KEY, v);
        return true;
      }
    } catch(e){}
    return false;
  }

  // ---------- 비동기 복원: IDB (cookie 도 비어있을 때) ----------
  function restoreFromIdbAsync(){
    if (localStorage.getItem(KEY)) return Promise.resolve(false);
    return idbGet().then(function(v){
      if (!v) return false;
      try {
        JSON.parse(v);
        localStorage.setItem(KEY, v);
        // cookie 도 다시 채워둠 — 다음 번엔 동기 복원으로 바로 됨
        setCookie(COOKIE_NAME, v);
        // 페이지의 다른 코드가 chat.me 갱신을 알도록 storage 이벤트 모방
        try { window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: v })); } catch(e){}
        return true;
      } catch(e){ return false; }
    });
  }

  // ---------- 쓰기 미러링: localStorage.setItem('chat.me', …) 가로채기 ----------
  // 이렇게 해야 chat.html / 다른 페이지가 기존 코드 그대로 setItem 해도
  // cookie + IDB 가 자동으로 갱신됨. removeItem 도 같이 처리.
  var origSet = localStorage.setItem.bind(localStorage);
  var origRemove = localStorage.removeItem.bind(localStorage);
  localStorage.setItem = function(k, v){
    origSet(k, v);
    if (k === KEY) {
      setCookie(COOKIE_NAME, v);
      idbSet(v);
    }
  };
  localStorage.removeItem = function(k){
    origRemove(k);
    if (k === KEY) {
      deleteCookie(COOKIE_NAME);
      idbDel();
    }
  };

  // ---------- 즉시 실행 ----------
  var restoredSync = restoreFromCookieSync();
  // cookie 가 비어있어도 IDB 에서 살아있을 수 있으니 비동기 fallback
  if (!restoredSync) {
    // DOM 준비 후/이전 무관하게 비동기로 복원 시도
    restoreFromIdbAsync().then(function(ok){
      if (ok) console.log('[me-persist] IDB 에서 chat.me 복원 완료');
    });
  } else {
    // cookie 로 복원 성공했지만 IDB 도 같이 동기화 보장
    idbSet(getCookie(COOKIE_NAME) || '');
  }

  // 외부에서 명시적으로 호출 가능한 API
  window.__mePersist = {
    save: function(meObj){
      var v = typeof meObj === 'string' ? meObj : JSON.stringify(meObj);
      localStorage.setItem(KEY, v);
    },
    load: function(){
      try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e){ return null; }
    },
    clear: function(){ localStorage.removeItem(KEY); },
    restoredFromCookie: restoredSync,
  };
})();

// =============================================================
// 🔐 계정-신원 동기화 (2026-08-09 사장님 지시: "계정 접속의 정확성이 최우선")
// 이름은 이제 기기 설정이 아니라 로그인 계정 소속이다.
// 문자 인증으로 로그인한 계정(users/{uid})에 등록된 이름·지점·역할이
// 이 기기의 chat.me 와 다르면 계정 기록으로 강제 교체한다.
//  - 대상: 전화 인증 계정 + 승인됨 + 실명 등록된 계정 (83/122)
//  - 제외: 이름이 아직 전화번호 그대로인 계정(명부 등록 대기), 이메일 공유 계정
//    (여러 매니저가 같이 쓰는 manager@ 등 — 이후 단계에서 개인 계정 전환)
//  - 오너/전무(branch='*')는 지점 강제 없음 (보던 지점 유지)
// 실행: 페이지 로드 후 fb-auth-ready 시 + 4초 후 1회 + 10분마다 재확인.
// =============================================================
(function(){
  'use strict';
  var FB = 'https://kimchi-mart-order-default-rtdb.firebaseio.com';
  var syncing = false;
  function isMgrRole(role){ return /(OWNER|EXECUTIVE|MANAGER|SUPERVISOR)/i.test(String(role || '')); }
  async function syncIdentity(){
    if (syncing) return;
    syncing = true;
    try {
      if (typeof window.__getAuthToken !== 'function') return;   // 인증 래퍼 없는 페이지
      var tok = await window.__getAuthToken();
      if (!tok) return;
      var uid = null, tokPhone = null;
      try { var pl = JSON.parse(atob(tok.split('.')[1])); uid = pl.user_id; tokPhone = pl.phone_number || null; } catch(e){}
      if (!uid) return;
      var r = await fetch(FB + '/users/' + uid + '.json?t=' + Date.now(), { cache:'no-store' });
      if (!r.ok) return;
      var u = await r.json();
      if (!u || u.status !== 'approved' || !u.name) return;
      var nm = String(u.name).trim();
      var digits = String(u.phone || tokPhone || '').replace(/\D/g, '');
      // 실명 미등록(이름=전화번호) 계정은 강제하지 않음 — 명부(Staff Phone Registration) 등록 후 자동 적용
      if (!nm || /^\+?\d+$/.test(nm) || (digits && nm.replace(/\D/g,'') === digits)) return;
      // 이메일 공유 계정(전화 미연결)은 아직 강제하지 않음
      if (!u.phone && !tokPhone) return;
      var cur = null;
      try { cur = JSON.parse(localStorage.getItem('chat.me') || 'null'); } catch(e){}
      var wantBranch = (u.branch && u.branch !== '*') ? u.branch : ((cur && cur.branch) || 'MIAMI');
      var wantRole = u.role || (cur && cur.role) || '';
      if (cur && cur.name === nm && cur.branch === wantBranch && String(cur.role || '') === String(wantRole)) return;   // 이미 일치
      var next = {
        name: nm,
        branch: wantBranch,
        color: (cur && cur.color) || undefined,
        role: wantRole,
        isManager: isMgrRole(wantRole),
        _acctSync: Date.now(),   // 계정 동기화 표식
      };
      if (next.color === undefined) delete next.color;
      localStorage.setItem('chat.me', JSON.stringify(next));
      try { window.dispatchEvent(new Event('km-identity-changed')); } catch(e){}
      try { window.dispatchEvent(new StorageEvent('storage', { key:'chat.me', newValue: JSON.stringify(next) })); } catch(e){}
      try { console.log('[identity-sync] 계정 기록으로 신원 적용:', nm, wantBranch, wantRole); } catch(e){}
    } catch(e){} finally { syncing = false; }
  }
  window.addEventListener('fb-auth-ready', function(){ syncIdentity(); });
  setTimeout(syncIdentity, 4000);
  setInterval(syncIdentity, 10 * 60 * 1000);
  window.__kmSyncIdentity = syncIdentity;
})();

// =============================================================
// PWA SW auto-reload (2026-05-17)
// sw.js가 새 버전 activate → 페이지 자동 리로드. 매니저가 코드/설정
// 업데이트하면 직원 핸드폰에서 핸드폰 재부팅 없이도 즉시 반영.
// =============================================================
(function(){
  if (!('serviceWorker' in navigator)) return;
  // 페이지 로드 시점에 이미 SW가 페이지를 제어하고 있었는지 기록.
  // false 라면 (= 첫 SW 등록) 그 직후 한 번의 controllerchange는 정상이므로 무시.
  var hadControllerOnLoad = !!navigator.serviceWorker.controller;
  var reloaded = false;
  // 🛑 2026-07-18 — 사용 중 강제 리로드 금지 강화 (사장님 신고: 작업 중 페이지 사라짐).
  //   기존: 활성 입력칸에 값 있을 때만 1회 연기(재시도 없음 → 사실상 즉시 리로드).
  //   변경: 입력값이 어디든 있거나 최근 2분 내 조작이 있으면 연기, 60초마다 재확인,
  //   한가할 때만 리로드. 리로드 직전 보던 위치 저장(__kmSaveResumeState) 호출.
  function userBusy(){
    try {
      var el = document.activeElement;
      if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'file')) && el.value) return true;
      var tas = document.querySelectorAll('textarea');
      for (var i = 0; i < tas.length; i++) if (tas[i].value) return true;
      if (window.__kmLastActivity && Date.now() - window.__kmLastActivity < 120000) return true;
    } catch(_){}
    return false;
  }
  var pendingReloadReason = null;
  function tryPendingReload(){
    if (reloaded || !pendingReloadReason) return;
    if (userBusy()) { setTimeout(tryPendingReload, 60000); return; }
    reloaded = true;
    try { console.log('[sw-autoreload]', pendingReloadReason); } catch(e){}
    try { if (typeof window.__kmSaveResumeState === 'function') window.__kmSaveResumeState(); } catch(e){}
    setTimeout(function(){ try { location.reload(); } catch(e){} }, 300);
  }
  function safeReload(reason){
    if (reloaded) return;
    pendingReloadReason = reason;
    tryPendingReload();
  }
  // 1) sw.js가 보내는 'sw-updated' 메시지 수신
  navigator.serviceWorker.addEventListener('message', function(e){
    if (e && e.data && e.data.type === 'sw-updated') safeReload('sw-updated');
  });
  // 2) SW controller 변경 (새 SW가 페이지 제어권 가져옴)
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    if (!hadControllerOnLoad) {
      // 첫 SW 등록의 정상적인 controllerchange — 한 번만 허용
      hadControllerOnLoad = true;
      return;
    }
    safeReload('controllerchange');
  });
  // 3) 주기적 update() — 장시간 켜둔 PWA도 새 버전을 체크
  function pollUpdate(){
    try {
      navigator.serviceWorker.getRegistrations().then(function(rs){
        rs.forEach(function(r){ try { r.update(); } catch(e){} });
      });
    } catch(e){}
  }
  setInterval(pollUpdate, 5 * 60 * 1000); // 5분
  // 4) 페이지 visible 복귀 시에도 즉시 체크 (백그라운드에서 깨어났을 때)
  document.addEventListener('visibilitychange', function(){
    if (document.visibilityState === 'visible') pollUpdate();
  });
})();
