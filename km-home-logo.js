// km-home-logo.js — 맨 위 김치마트 로고를 누르면 홈(apps.html — 앱 모음) 으로 간다.
//                    로고 밑에 "🏠 홈으로" 라고 글자로 적어 둔다.
//
// 2026-10-07 전무님: "맨 위 상단에 김치마트 로고 누르면 첫 화면으로 가게 해줘.
//   모두들 홈 첫 화면으로 가는 방법을 몰라서 앱을 못 쓴다."
//   "특히 폰에서 김치 로고 누르거나, 그 위에 '홈으로' 라고 친절히 표시해줘."
//   "앱을 힘들게 만들어주면 뭐해, 몰라서 못 쓴다니?"
//   "그리고 홈으로가 언어 변환이 안 되네." → KO/EN/ES 를 누르면 이 글자도 같이 바뀐다.
//
// 그래서 숨은 기능으로 두지 않는다 —
//   ① 로고를 누를 수 있게 하고
//   ② 로고 밑에 "🏠 홈으로" 를 글자로 보여 주고 (폰은 마우스를 올릴 수 없어 툴팁은 못 본다)
//   ③ 누르는 자리를 손가락 크기로 넓히고
//   ④ 언어를 바꾸면 이 글자도 그 자리에서 바로 바뀐다
//
// 화면 코드를 하나하나 고치지 않고 이 파일 하나로 붙인다 — 새 앱에 로고를 넣어도
// 이 파일만 불러오면 그대로 동작한다.
(function(){
  if (window.__kmHomeLogo) return;
  window.__kmHomeLogo = true;

  var page = (location.pathname.split('/').pop() || '').toLowerCase();
  if (/^(apps|auth)\.html$/.test(page)) return;      // 홈(앱 모음) 자신과 로그인 화면은 뺀다

  var WORD = { ko:'홈으로',             en:'Home',                  es:'Inicio' };
  var TIP  = { ko:'첫 화면으로 갑니다',  en:'Go to the home screen', es:'Ir a la pantalla de inicio' };

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
        '-webkit-tap-highlight-color:transparent;transition:background .12s}' +
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

  // 글자를 지금 언어로 다시 쓴다 (언어가 바뀔 때마다 불린다)
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
  window.kmHomeLogoRefresh = refresh;   // 앱에서 직접 부르고 싶을 때

  function wire(el){
    if (!el || el.getAttribute('data-km-home') === '1') return;
    if (el.closest && el.closest('.km-home-wrap')) return;      // 이미 감쌌다
    el.setAttribute('data-km-home', '1');

    var a = document.createElement('a');
    a.className = 'km-home-wrap';
    a.href = './apps.html';

    var parent = el.parentNode;
    if (!parent) return;
    parent.insertBefore(a, el);        // 로고가 있던 자리에 그대로 둔다
    a.appendChild(el);

    var tip = document.createElement('span');
    tip.className = 'km-home-tip';
    a.appendChild(tip);
    paint();                           // 글자·설명은 paint 가 채운다
  }

  function mount(){
    var found = document.querySelectorAll('.brand-logo, img[src*="kimchi-mart-full-logo"], img[src*="kimchi-text-logo"]');
    for (var i = 0; i < found.length; i++) wire(found[i]);
  }

  function start(){
    style();
    mount();
    // 로고를 나중에 그리는 화면도 있어서 잠깐 더 지켜본다
    try {
      var mo = new MutationObserver(function(){ mount(); });
      mo.observe(document.documentElement, { childList:true, subtree:true });
      setTimeout(function(){ try { mo.disconnect(); } catch(e){} }, 5000);
    } catch(e){}

    // 🌐 언어가 바뀌면 이 글자도 바뀐다 — 앱마다 바꾸는 방식이 달라 여러 길을 다 연다.
    //   ① 업무지시처럼 알려 주는 앱      ② KO/EN/ES 단추를 직접 눌렀을 때
    //   ③ <html lang> 을 바꾸는 앱        ④ 다른 탭에서 바꿨을 때
    //   ⑤ 그래도 놓치는 앱을 위해 1초마다 가볍게 확인 (칸 하나 읽는 정도라 부담 없음)
    window.addEventListener('km-lang-changed', refresh);
    document.addEventListener('click', function(ev){
      var t = ev.target && ev.target.closest
            && ev.target.closest('[data-l],[data-lang],.lang-toggle button,.langs button');
      if (t) setTimeout(refresh, 0);
    }, true);
    try {
      new MutationObserver(refresh).observe(document.documentElement, { attributes:true, attributeFilter:['lang'] });
    } catch(e){}
    window.addEventListener('storage', refresh);
    setInterval(refresh, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
