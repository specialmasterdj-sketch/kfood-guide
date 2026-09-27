// ============================================================
// km-branch-guard.js — 내 지점이 잘못 잡혀 있으면 알려주고 한 번에 고친다
// ============================================================
// 2026-09-27 ALY(라스올라스) 사례:
//   앱이 계속 코럴스프링스로 잡혀 스케줄·채팅이 남의 매장 것으로 보임.
//   로그아웃·재설치까지 했는데도 그대로 → 폰에 남은 사이트 데이터(hub.branch /
//   chat.me / 쿠키 백업)가 되살아나기 때문. 재설치로는 안 지워진다.
//
// 이 파일은 로그인한 뒤 서버에 등록된 내 지점(users/{uid}.branch)과
// 앱이 쓰고 있는 지점을 견주어, 다르면 아래에 띠를 띄우고 [내 지점으로 바꾸기]
// 한 번으로 고친다. (매니저가 일부러 다른 매장을 보는 경우도 있으므로 자동으로
// 바꾸지 않고 물어본다. 닫으면 그 화면에서는 다시 뜨지 않는다.)
//
// 사용: fb-auth-fetch.js 뒤에 그냥 넣으면 된다.
//   <script src="./km-branch-guard.js?v=1"></script>
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
  function lang(){ try { return localStorage.getItem('km.lang') || 'ko'; } catch(e){ return 'ko'; } }
  function nm(id){ var n = NAMES[id]; return n ? (n[lang()] || n.ko) : (id || '?'); }
  function t(ko, en, es){ var L = lang(); return L === 'en' ? en : (L === 'es' ? es : ko); }
  function meObj(){ try { return JSON.parse(localStorage.getItem('chat.me') || 'null'); } catch(e){ return null; } }
  function uidFromToken(tok){
    try {
      var p = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var j = JSON.parse(decodeURIComponent(escape(atob(p))));
      return j.user_id || j.sub || j.uid || '';
    } catch(e){ return ''; }
  }
  // 앱이 지금 쓰고 있는 지점 — 스케줄 계열은 hub.branch, 나머지는 chat.me.branch
  function usedBranch(){
    var hb = null;
    try { hb = localStorage.getItem('hub.branch'); } catch(e){}
    var me = meObj();
    return { hub: hb || null, me: (me && me.branch) || null };
  }

  function banner(serverBr, used){
    if (document.getElementById('kmBranchGuard')) return;
    var box = document.createElement('div');
    box.id = 'kmBranchGuard';
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9998;background:#fff7ed;border-top:3px solid #fb923c;' +
      'padding:12px 14px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;' +
      'font-size:14px;color:#9a3412;box-shadow:0 -4px 16px rgba(0,0,0,.12);display:flex;gap:10px;align-items:center;flex-wrap:wrap';
    box.innerHTML =
      '<div style="flex:1;min-width:200px;line-height:1.45">' +
        '<b>⚠ ' + t('내 매장이 다르게 잡혀 있어요', 'Wrong store selected', 'Tienda equivocada') + '</b><br>' +
        t('등록된 내 매장은 <b>' + nm(serverBr) + '</b> 인데, 지금 <b>' + nm(used) + '</b> 로 보고 있습니다.',
          'You are registered at <b>' + nm(serverBr) + '</b> but the app is showing <b>' + nm(used) + '</b>.',
          'Estás registrado en <b>' + nm(serverBr) + '</b> pero la app muestra <b>' + nm(used) + '</b>.') +
      '</div>' +
      '<button id="kmBgFix" style="background:#ea580c;color:#fff;border:0;border-radius:9px;padding:11px 16px;font-weight:800;font-size:14px;cursor:pointer">' +
        t('내 매장으로 바꾸기', 'Switch to my store', 'Cambiar a mi tienda') + '</button>' +
      '<button id="kmBgSkip" style="background:#fff;color:#9a3412;border:1.5px solid #fdba74;border-radius:9px;padding:11px 14px;font-weight:700;font-size:14px;cursor:pointer">' +
        t('나중에', 'Later', 'Después') + '</button>';
    document.body.appendChild(box);
    document.getElementById('kmBgFix').onclick = function(){
      try { localStorage.setItem('hub.branch', serverBr); } catch(e){}
      try {
        var me = meObj() || {};
        me.branch = serverBr;
        localStorage.setItem('chat.me', JSON.stringify(me));   // me-persist 가 쿠키·IDB 백업까지 같이 고친다
      } catch(e){}
      try { localStorage.setItem('km_branch', serverBr); } catch(e){}
      location.reload();
    };
    document.getElementById('kmBgSkip').onclick = function(){
      try { sessionStorage.setItem(SKIP_KEY, '1'); } catch(e){}
      box.remove();
    };
  }

  async function check(){
    try {
      if (sessionStorage.getItem(SKIP_KEY)) return;
    } catch(e){}
    if (!window.__getAuthToken) return;
    var tok = '';
    try { tok = await window.__getAuthToken(); } catch(e){}
    if (!tok) return;
    var uid = uidFromToken(tok);
    if (!uid) return;
    var prof = null;
    try {
      var r = await fetch(DB + '/users/' + uid + '.json');
      if (r.ok) prof = await r.json();
    } catch(e){ return; }
    if (!prof || !prof.branch || prof.branch === '*') return;
    var u = usedBranch();
    var used = u.hub || u.me;
    if (!used || used === prof.branch) return;
    // 매니저급은 일부러 다른 매장을 볼 수 있다 — 자동으로 바꾸지 않고 물어보기만 한다
    banner(prof.branch, used);
  }

  function boot(){ setTimeout(function(){ check(); }, 1500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.addEventListener('fb-auth-ready', function(){ setTimeout(check, 800); });
})();
