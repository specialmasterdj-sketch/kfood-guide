// km-account-card.js — 이름 단추를 누르면 '누가 로그인했는지' 만 보여 주는 카드.
// 🔐 2026-10-28 사장님: "로그인은 깔끔하고 명료해야 한다. 오너는 한 번 인증하면 어디든 들어간다.
//   다른 모든 사람은 각자의 지점만." → 본인 계정이면 사람을 바꾸는 창(이름 고르기)을 열지 않는다.
//   오너·임원: 보는 매장만 바꿀 수 있다. 그 밖의 사람: 이름·지점 확인 + 로그아웃만.
(function(){
  if (window.kmAccountCard) return;
  var BRANCHES = [
    { id:'MIAMI',          ko:'마이애미',       en:'Miami',           es:'Miami' },
    { id:'PEMBROKE_PINES', ko:'펨브로크 파인즈', en:'Pembroke Pines',  es:'Pembroke Pines' },
    { id:'HOLLYWOOD',      ko:'할리우드',       en:'Hollywood',       es:'Hollywood' },
    { id:'CORAL_SPRINGS',  ko:'코럴 스프링스',  en:'Coral Springs',   es:'Coral Springs' },
    { id:'LASOLAS',        ko:'라스올라스',     en:'Las Olas',        es:'Las Olas' },
  ];
  function getLang(){
    var l = '';
    try { l = localStorage.getItem('kimchi_lang') || localStorage.getItem('chat.lang') || localStorage.getItem('tasks.lang') || ''; } catch(e){}
    if (!/^(ko|en|es)$/.test(l)) l = String(document.documentElement.lang || '').slice(0, 2);
    return /^(ko|en|es)$/.test(l) ? l : 'ko';
  }
  function loadMe(){ try { return JSON.parse(localStorage.getItem('chat.me') || 'null'); } catch(e){ return null; } }
  // 본인 계정인가 (공용 계정 staff@/manager@ 은 이름 고르기를 계속 쓴다)
  window.kmIsPersonalLogin = function(m){
    m = m || loadMe();
    if (!m || !m.uid || !m.name) return false;
    var em = String(m.email || '').toLowerCase();
    return !(em === 'staff@miamikimchi.com' || em === 'manager@miamikimchi.com');
  };
function openAccountCard(m){
  var L = getLang(), T = function(ko, en, es){ return L === 'en' ? en : L === 'es' ? es : ko; };
  var role = String((m && m.role) || '').toUpperCase();
  var roam = (role === 'OWNER' || role === 'EXECUTIVE');
  var old = document.getElementById('acctCardOv'); if (old) old.remove();
  var ov = document.createElement('div');
  ov.id = 'acctCardOv';
  ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px';
  var esc = function(x){ return String(x == null ? '' : x).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  var brOpts = BRANCHES.filter(function(b){ return b.id !== 'WEST_PALM'; }).map(function(b){
    return '<option value="' + b.id + '"' + (m && m.branch === b.id ? ' selected' : '') + '>' + esc(b[L] || b.en) + '</option>'; }).join('');
  var brName = (BRANCHES.find(function(b){ return m && b.id === m.branch; }) || {})[L] || (m && m.branch) || '';
  ov.innerHTML =
    '<div style="background:#fff;border-radius:16px;max-width:360px;width:100%;padding:22px 20px;font-family:inherit;box-shadow:0 12px 40px rgba(0,0,0,.25)">' +
      '<div style="font-size:12px;font-weight:800;color:#64748b;margin-bottom:6px">🔐 ' + T('로그인한 계정', 'Signed in as', 'Sesión iniciada como') + '</div>' +
      '<div style="font-size:22px;font-weight:900;color:#0f3d28">' + esc(m && m.name) + '</div>' +
      '<div style="font-size:13px;color:#475569;margin-top:2px">' + esc(role || '-') + (roam ? '' : ' · ' + esc(brName)) + '</div>' +
      (roam ? '<label style="display:block;margin-top:14px;font-size:12px;font-weight:800;color:#64748b">📍 ' + T('보는 매장', 'Store to view', 'Tienda a ver') + '</label>' +
              '<select id="acctBranch" style="width:100%;margin-top:5px;padding:10px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px;font-family:inherit">' + brOpts + '</select>' : '') +
      '<div style="font-size:12px;color:#64748b;margin-top:14px;line-height:1.5">' +
        T('다른 사람으로 쓰려면 로그아웃한 뒤 그 사람 폰 번호로 로그인하세요.',
          'To use another person, sign out and sign in with that person’s phone.',
          'Para usar otra persona, cierre sesión e inicie con el teléfono de esa persona.') + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:16px">' +
        '<button id="acctOut" style="flex:1;background:#fff;color:#b91c1c;border:1.5px solid #fecaca;border-radius:10px;padding:11px;font-weight:800;font-family:inherit;cursor:pointer">' + T('로그아웃', 'Sign out', 'Cerrar sesión') + '</button>' +
        '<button id="acctOk" style="flex:1;background:#0f3d28;color:#fff;border:0;border-radius:10px;padding:11px;font-weight:800;font-family:inherit;cursor:pointer">' + T('확인', 'OK', 'OK') + '</button>' +
      '</div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', function(e){ if (e.target === ov) ov.remove(); });
  document.getElementById('acctOut').onclick = function(){
    if (confirm(T('로그아웃 하시겠습니까?', 'Sign out?', '¿Cerrar sesión?'))) location.href = './auth.html?fresh=1';
  };
  document.getElementById('acctOk').onclick = function(){
    var sel = document.getElementById('acctBranch');
    if (roam && sel && m && sel.value !== m.branch){
      var me2 = loadMe() || {}; me2.branch = sel.value;     // 사람은 그대로, 보는 매장만
      try { localStorage.setItem('chat.me', JSON.stringify(me2)); localStorage.setItem('hub.branch', sel.value); localStorage.setItem('km_branch', sel.value); } catch(_){}
      try { window.dispatchEvent(new Event('km-identity-changed')); } catch(_){}
    }
    ov.remove();
  };
}
  window.kmAccountCard = function(m){ openAccountCard(m || loadMe()); };
})();
