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
