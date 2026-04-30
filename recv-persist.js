// ============================================================
// recv-persist.js — 입고 스캔 데이터(마스터/세션) IndexedDB 영구 백업
// ============================================================
// 목적: localStorage 가 ITP/캐시정리로 비워져도 IDB 에서 자동 복원.
// chat.me 와 달리 데이터가 크므로(수만 항목 = 수 MB) cookie 백업 X.
//
// 사용: receiving-scan.html 에서 me-persist.js 다음에 로드.
//   <script src="./recv-persist.js?v=1"></script>
//
// 동작:
//   1) 페이지 로드 시 — recv.master.v1 또는 recv.v1 가 localStorage 에
//      없으면 IDB 에서 비동기 복원 후 storage 이벤트 발사 → 앱이 reload.
//   2) localStorage.setItem(recv.*) 가로채기 — IDB 미러링 (debounce 500ms).
// ============================================================
(function(){
  'use strict';

  var KEYS = ['recv.master.v1', 'recv.v1', 'recv.settings.v1'];
  var IDB_NAME = 'kimchi_persist';
  var IDB_STORE = 'kv';

  // ---------- IndexedDB helpers ----------
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
  function idbSet(key, value){
    return openIdb().then(function(db){
      return new Promise(function(resolve, reject){
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(value, key);
          tx.oncomplete = function(){ resolve(); };
          tx.onerror = function(){ reject(tx.error); };
        } catch(e){ reject(e); }
      });
    }).catch(function(){});
  }
  function idbGet(key){
    return openIdb().then(function(db){
      return new Promise(function(resolve){
        try {
          var tx = db.transaction(IDB_STORE, 'readonly');
          var req = tx.objectStore(IDB_STORE).get(key);
          req.onsuccess = function(){ resolve(req.result || null); };
          req.onerror = function(){ resolve(null); };
        } catch(e){ resolve(null); }
      });
    }).catch(function(){ return null; });
  }
  function idbDel(key){
    return openIdb().then(function(db){
      return new Promise(function(resolve){
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).delete(key);
          tx.oncomplete = function(){ resolve(); };
          tx.onerror = function(){ resolve(); };
        } catch(e){ resolve(); }
      });
    }).catch(function(){});
  }

  // ---------- Debounced writer ----------
  var __pending = {};
  function scheduleWrite(key, val){
    if (__pending[key] && __pending[key].timer) clearTimeout(__pending[key].timer);
    __pending[key] = {
      val: val,
      timer: setTimeout(function(){
        idbSet(key, __pending[key].val);
        __pending[key].timer = null;
      }, 500)
    };
  }

  // ---------- 비동기 복원 (페이지 로드 시) ----------
  function restoreAll(){
    return Promise.all(KEYS.map(function(k){
      return new Promise(function(resolve){
        try {
          if (localStorage.getItem(k)) return resolve(false);
        } catch(e){ return resolve(false); }
        idbGet(k).then(function(v){
          if (v == null) return resolve(false);
          try {
            localStorage.setItem(k, v);
            // 같은 페이지의 코드가 변경 알도록 storage 이벤트 모방
            try { window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: v })); } catch(_){}
            resolve(true);
          } catch(e){ resolve(false); }
        });
      });
    }));
  }

  // ---------- localStorage.setItem 가로채기 — IDB 미러링 ----------
  // me-persist.js 가 이미 setItem 을 패치했을 수 있음. 그 위에 다시 패치.
  var origSet = localStorage.setItem.bind(localStorage);
  var origRemove = localStorage.removeItem.bind(localStorage);
  localStorage.setItem = function(k, v){
    origSet(k, v);
    if (KEYS.indexOf(k) !== -1) scheduleWrite(k, v);
  };
  localStorage.removeItem = function(k){
    origRemove(k);
    if (KEYS.indexOf(k) !== -1) idbDel(k);
  };

  // ---------- 즉시 실행 ----------
  // 페이지 로드 시 IDB 복원 시도. 복원되면 페이지가 reload 또는 자동 갱신.
  restoreAll().then(function(results){
    var anyRestored = results.some(Boolean);
    if (anyRestored) {
      console.log('[recv-persist] IDB 에서 복원됨 — 앱 재초기화 권장');
      // receiving-scan.html 의 loadAll() 가 이미 실행됐을 수 있음.
      // 복원된 데이터 반영하려면 reload — 단, 무한루프 방지 위해 한 번만.
      try {
        if (!sessionStorage.getItem('__recvPersistReloaded')) {
          sessionStorage.setItem('__recvPersistReloaded', '1');
          location.reload();
        }
      } catch(e){}
    } else {
      try { sessionStorage.removeItem('__recvPersistReloaded'); } catch(e){}
    }
  });

  // 명시적 API
  window.__recvPersist = {
    snapshotNow: function(){
      KEYS.forEach(function(k){
        try {
          var v = localStorage.getItem(k);
          if (v != null) idbSet(k, v);
        } catch(e){}
      });
    },
    restoreAll: restoreAll,
    keys: KEYS
  };
})();
