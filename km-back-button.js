// km-back-button.js — 화면에 뒤로가기 버튼이 없는 앱에 "← 뒤로 · 🏠 홈" 줄을 붙인다.
// 2026-09-19 전무님: "모든 앱에 뒤로가기 만들어줘". 설치된 앱 창(PWA)으로 열면 브라우저
// 뒤로가기가 없어서, 버튼 없는 앱은 창을 닫는 것 말고는 나갈 방법이 없었다.
//
// 떠 있는(fixed) 버튼으로 만들지 않는 이유: 앱마다 화면 아래에 입력칸·버튼 줄이 있어서
// 어디에 띄워도 무언가를 가린다. 그래서 화면 맨 위에 흐름대로 한 줄을 끼워 넣는다.
//
// ← : 같은 사이트에서 왔으면 이전 화면(열린 창이 있으면 back-nav.js 가 그 창부터 닫는다),
//     앱 창으로 바로 열었으면 홈.   🏠 : 홈(hub.html).
// 이미 자체 ← 버튼이 있는 앱에는 이 파일을 넣지 않는다. 넣었더라도 <html data-km-back="own"> 이면 아무것도 안 한다.
(function(){
  if (window.__kmBackButton) return;
  window.__kmBackButton = true;
  if (document.documentElement.getAttribute('data-km-back') === 'own') return;
  var page = (location.pathname.split('/').pop() || '').toLowerCase();
  if (/^(hub|apps|auth)\.html$/.test(page)) return;            // 홈·로그인 화면 자체

  var lang = 'ko';
  try { lang = localStorage.getItem('kimchi_lang') || localStorage.getItem('tasks.lang') || 'ko'; } catch(e){}
  var L = { ko:['뒤로','홈'], en:['Back','Home'], es:['Atrás','Inicio'] }[lang] || ['뒤로','홈'];

  function goBack(){
    var ref = document.referrer || '';
    var sameSite = ref.indexOf(location.origin) === 0 && ref.split('#')[0] !== location.href.split('#')[0];
    if (history.length > 1 && (sameSite || (history.state && history.state.kmBack))){ history.back(); return; }
    location.href = './hub.html';
  }
  function mount(){
    if (!document.body || document.getElementById('kmBackBar')) return;
    var css = document.createElement('style');
    css.textContent =
      '#kmBackBar{display:flex;gap:6px;align-items:center;padding:6px 10px;background:#f8faf9;border-bottom:1px solid #e5e7eb;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;position:relative;z-index:5}' +
      '#kmBackBar button{display:inline-flex;align-items:center;gap:4px;border:1px solid #d1d5db;background:#fff;color:#1a5c3a;' +
      'border-radius:16px;padding:5px 12px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;line-height:1.2}' +
      '#kmBackBar button:hover{border-color:#1a5c3a}' +
      '@media print{#kmBackBar{display:none!important}}';
    document.head.appendChild(css);
    var bar = document.createElement('div');
    bar.id = 'kmBackBar';
    bar.innerHTML = '<button type="button" id="kmBackBtn" aria-label="' + L[0] + '">← ' + L[0] + '</button>' +
                    '<button type="button" id="kmHomeBtn" aria-label="' + L[1] + '">🏠 ' + L[1] + '</button>';
    document.body.insertBefore(bar, document.body.firstChild);
    document.getElementById('kmBackBtn').onclick = goBack;
    document.getElementById('kmHomeBtn').onclick = function(){ location.href = './hub.html'; };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
