// km-home-logo.js — 맨 위 김치마트 로고를 누르면 앱 모음(apps.html) 으로 간다.
//                    로고 밑에 "🏠 홈으로" 라고 글자로 적어 둔다.
//
// 2026-10-07 전무님: "모두들 홈 첫 화면으로 가는 방법을 몰라서 앱을 못 쓴다.
//   특히 폰에서 김치 로고 누르거나, 그 위에 '홈으로' 라고 친절히 표시해줘."
//   "홈으로가 언어 변환이 안 되네." → KO/EN/ES 를 누르면 이 글자도 같이 바뀐다.
//
// ⚠️ 2026-10-08 다시 만듦. 어제 판은 "앱 전체 깜빡임" 으로 사장님이 되돌렸다(b5be8a4).
//   깜빡인 까닭 세 가지를 모두 빼고 다시 짰다 —
//   ① 화면 전체(childList+subtree)를 5초 동안 지켜보며 매번 다시 훑던 것
//      → 업무지시처럼 처음에 수백 개를 그리는 화면에서 쉴 새 없이 돌았다.
//        지금은 열릴 때 + 0.4초 + 1.5초, 세 번만 훑고 끝낸다.
//   ② 로고가 없는 앱의 맨 위에 줄을 새로 끼워 넣던 것 → 화면이 아래로 밀렸다. 이제 안 만든다.
//        (로고가 없는 앱은 원래 있던 '← 뒤로' 줄에 로고를 넣어 해결한다 — km-back-button.js)
//   ③ 1초마다 언어를 확인하던 것 → 지금은 바뀔 때 알려 주는 것만 듣는다.
(function(){
  if (window.__kmHomeLogo) return;
  window.__kmHomeLogo = true;

  var page = (location.pathname.split('/').pop() || '').toLowerCase();
  if (/^(apps|auth)\.html$/.test(page)) return;      // 앱 모음 자신과 로그인 화면은 뺀다

  var WORD = { ko:'홈으로',             en:'Home',                  es:'Inicio' };
  var TIP  = { ko:'앱 모음으로 갑니다',  en:'Go to the app list',    es:'Ir a la lista de apps' };

  // 앱마다 언어를 담아 두는 칸 이름이 조금씩 다르다 — 쓰이는 것을 차례로 본다.
  function curLang(){
    var l = '';
    try {
      l = localStorage.getItem('kimchi_lang') || localStorage.getItem('tasks.lang')
        || localStorage.getItem('hub.lang')   || localStorage.getItem('km.lang') || '';
    } catch(e){}
    if (!/^(ko|en|es)$/.test(l)) l = String(document.documentElement.lang || '').slice(0, 2);
    return /^(ko|en|es)$/.test(l) ? l : 'ko';
  }
  var LANG = curLang();

  function style(){
    if (document.getElementById('kmHomeLogoCss')) return;
    var css = document.createElement('style');
    css.id = 'kmHomeLogoCss';
    css.textContent =
      '.km-home-wrap{display:inline-flex;flex-direction:column;align-items:center;gap:1px;' +
        'text-decoration:none;flex-shrink:0;cursor:pointer;padding:2px 4px;border-radius:9px;' +
        '-webkit-tap-highlight-color:transparent}' +
      '.km-home-wrap:hover,.km-home-wrap:focus-visible{background:rgba(26,92,58,.08);outline:none}' +
      '.km-home-wrap:active{background:rgba(26,92,58,.16)}' +
      /* 폰에는 마우스가 없으니 글자로 보여 준다. 알약 모양이라야 '누르는 것' 으로 읽힌다. */
      '.km-home-tip{display:block;font-size:11px;line-height:1;font-weight:900;color:#15803d;' +
        'background:#e8f5ee;border:1px solid #bbf7d0;border-radius:999px;padding:3px 9px;' +
        'letter-spacing:-.2px;white-space:nowrap;font-family:inherit}' +
      /* .brand > .brand-logo 로 크기를 주던 화면들 — 감싸고 나서도 그대로 보이게 */
      '.brand .km-home-wrap > .brand-logo{height:32px;max-width:135px}' +
      '@media print{.km-home-tip{display:none}}';
    document.head.appendChild(css);
  }

  // 글자를 지금 언어로 다시 쓴다
  function paint(){
    var w = WORD[LANG] || WORD.ko, t = TIP[LANG] || TIP.ko;
    var tips = document.querySelectorAll('.km-home-tip');
    for (var i = 0; i < tips.length; i++) tips[i].textContent = '🏠 ' + w;
    var wraps = document.querySelectorAll('.km-home-wrap');
    for (var j = 0; j < wraps.length; j++){
      wraps[j].title = t;
      wraps[j].setAttribute('aria-label', '🏠 ' + w + ' — ' + t);
    }
  }
  function refresh(){
    var l = curLang();
    if (l === LANG) return;
    LANG = l; paint();
  }
  window.kmHomeLogoRefresh = refresh;

  // 앱 모음으로 갈 때 표를 남긴다.
  //   apps.html 은 '밖에서 처음 열었나' 를 referrer 로 판단해 업무지시로 보내는데,
  //   데스크톱 창처럼 referrer 가 안 붙는 곳에서는 홈 버튼이 그대로 되튕겨 깜빡였다.
  //   이 표가 있으면 apps.html 이 "사람이 홈 버튼을 눌러 온 것" 으로 알고 그대로 머문다.
  function markGoing(){
    try { sessionStorage.setItem('km_go_apps', '1'); } catch(e){}
  }

  function wire(el){
    if (!el || el.getAttribute('data-km-home') === '1') return;
    if (el.closest && el.closest('.km-home-wrap')) return;      // 이미 감쌌다
    var parent = el.parentNode;
    if (!parent) return;
    el.setAttribute('data-km-home', '1');

    var a = document.createElement('a');
    a.className = 'km-home-wrap';
    a.href = './apps.html';
    a.addEventListener('click', markGoing);

    parent.insertBefore(a, el);        // 로고가 있던 자리에 그대로 둔다
    a.appendChild(el);

    var tip = document.createElement('span');
    tip.className = 'km-home-tip';
    a.appendChild(tip);
  }

  function scan(){
    var found = document.querySelectorAll('.brand-logo, img[src*="kimchi-mart-full-logo"], img[src*="kimchi-text-logo"]');
    for (var i = 0; i < found.length; i++) wire(found[i]);
    paint();
  }

  function start(){
    style();
    scan();
    // 로고를 조금 늦게 그리는 화면이 있어 두 번만 더 본다 (계속 지켜보지 않는다 — 깜빡임의 원인이었다)
    setTimeout(scan, 400);
    setTimeout(scan, 1500);

    // 🌐 언어가 바뀌면 글자도 바뀐다 — 알려 주는 것만 듣는다(일정 시간마다 확인하지 않는다).
    window.addEventListener('km-lang-changed', refresh);
    window.addEventListener('storage', refresh);
    document.addEventListener('click', function(ev){
      var t = ev.target && ev.target.closest
            && ev.target.closest('[data-l],[data-lang],.lang-toggle button,.langs button');
      if (t) setTimeout(refresh, 0);
    }, true);
    try {   // <html lang> 만 바꾸는 앱 — 글자 하나만 보는 가벼운 감시
      new MutationObserver(refresh).observe(document.documentElement, { attributes:true, attributeFilter:['lang'] });
    } catch(e){}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
