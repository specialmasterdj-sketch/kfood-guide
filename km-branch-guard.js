// ============================================================
// km-branch-guard.js — 내 매장이 잘못 잡혀 있으면 알려주고 한 번에 고친다
// ============================================================
// 2026-09-27 ALY(라스올라스) 사례:
//   앱이 계속 코럴스프링스로 잡혀 스케줄·업무가 남의 매장 것으로 보임.
//   로그아웃·재설치까지 했는데도 그대로 → 폰에 남은 사이트 데이터(hub.branch /
//   chat.me / 쿠키·IDB 백업)가 되살아나기 때문. 재설치로는 안 지워진다.
//
// 2026-09-29 v2 — ALY 가 "앱을 닫았다 열었는데 아래 주황색 띠가 안 보인다" 고
//   다시 올림. 고친 것:
//   1) 🔴 v1 은 hub.branch 만 서버와 견줬다. 그런데 업무 앱(tasks.html)이 실제로
//      쓰는 값은 chat.me.branch 다. hub 는 맞고 chat.me 가 틀린 경우 v1 은
//      아무 말도 안 했다 — 정확히 이 사람 증상. 이제 세 값을 모두 견준다.
//   2) 'Las Olas' 처럼 표기만 다른 값은 조용히 정식 id 로 고친다.
//      (업무 앱은 정식 id 를 못 읽으면 '전 지점 구독' 으로 빠져 남의 매장 업무가 섞여 보인다)
//   3) 서버에 등록이 없어도 hub 와 chat.me 가 서로 다르면 알려 준다.
//   4) 띠를 화면 아래 → 위로 옮겼다. 폰 아래쪽은 홈 바·하단 메뉴에 가려 못 본다.
//   5) 주소 끝에 #branch 를 붙이면 문제가 없어도 이 창이 뜬다 — 직원에게 링크
//      하나만 보내면 스스로 고칠 수 있게. (window.kmBranchPanel() 로도 열린다)
//
// 사용: fb-auth-fetch.js 뒤에 그냥 넣으면 된다.
//   <script src="./km-branch-guard.js?v=2"></script>
// ============================================================
(function(){
  'use strict';
  var DB = 'https://kimchi-mart-order-default-rtdb.firebaseio.com';
  var SKIP_KEY = 'kmBranchGuardSkip';
  var NAMES = {
    MIAMI:          { ko:'마이애미',       en:'Miami',           es:'Miami' },
    PEMBROKE_PINES: { ko:'펨브로크 파인즈', en:'Pembroke Pines',  es:'Pembroke Pines' },
    HOLLYWOOD:      { ko:'할리우드',       en:'Hollywood',       es:'Hollywood' },
    CORAL_SPRINGS:  { ko:'코럴 스프링스',  en:'Coral Springs',   es:'Coral Springs' },
    LASOLAS:        { ko:'라스올라스',     en:'Las Olas',        es:'Las Olas' },
    WEST_PALM:      { ko:'웨스트 팜 비치', en:'West Palm Beach', es:'West Palm Beach' },
  };
  var IDS = Object.keys(NAMES);

  function lang(){ try { return localStorage.getItem('km.lang') || 'ko'; } catch(e){ return 'ko'; } }
  function nm(id){ var n = NAMES[id]; return n ? (n[lang()] || n.ko) : (id || '?'); }
  function t(ko, en, es){ var L = lang(); return L === 'en' ? en : (L === 'es' ? es : ko); }
  function esc(x){ return String(x == null ? '' : x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // 'Las Olas' · 'lasolas' · '라스올라스' 를 모두 'LASOLAS' 로 — 업무 앱이 알아보는 정식 id
  function canon(x){
    if (!x) return null;
    var s = String(x).trim();
    if (s === '*') return null;
    var k = s.toUpperCase().replace(/[^A-Z]/g, '');
    for (var i = 0; i < IDS.length; i++){
      if (IDS[i].replace(/[^A-Z]/g, '') === k) return IDS[i];
      var n = NAMES[IDS[i]];
      if (n.ko === s || n.en.toUpperCase().replace(/[^A-Z]/g,'') === k) return IDS[i];
    }
    return null;
  }

  function meObj(){ try { return JSON.parse(localStorage.getItem('chat.me') || 'null'); } catch(e){ return null; } }
  function ls(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function uidFromToken(tok){
    try {
      var p = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var j = JSON.parse(decodeURIComponent(escape(atob(p))));
      return j.user_id || j.sub || j.uid || '';
    } catch(e){ return ''; }
  }

  // 앱이 쓰고 있는 값들 — 하나라도 틀리면 어딘가에서 남의 매장이 보인다
  //   hub.branch : 스케줄·허브 계열
  //   chat.me    : 업무 지시·채팅 (실제로 제일 많이 쓴다)
  //   km_branch  : 일부 앱의 보조 키
  function state(){
    var me = meObj();
    return { hub: ls('hub.branch') || null, me: (me && me.branch) || null, km: ls('km_branch') || null };
  }

  function writeBranch(br){
    try { localStorage.setItem('hub.branch', br); } catch(e){}
    try {
      var me = meObj() || {};
      me.branch = br;
      localStorage.setItem('chat.me', JSON.stringify(me));   // me-persist 가 쿠키·IDB 백업까지 같이 고친다
    } catch(e){}
    try { localStorage.setItem('km_branch', br); } catch(e){}
  }

  function stateLine(s, server){
    var f = function(v){ return v ? esc(v) : '–'; };
    return 'hub=' + f(s.hub) + ' · me=' + f(s.me) + ' · km=' + f(s.km) + ' · ' +
           t('등록', 'registered', 'registrado') + '=' + f(server || '–');
  }

  // ---------- 띠 ----------
  function banner(opt){
    var old = document.getElementById('kmBranchGuard');
    if (old) old.remove();
    var target = opt.target, s = opt.state, server = opt.server, pick = !!opt.pick;

    var box = document.createElement('div');
    box.id = 'kmBranchGuard';
    box.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483000;background:#fff7ed;border-bottom:3px solid #fb923c;' +
      'padding:12px 14px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;' +
      'font-size:14px;color:#9a3412;box-shadow:0 4px 16px rgba(0,0,0,.18);display:flex;gap:10px;align-items:center;flex-wrap:wrap';

    var head = pick
      ? '<b>🏬 ' + t('내 매장 고치기', 'Fix my store', 'Corregir mi tienda') + '</b>'
      : '<b>⚠ ' + t('내 매장이 다르게 잡혀 있어요', 'Wrong store selected', 'Tienda equivocada') + '</b>';
    var body = pick
      ? t('지금 보고 있는 매장: <b>' + nm(s.me || s.hub) + '</b> — 내 매장을 눌러 주세요.',
          'Showing: <b>' + nm(s.me || s.hub) + '</b> — tap your store below.',
          'Mostrando: <b>' + nm(s.me || s.hub) + '</b> — toca tu tienda abajo.')
      : t('내 매장은 <b>' + nm(target) + '</b> 인데, 앱 일부가 <b>' + nm(opt.wrong) + '</b> 로 보고 있습니다.',
          'Your store is <b>' + nm(target) + '</b> but part of the app is showing <b>' + nm(opt.wrong) + '</b>.',
          'Tu tienda es <b>' + nm(target) + '</b> pero la app muestra <b>' + nm(opt.wrong) + '</b>.');

    var buttons = pick
      ? '<div style="flex:1 0 100%;display:flex;gap:6px;flex-wrap:wrap;margin-top:2px">' +
          IDS.map(function(id){
            return '<button class="kmBgPick" data-br="' + id + '" style="background:' + (canon(s.me) === id ? '#ea580c' : '#fff') +
              ';color:' + (canon(s.me) === id ? '#fff' : '#9a3412') + ';border:1.5px solid #fdba74;border-radius:9px;padding:10px 13px;font-weight:800;font-size:13px;cursor:pointer">' +
              esc(nm(id)) + '</button>';
          }).join('') + '</div>'
      : '<button id="kmBgFix" style="background:#ea580c;color:#fff;border:0;border-radius:9px;padding:11px 16px;font-weight:800;font-size:14px;cursor:pointer">' +
          t('내 매장으로 바꾸기', 'Switch to my store', 'Cambiar a mi tienda') + '</button>' +
        '<button id="kmBgSkip" style="background:#fff;color:#9a3412;border:1.5px solid #fdba74;border-radius:9px;padding:11px 14px;font-weight:700;font-size:14px;cursor:pointer">' +
          t('나중에', 'Later', 'Después') + '</button>';

    box.innerHTML =
      '<div style="flex:1;min-width:200px;line-height:1.45">' + head + '<br>' + body +
        '<div style="margin-top:4px;font-size:11px;color:#c2703a;font-family:ui-monospace,Menlo,Consolas,monospace">' + stateLine(s, server) + '</div>' +
      '</div>' + buttons;

    document.body.appendChild(box);
    // 띠가 화면 맨 위를 덮지 않게 내용을 아래로 밀어 준다
    try {
      var h = box.getBoundingClientRect().height;
      document.body.style.paddingTop = (parseFloat(getComputedStyle(document.body).paddingTop || 0) + h) + 'px';
    } catch(e){}

    var fix = document.getElementById('kmBgFix');
    if (fix) fix.onclick = function(){ writeBranch(target); location.reload(); };
    var skip = document.getElementById('kmBgSkip');
    if (skip) skip.onclick = function(){
      try { sessionStorage.setItem(SKIP_KEY, '1'); } catch(e){}
      try { document.body.style.paddingTop = ''; } catch(e){}
      box.remove();
    };
    Array.prototype.forEach.call(box.querySelectorAll('.kmBgPick'), function(b){
      b.onclick = function(){ writeBranch(b.getAttribute('data-br')); location.reload(); };
    });
  }

  // 누구나 열 수 있는 비상구 — 주소 끝에 #branch 또는 콘솔에서 kmBranchPanel()
  window.kmBranchPanel = function(){
    lastServer().then(function(server){
      var s = state();
      banner({ pick: true, state: s, server: server, target: canon(server) || canon(s.me) || canon(s.hub) });
    });
  };

  var _serverCache = null;
  async function lastServer(){
    if (_serverCache !== null) return _serverCache;
    _serverCache = '';
    try {
      if (!window.__getAuthToken) return _serverCache;
      var tok = await window.__getAuthToken();
      if (!tok) return _serverCache;
      var uid = uidFromToken(tok);
      if (!uid) return _serverCache;
      var r = await fetch(DB + '/users/' + uid + '.json');
      if (!r.ok) return _serverCache;
      var prof = await r.json();
      _serverCache = (prof && prof.branch) || '';
    } catch(e){}
    return _serverCache;
  }

  async function check(){
    if (String(location.hash || '').toLowerCase() === '#branch'){ window.kmBranchPanel(); return; }
    try { if (sessionStorage.getItem(SKIP_KEY)) return; } catch(e){}

    var server = await lastServer();
    var s = state();
    var cs = canon(server), ch = canon(s.hub), cm = canon(s.me), ck = canon(s.km);

    // 내 매장 — 서버 등록이 있으면 그게 기준, 없으면 chat.me(로그인한 본인) 기준
    var target = cs || cm || ch || ck;
    if (!target) return;                       // 아무것도 모르면 건드리지 않는다

    // ① 표기만 다른 값('Las Olas' 등)은 조용히 정식 id 로 고친다.
    //    업무 앱이 정식 id 를 못 읽으면 '전 지점 구독' 으로 빠져 남의 매장 업무가 섞여 보인다.
    var spelled = [['hub.branch', s.hub, ch], ['chat.me', s.me, cm], ['km_branch', s.km, ck]]
      .filter(function(x){ return x[1] && x[2] === target && x[1] !== target; });
    if (spelled.length){ writeBranch(target); s = state(); ch = canon(s.hub); cm = canon(s.me); ck = canon(s.km); }

    // ② 정말 다른 매장을 가리키는 값이 하나라도 있으면 물어본다
    var wrong = null;
    if (ch && ch !== target) wrong = ch;
    else if (cm && cm !== target) wrong = cm;
    else if (ck && ck !== target) wrong = ck;
    // 값이 아예 비어 있는데 서버 등록은 있는 경우도 채워 준다 (조용히)
    if (!wrong && cs && (!cm || !ch)){ writeBranch(target); return; }
    if (!wrong) return;

    banner({ target: target, wrong: wrong, state: s, server: server });
  }

  function boot(){ setTimeout(function(){ check(); }, 1500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.addEventListener('fb-auth-ready', function(){ setTimeout(check, 800); });
  window.addEventListener('hashchange', function(){
    if (String(location.hash || '').toLowerCase() === '#branch') window.kmBranchPanel();
  });
})();
