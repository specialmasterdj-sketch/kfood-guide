// km-home-logo.js — 맨 위 김치마트 로고를 누르면 홈(apps.html — 앱 모음) 으로 간다.
//                    로고 밑에 "🏠 홈으로" 라고 글자로 적어 둔다.
//
// 2026-10-07 전무님: "맨 위 상단에 김치마트 로고 누르면 첫 화면으로 가게 해줘.
//   모두들 홈 첫 화면으로 가는 방법을 몰라서 앱을 못 쓴다."
//   "특히 폰에서 김치 로고 누르거나, 그 위에 '홈으로' 라고 친절히 표시해줘."
//   "앱을 힘들게 만들어주면 뭐해, 몰라서 못 쓴다니?"
//
// 그래서 숨은 기능으로 두지 않는다 —
//   ① 로고를 누를 수 있게 하고
//   ② 로고 밑에 "🏠 홈으로" 를 글자로 보여 주고 (폰은 마우스를 올릴 수 없어 툴팁은 못 본다)
//   ③ 누르는 자리를 손가락 크기로 넓힌다
//
// 화면 코드를 하나하나 고치지 않고 이 파일 하나로 붙인다 — 새 앱에 로고를 넣어도
// 이 파일만 불러오면 그대로 동작한다. 글씨는 쓰는 사람 언어로 나간다.
(function(){
  if (window.__kmHomeLogo) return;
  window.__kmHomeLogo = true;

  var page = (location.pathname.split('/').pop() || '').toLowerCase();
  if (/^(apps|auth)\.html$/.test(page)) return;      // 홈(앱 모음) 자신과 로그인 화면은 뺀다

  var lang = 'ko';
  try { lang = localStorage.getItem('kimchi_lang') || localStorage.getItem('tasks.lang') || 'ko'; } catch(e){}
  var WORD = { ko:'홈으로', en:'Home', es:'Inicio' }[lang] || '홈으로';
  var TIP  = { ko:'첫 화면으로 갑니다', en:'Go to the home screen', es:'Ir a la pantalla de inicio' }[lang] || '첫 화면으로 갑니다';

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

  function wire(el){
    if (!el || el.getAttribute('data-km-home') === '1') return;
    if (el.closest && el.closest('.km-home-wrap')) return;      // 이미 감쌌다
    el.setAttribute('data-km-home', '1');

    var a = document.createElement('a');
    a.className = 'km-home-wrap';
    a.href = './apps.html';
    a.title = TIP;
    a.setAttribute('aria-label', '🏠 ' + WORD + ' — ' + TIP);

    var parent = el.parentNode;
    if (!parent) return;
    parent.insertBefore(a, el);        // 로고가 있던 자리에 그대로 둔다
    a.appendChild(el);

    var tip = document.createElement('span');
    tip.className = 'km-home-tip';
    tip.textContent = '🏠 ' + WORD;
    a.appendChild(tip);
  }

  function mount(){
    // 로고가 들어가는 모양이 화면마다 조금씩 달라서 두 가지를 다 본다
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
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
