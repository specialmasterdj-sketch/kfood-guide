// Kimchi Mart — Chat message queue (IndexedDB-backed auto-retry).
//
// 배경: 작업 완료 → 평가방 채팅 발송이 토큰 만료 (1시간) / 네트워크 / 401 등으로
// 실패하면 매니저가 수동으로 메시지를 다시 만들어 올려야 했음. 매일 발생하는 짐.
//
// 동작:
//   1. 메시지를 IndexedDB 큐에 먼저 enqueue (RTDB 발송 전에)
//   2. RTDB 발송 시도 → 성공이면 dequeue, 실패면 큐에 남김
//   3. 페이지 로드 / 토큰 갱신 이벤트 / 5분마다 retryAll() 자동 실행
//   4. 화면 우상단 뱃지에 대기 건수 표시 — 직원이 시각적으로 인지
//
// 사용:
//   <script src="./km-chat-queue.js?v=1"></script>
//   await kmChatQueue.send({ room:'meat_evalution_room', msgId, msg, roomPatch });
//      → 자동으로 큐에 저장 → RTDB 시도 → 실패 시 다음 retryAll() 때 재시도
//   kmChatQueue.retryAll()   // 수동 재시도
//   kmChatQueue.getPendingCount()
//   kmChatQueue.subscribeChange(fn)   // 큐 변화 콜백 (뱃지 갱신용)

(function(){
  const DB_NAME = 'kimchi-mart-chat-queue';
  const DB_VERSION = 1;
  const STORE = 'pending';        // key: room+'/'+msgId, value: { room, msgId, msg, roomPatch, queuedAt, attempts, lastError }
  const FB_DB = 'https://kimchi-mart-order-default-rtdb.firebaseio.com';
  const MAX_ATTEMPTS = 100;   // 100번 시도해도 안 되면 stuck 표시 (실질적으로 무한 재시도)

  let dbPromise = null;
  function openDB(){
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB not supported')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  function txn(mode){
    return openDB().then(db => db.transaction(STORE, mode).objectStore(STORE));
  }
  function reqToPromise(req){
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function qKey(room, msgId){ return room + '/' + msgId; }

  async function put(entry){
    const store = await txn('readwrite');
    return reqToPromise(store.put(entry, qKey(entry.room, entry.msgId)));
  }
  async function remove(room, msgId){
    const store = await txn('readwrite');
    return reqToPromise(store.delete(qKey(room, msgId)));
  }
  async function getAll(){
    const store = await txn('readonly');
    return reqToPromise(store.getAll());
  }

  // 변화 알림 — 뱃지 갱신용
  const listeners = new Set();
  function subscribeChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }
  async function notifyChange(){
    try {
      const count = (await getAll()).length;
      listeners.forEach(fn => { try { fn(count); } catch(_){} });
    } catch(_){}
  }

  // 토큰 발급 — fb-auth-fetch 의 getIdToken 활용. forceRefresh=true 로 만료 회피.
  async function getAuthQ(){
    try {
      let tok = '';
      // 1) fb-auth-fetch 가 노출한 함수
      if (window.__getAuthToken) tok = await window.__getAuthToken();
      // 2) Firebase SDK currentUser
      if (!tok && window.__fb?.auth?.currentUser){
        tok = await window.__fb.auth.currentUser.getIdToken(true);
      }
      return tok ? '?auth=' + encodeURIComponent(tok) : '';
    } catch(_){ return ''; }
  }

  // 한 건 발송 시도 — 성공 true / 실패 false
  async function trySend(entry){
    try {
      const authQ = await getAuthQ();
      const url = FB_DB + '/chat/messages/' + entry.room + '/' + entry.msgId + '.json' + authQ;
      const r = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.msg)
      });
      if (!r.ok){
        const errText = await r.text().catch(()=>'');
        entry.lastError = 'HTTP ' + r.status + ' ' + errText.slice(0,80);
        return false;
      }
      // room preview patch (실패해도 메시지 자체는 저장됐으니 silent)
      if (entry.roomPatch){
        fetch(FB_DB + '/chat/rooms/' + entry.room + '.json' + authQ, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry.roomPatch)
        }).catch(()=>{});
      }
      return true;
    } catch(e){
      entry.lastError = String(e?.message || e).slice(0,120);
      return false;
    }
  }

  // 외부 API — enqueue + 즉시 시도
  async function send({ room, msgId, msg, roomPatch }){
    if (!room || !msgId || !msg) throw new Error('send() missing room/msgId/msg');
    const entry = { room, msgId, msg, roomPatch: roomPatch||null, queuedAt: Date.now(), attempts: 0, lastError: null };
    await put(entry);
    await notifyChange();
    // 즉시 1차 시도
    entry.attempts = 1;
    const ok = await trySend(entry);
    if (ok){
      await remove(room, msgId);
      await notifyChange();
      return { ok: true, queued: false };
    }
    // 실패 — 큐에 남김 (attempts/lastError 업데이트)
    await put(entry);
    await notifyChange();
    console.warn('[chat-queue] enqueued for retry —', entry.room, entry.msgId, entry.lastError);
    return { ok: false, queued: true, error: entry.lastError };
  }

  // 큐 전체 재시도
  let _retrying = false;
  async function retryAll(){
    if (_retrying) return;
    _retrying = true;
    let okCount = 0, failCount = 0;
    try {
      const all = await getAll();
      for (const entry of all){
        if (entry.attempts >= MAX_ATTEMPTS) continue;
        entry.attempts++;
        const ok = await trySend(entry);
        if (ok){
          await remove(entry.room, entry.msgId);
          okCount++;
        } else {
          await put(entry);
          failCount++;
        }
      }
      if (okCount > 0 || failCount > 0) await notifyChange();
      if (okCount > 0) console.info('[chat-queue] retried —', okCount, 'sent,', failCount, 'still pending');
    } finally {
      _retrying = false;
    }
    return { okCount, failCount };
  }

  async function getPendingCount(){
    try { return (await getAll()).length; } catch(_){ return 0; }
  }
  async function getPending(){
    return await getAll();
  }

  // 페이지 로드 → 자동 재시도. 5분마다, 토큰 갱신 후, 네트워크 복귀 후.
  function _autoStart(){
    setTimeout(() => retryAll().catch(()=>{}), 2000);   // 페이지 로드 2초 후
    setInterval(() => retryAll().catch(()=>{}), 5 * 60 * 1000);  // 5분마다
    window.addEventListener('fb-auth-revived', () => retryAll().catch(()=>{}));
    window.addEventListener('online', () => retryAll().catch(()=>{}));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') retryAll().catch(()=>{});
    });
  }

  // 뱃지 UI — 페이지에 자동 삽입. 큐가 비어있으면 숨김.
  function _autoBadge(){
    if (document.getElementById('__kmChatQueueBadge')) return;
    const badge = document.createElement('div');
    badge.id = '__kmChatQueueBadge';
    badge.style.cssText = 'position:fixed;bottom:14px;right:14px;background:#dc2626;color:#fff;padding:8px 14px;border-radius:20px;font-size:.84em;font-weight:800;z-index:9998;display:none;box-shadow:0 4px 14px rgba(220,38,38,.4);cursor:pointer;font-family:Segoe UI,Malgun Gothic,Arial,sans-serif';
    badge.title = '발송 실패한 채팅 메시지가 대기 중. 클릭하면 즉시 재시도.';
    badge.onclick = async () => {
      badge.textContent = '⏳ 재시도 중...';
      const r = await retryAll();
      if (r.okCount > 0) {
        try { alert('✅ ' + r.okCount + '건 발송 완료' + (r.failCount > 0 ? ' / 실패 ' + r.failCount + '건' : '')); } catch(_){}
      } else if (r.failCount > 0) {
        try { alert('⚠️ ' + r.failCount + '건 여전히 실패. 로그인 상태 / 네트워크 확인 후 다시 시도.'); } catch(_){}
      }
    };
    document.body.appendChild(badge);
    subscribeChange(count => {
      if (count > 0){
        badge.style.display = '';
        badge.textContent = '📤 채팅 대기 ' + count + '건 (탭하여 재시도)';
      } else {
        badge.style.display = 'none';
      }
    });
    // 최초 상태 반영
    getPendingCount().then(c => {
      if (c > 0){
        badge.style.display = '';
        badge.textContent = '📤 채팅 대기 ' + c + '건 (탭하여 재시도)';
      }
    });
  }

  window.kmChatQueue = { send, retryAll, getPendingCount, getPending, subscribeChange };

  // 초기화 — DOM ready 후 뱃지 + 자동 재시도
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { _autoBadge(); _autoStart(); });
  } else {
    _autoBadge(); _autoStart();
  }
})();
