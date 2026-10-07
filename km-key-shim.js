/* ============================================================
   km-key-shim.js — KEY ITEMS REPORT 페이지(key-fresh.html, key-grocery.html) 연동
   두 페이지는 원래 claude.ai 아티팩트로 만들어져 window.claude.use('db'|'user') 를 쓴다.
   이 파일이 그 자리를 김치 앱 Firebase RTDB 로 바꿔 준다.
   - 저장 위치: inventory/keyItems/{fresh|grocery}/checks/{YYYY-MM-DD}/{date_store_dept}
                inventory/keyItems/grocery/photos/{itemId}
     (inventory 노드는 승인된 직원이면 읽기·쓰기 가능 — top500 과 같은 규칙)
   - 토큰은 fb-auth-fetch.js 가 붙인다. 이 파일은 그게 준비될 때까지 기다린다.
   - 실시간: 8초마다 다시 읽고, 저장하면 바로 다시 읽는다.
   - 앱에 로그인한 사람의 지점·이름(chat.me)으로 '내 지점'을 미리 골라 둔다.
   페이지마다 <script>window.KM_KEY = {base:'inventory/keyItems/grocery', prefs:'kgt-prefs'}</script> 를 먼저 둔다.
   ============================================================ */
(function(){
  const FB = 'https://kimchi-mart-order-default-rtdb.firebaseio.com/';
  const CFG = window.KM_KEY || {};
  const BASE = CFG.base;
  const BR = { CORAL_SPRINGS:'coral', HOLLYWOOD:'hollywood', LASOLAS:'lasolas', LAS_OLAS:'lasolas',
               MIAMI:'miami', PEMBROKE_PINES:'pembroke', PEMBROKE:'pembroke', WEST_PALM:'wpb', WEST_PALM_BEACH:'wpb' };
  let me = null; try { me = JSON.parse(localStorage.getItem('chat.me') || 'null'); } catch(_){}

  // 앱 지점·이름으로 처음 한 번 미리 채움 (사용자가 바꾼 값은 존중)
  try {
    const P = JSON.parse(localStorage.getItem(CFG.prefs) || '{}') || {};
    let ch = false;
    const qs = new URLSearchParams(location.search);
    const want = (qs.get('store') || '').toLowerCase() || (me && BR[String(me.branch || '').toUpperCase()]) || '';
    if (want && (qs.get('store') || !P.store)) { P.store = want; ch = true; }
    if (me && me.name && !P.name) { P.name = me.name; ch = true; }
    if (me && /MANAGER|매니저/i.test(me.role || '') && !P.role) { P.role = 'Store Manager'; ch = true; }
    if (me && /SUPERVISOR|수퍼|슈퍼/i.test(me.role || '') && !P.role) { P.role = 'Supervisor'; ch = true; }
    if (ch) localStorage.setItem(CFG.prefs, JSON.stringify(P));
  } catch(_){}

  // fb-auth-fetch.js(모듈) 가 fetch 에 토큰을 붙일 준비가 될 때까지 대기 (최대 12초)
  const authReady = new Promise(res => {
    if (window.__getAuthToken) return res();
    let n = 0; const t = setInterval(() => { if (window.__getAuthToken || ++n > 120) { clearInterval(t); res(); } }, 100);
    window.addEventListener('fb-auth-ready', () => { clearInterval(t); res(); }, { once:true });
  });

  const safe = s => String(s).replace(/[.#$\[\]\/]/g, '_');
  const pathFor = (col, id) => col === 'checks' ? `${BASE}/checks/${String(id).slice(0,10)}/${safe(id)}` : `${BASE}/${col}/${safe(id)}`;
  const subs = new Set();
  async function poll(s){
    try {
      await authReady;
      const r = await fetch(FB + s.path + '.json', { cache:'no-store' });
      const j = await r.json();
      if (!r.ok || (j && j.error)) throw Object.assign(new Error((j && j.error) || r.status), { code: r.status });
      const docs = Object.entries(j || {}).map(([k, v]) => ({ id: (v && v._id) || k, data: () => v }));
      s.cb({ docs });
    } catch(e){ if (s.eb) s.eb(e); }
  }
  function sub(path, cb, eb){
    const s = { path, cb, eb }; subs.add(s); poll(s);
    s.t = setInterval(() => { if (!document.hidden) poll(s); }, 8000);
    return () => { clearInterval(s.t); subs.delete(s); };
  }
  const db = {
    collection(col){
      return {
        where(f, op, v){ return { onSnapshot: (cb, eb) => sub(`${BASE}/${col}/${safe(v)}`, cb, eb) }; },
        onSnapshot: (cb, eb) => sub(`${BASE}/${col}`, cb, eb),
      };
    },
    doc(p){
      const i = p.indexOf('/'), col = p.slice(0, i), id = p.slice(i + 1);
      return {
        async set(body){
          await authReady;
          const r = await fetch(FB + pathFor(col, id) + '.json', { method:'PUT', body: JSON.stringify(Object.assign({}, body, { _id: id })) });
          if (!r.ok){ const e = new Error('save failed ' + r.status); e.code = (r.status === 401 || r.status === 403) ? 'invalid_argument' : 'unavailable'; throw e; }
          subs.forEach(poll);
        },
        async get(){ await authReady; const r = await fetch(FB + pathFor(col, id) + '.json', { cache:'no-store' }); const v = await r.json(); return { exists: !!v, data: () => v }; },
      };
    },
  };
  const user = {
    id: async () => (me && (me.uid || me.name)) || 'staff',
    isOwner: async () => !!(me && /OWNER|EXECUTIVE|임원|전무|사장/i.test(me.role || '')),
    can: async () => true,
    me: async () => ({ name: (me && me.name) || '' }),
  };
  window.claude = { use: async name => name === 'db' ? db : name === 'user' ? user : null };
})();
