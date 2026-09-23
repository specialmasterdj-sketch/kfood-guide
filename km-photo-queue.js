/* km-photo-queue.js — 📷 사진 업로드 대기열 (2026-09-23)
 *
 * 왜: 매장 와이파이가 약하면 사진 업로드가 25초를 넘겨 실패하고, 직원은 완료 보고를
 *     못 한 채 "사진이 안 올라가요" 로 끝난다. 업무는 끝냈는데 기록이 안 남는다.
 *     → 보고는 먼저 저장하고, 사진은 폰에 넣어 두었다가 연결될 때 알아서 올린다.
 *
 * 흐름: enqueue(사진) → IndexedDB 에 보관 → flush() 가 하나씩 Storage 로 올림 →
 *       성공하면 그 업무의 photos 배열에 URL 을 덧붙이고 대기열에서 지운다.
 *       실패하면 그대로 두고 (앱 열 때 · 온라인 될 때 · 60초마다) 다시 시도한다.
 *       실패는 diag/photoFail 에도 남겨, "정말 안 올라갔는지" 나중에 숫자로 확인한다.
 *
 * 사진은 폰 안(IndexedDB)에 있으므로 앱을 껐다 켜도, 폰을 재시작해도 남아 있다.
 * base64 로 DB 에 박지 않는다 — 그게 하루치 40MB 를 만들어 폰을 멈추게 했던 원인이다.
 */
(function(){
  const DB_NAME = 'kmPhotoQ', STORE = 'items', DB_VER = 1;
  const FB = 'https://kimchi-mart-order-default-rtdb.firebaseio.com';
  const BUCKET = 'kimchi-mart-order.firebasestorage.app';
  const S = { fb: null, busy: false, timer: null, listeners: [], lastCount: 0 };

  function openDb(){
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function tx(mode, fn){
    const db = await openDb();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode), st = t.objectStore(STORE);
      let out;
      try { out = fn(st); } catch(e){ rej(e); return; }
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  }
  const all = () => tx('readonly', st => st.getAll());
  const put = (rec) => tx('readwrite', st => st.put(rec));
  const del = (id) => tx('readwrite', st => st.delete(id));

  function notify(n){
    S.lastCount = n;
    S.listeners.forEach(fn => { try { fn(n); } catch(e){} });
    paint(n);
  }
  async function count(){ try { const rows = await all(); notify(rows.length); return rows.length; } catch(e){ return 0; } }

  // 화면 아래 작은 띠 — 몇 장이 남았는지 직원이 알 수 있게 (없으면 안 보인다)
  function paint(n){
    let el = document.getElementById('kmPhotoQBar');
    if (!n){ if (el) el.style.display = 'none'; return; }
    if (!el){
      el = document.createElement('div');
      el.id = 'kmPhotoQBar';
      el.style.cssText = 'position:fixed;left:10px;right:10px;bottom:10px;z-index:9998;background:#0f172a;color:#fff;' +
        'border-radius:12px;padding:10px 14px;font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.28);font-family:inherit';
      el.innerHTML = '<span id="kmPhotoQTxt" style="flex:1"></span>' +
        '<button type="button" id="kmPhotoQBtn" style="border:0;background:#22c55e;color:#062e16;border-radius:8px;padding:6px 10px;font-weight:800;cursor:pointer">지금 올리기</button>';
      document.body.appendChild(el);
      el.querySelector('#kmPhotoQBtn').onclick = () => flush(true);
    }
    el.style.display = 'flex';
    const on = navigator.onLine !== false;
    el.querySelector('#kmPhotoQTxt').textContent = S.busy
      ? ('📷 사진 올리는 중… ' + n + '장 남음')
      : (on ? ('📷 사진 ' + n + '장 대기 중 — 곧 자동으로 올립니다') : ('📷 사진 ' + n + '장 대기 — 인터넷 연결되면 자동으로 올라갑니다'));
  }

  function init(fb){ S.fb = fb || null; count(); schedule(); }
  function onChange(fn){ S.listeners.push(fn); }

  // 사진 한 장을 대기열에 넣는다. file 은 이미 압축된 Blob/File.
  async function enqueue(item){
    const rec = {
      id: 'p' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      ts: Date.now(), tries: 0, lastErr: '',
      branch: item.branch || '', date: item.date || '', taskId: item.taskId || '',
      field: item.field || 'photos',           // photos | checklist/{i}/photos
      name: item.name || '', by: item.by || '',
      blob: item.file,
    };
    await put(rec);
    await count();
    schedule(1200);
    return rec.id;
  }

  function schedule(ms){
    clearTimeout(S.timer);
    S.timer = setTimeout(() => flush(), ms || 60000);
  }

  async function uploadOne(rec){
    const path = 'tasks/' + rec.branch + '/' + rec.date + '/' + rec.taskId + '/' + rec.id + '.jpg';
    // 1) SDK (로그인 토큰 자동) — 실패하면 REST 로 한 번 더
    if (S.fb && S.fb.st && S.fb.sRef && S.fb.uploadBytes && S.fb.getDownloadURL){
      const ref = S.fb.sRef(S.fb.st, path);
      const snap = await S.fb.uploadBytes(ref, rec.blob, { contentType: 'image/jpeg' });
      return await S.fb.getDownloadURL(snap.ref);
    }
    let auth = {};
    try { const tok = (typeof window.__getAuthToken === 'function') ? await window.__getAuthToken() : null; if (tok) auth = { Authorization: 'Firebase ' + tok }; } catch(e){}
    const r = await fetch('https://firebasestorage.googleapis.com/v0/b/' + BUCKET + '/o?name=' + encodeURIComponent(path) + '&uploadType=media',
      { method: 'POST', headers: Object.assign({ 'Content-Type': 'image/jpeg' }, auth), body: rec.blob });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const meta = await r.json();
    return 'https://firebasestorage.googleapis.com/v0/b/' + BUCKET + '/o/' + encodeURIComponent(meta.name) + '?alt=media&token=' + (meta.downloadTokens || '');
  }

  // 업로드된 URL 을 그 업무의 사진 목록 뒤에 붙인다 (다른 사람이 그 사이 올린 것도 지키려고 읽고 나서 붙인다)
  async function attach(rec, url){
    const base = FB + '/tasks/' + rec.branch + '/' + rec.date + '/' + rec.taskId;
    const cur = await fetch(base + '/' + rec.field + '.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
    const arr = Array.isArray(cur) ? cur.slice() : [];
    arr.push(url);
    const body = {}; body[rec.field.split('/').pop()] = arr;
    const target = rec.field.indexOf('/') >= 0 ? base + '/' + rec.field.split('/').slice(0, -1).join('/') : base;
    const w = await fetch(target + '.json', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!w.ok) throw new Error('attach ' + w.status);
  }

  // 실패를 남긴다 — "안 올라간다" 가 사실인지 나중에 숫자로 본다
  function logFail(rec, stage, err){
    try {
      const day = new Date().toISOString().slice(0, 10);
      fetch(FB + '/diag/photoFail/' + day + '.json', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ts: Date.now(), branch: rec.branch, by: rec.by, task: rec.taskId, name: rec.name,
          stage: stage, err: String(err && err.message || err).slice(0, 180), tries: rec.tries,
          size: (rec.blob && rec.blob.size) || 0, online: navigator.onLine !== false,
          ua: String(navigator.userAgent || '').slice(0, 120) }) }).catch(() => {});
    } catch(e){}
  }

  async function flush(manual){
    if (S.busy) return;
    let rows = [];
    try { rows = await all(); } catch(e){ return; }
    if (!rows.length){ notify(0); return; }
    if (navigator.onLine === false){ notify(rows.length); schedule(); return; }
    S.busy = true; paint(rows.length);
    let left = rows.length;
    for (const rec of rows.sort((a, b) => a.ts - b.ts)){
      try {
        const url = await uploadOne(rec);
        await attach(rec, url);
        await del(rec.id);
        left--; notify(left);
      } catch(e){
        rec.tries = (rec.tries || 0) + 1;
        rec.lastErr = String(e && e.message || e).slice(0, 120);
        try { await put(rec); } catch(_){}
        if (rec.tries === 1 || rec.tries % 5 === 0) logFail(rec, 'upload', e);
        break;                       // 한 장이 막히면 지금은 멈추고 나중에 다시 (연결 문제일 때 줄줄이 실패시키지 않게)
      }
    }
    S.busy = false;
    await count();
    schedule(manual ? 5000 : 60000);
  }

  window.addEventListener('online', () => flush(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });

  window.kmPhotoQ = { init, enqueue, flush, count, onChange, get pending(){ return S.lastCount; } };
})();
