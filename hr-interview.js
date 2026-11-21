// 🎤 HR 외부 화상 인터뷰 — meet.html 맨 위 카드 (2026-11-20 사장님)
//   "다니엘 바노스(HR MANAGER)가 외부의 누구와도 가장 빠르게, 공신력 있게 화상 인터뷰"
//   · 보이는 사람 = Firebase 로그인 계정 기준 사장님·다니엘만 (이름은 사칭 가능 → 계정으로 판정)
//   · [링크 만들기] → 무작위 인터뷰 코드 → 공개 안내 페이지 interview.html?c=…&n=…&p=…&t=…&l=…
//     지원자는 앱·가입 없이 브라우저에서 KIMCHI MART 안내 화면 → [인터뷰 입장]
//   · 방 = meet.ffmuc.net/KimchiMart-Interview-{코드} (코드 추측 불가, 인터뷰마다 새 방)
//   · 데이터베이스에 아무것도 쓰지 않는다 — 최근 인터뷰 목록은 이 기기에만(localStorage)
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const IV_EMAILS = ['specialmasterdj@gmail.com', 'jdanielbanos@gmail.com'];
const IV_PHONES = ['+19544945025', '+17863197181'];   // DJ · DANIEL BANOS
const PAGE = 'https://specialmasterdj-sketch.github.io/kfood-guide/interview.html';
const LS = 'km.hrInterviews';
const HOST_NAME = 'Daniel Banos — HR Manager, KIMCHI MART';

const cfg = { apiKey:"AIzaSyBwL0Wa1Q8aFhZp5hsn9gTw5aZwXUdAVy4", authDomain:"kimchi-mart-order.firebaseapp.com",
              databaseURL:"https://kimchi-mart-order-default-rtdb.firebaseio.com", projectId:"kimchi-mart-order",
              storageBucket:"kimchi-mart-order.firebasestorage.app" };
const app = getApps().length ? getApp() : initializeApp(cfg);

const UI = {
  h:   {ko:'🎤 외부 화상 인터뷰 (HR)', en:'🎤 External video interview (HR)', es:'🎤 Entrevista externa por video (RH)'},
  s:   {ko:'지원자 이름·시간만 넣으면 KIMCHI MART 안내 링크가 만들어집니다. 지원자는 앱·가입 없이 브라우저로 들어옵니다.',
        en:'Enter the candidate and time — you get a KIMCHI MART invitation link. Candidates join from any browser, no app or account.',
        es:'Escriba el candidato y la hora — obtendrá un enlace de invitación de KIMCHI MART. Entran desde el navegador, sin app ni cuenta.'},
  nm:  {ko:'지원자 이름', en:'Candidate name', es:'Nombre del candidato'},
  ph:  {ko:'지원자 전화 (선택)', en:'Candidate phone (optional)', es:'Teléfono (opcional)'},
  ps:  {ko:'지원 직무 (선택)', en:'Position (optional)', es:'Puesto (opcional)'},
  dt:  {ko:'날짜·시간 (미 동부)', en:'Date & time (Eastern)', es:'Fecha y hora (Este)'},
  lg:  {ko:'지원자 언어', en:'Candidate language', es:'Idioma del candidato'},
  mk:  {ko:'🔗 인터뷰 링크 만들기', en:'🔗 Create interview link', es:'🔗 Crear enlace'},
  cp:  {ko:'📋 링크 복사', en:'📋 Copy link', es:'📋 Copiar enlace'},
  cpd: {ko:'✅ 복사됨', en:'✅ Copied', es:'✅ Copiado'},
  sms: {ko:'💬 문자로 보내기', en:'💬 Send by text', es:'💬 Enviar por texto'},
  em:  {ko:'✉️ 이메일로 보내기', en:'✉️ Send by email', es:'✉️ Enviar por correo'},
  jn:  {ko:'🎥 지금 입장', en:'🎥 Join now', es:'🎥 Entrar ahora'},
  pv:  {ko:'👁 지원자 화면 보기', en:'👁 Preview candidate page', es:'👁 Ver página del candidato'},
  rc:  {ko:'최근 인터뷰 (이 기기)', en:'Recent interviews (this device)', es:'Entrevistas recientes (este equipo)'},
  need:{ko:'지원자 이름을 적어 주세요', en:'Enter the candidate name', es:'Escriba el nombre del candidato'},
  rm:  {ko:'목록에서 지우기', en:'Remove from list', es:'Quitar'},
};
const lang = () => { try { const v = (localStorage.getItem('km.lang') || localStorage.getItem('lang') || document.documentElement.lang || 'ko').slice(0,2); return UI.h[v] ? v : 'ko'; } catch(e){ return 'ko'; } };
const t = k => UI[k][lang()] || UI[k].ko;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function allowed(u){
  if (!u) return false;
  const em = String(u.email || '').toLowerCase().trim(), ph = String(u.phoneNumber || '').trim();
  return (!!em && IV_EMAILS.includes(em)) || (!!ph && IV_PHONES.includes(ph));
}
function newCode(){
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = new Uint8Array(12); crypto.getRandomValues(b);
  return Array.from(b, x => a[x % a.length]).join('');
}
// 입력값(미 동부 시각) → ISO(오프셋 포함). 브라우저 시간대와 상관없이 동부 기준으로 맞춘다.
function easternIso(local){
  if (!local) return '';
  const [d, tm] = local.split('T'); if (!d || !tm) return '';
  for (const off of ['-05:00', '-04:00']) {
    const dt = new Date(d + 'T' + tm + ':00' + off);
    const hh = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(dt);
    if (hh === tm.slice(0,5)) return d + 'T' + tm + ':00' + off;
  }
  return d + 'T' + tm + ':00-05:00';
}
function linkFor(iv){
  const p = new URLSearchParams({ c: iv.c, n: iv.n, l: iv.l });
  if (iv.p) p.set('p', iv.p);
  if (iv.t) p.set('t', iv.t);
  return PAGE + '?' + p.toString();
}
function hostRoom(iv){
  return 'https://meet.ffmuc.net/KimchiMart-Interview-' + iv.c +
    '#config.prejoinConfig.enabled=true&config.disableDeepLinking=true&userInfo.displayName=' + encodeURIComponent(JSON.stringify(HOST_NAME));
}
function whenText(iv, L){
  if (!iv.t) return '';
  const d = new Date(iv.t); if (isNaN(d)) return '';
  return d.toLocaleString({en:'en-US',es:'es-US',ko:'ko-KR'}[L] || 'en-US', {timeZone:'America/New_York', weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}) + ' ET';
}
function inviteText(iv){
  const L = iv.l, w = whenText(iv, L), link = linkFor(iv);
  if (L === 'es') return 'Hola ' + iv.n + ', le saluda Daniel Banos, Gerente de RH de KIMCHI MART. Le invitamos a una entrevista por video' + (iv.p ? ' para el puesto de ' + iv.p : '') + (w ? ' el ' + w : '') + '. Abra este enlace desde su teléfono o computadora (no necesita app): ' + link + ' — Gracias.';
  if (L === 'ko') return iv.n + '님 안녕하세요, KIMCHI MART HR 매니저 Daniel Banos 입니다. ' + (iv.p ? iv.p + ' 직무 ' : '') + '화상 인터뷰에 초대드립니다' + (w ? ' (' + w + ')' : '') + '. 앱 설치 없이 아래 링크로 입장하시면 됩니다: ' + link + ' — 감사합니다.';
  return 'Hello ' + iv.n + ', this is Daniel Banos, HR Manager at KIMCHI MART. You are invited to a video interview' + (iv.p ? ' for the ' + iv.p + ' position' : '') + (w ? ' on ' + w : '') + '. Open this link from your phone or computer (no app needed): ' + link + ' — Thank you.';
}
function load(){ try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch(e){ return []; } }
function save(a){ try { localStorage.setItem(LS, JSON.stringify(a.slice(0, 15))); } catch(e){} }

function actions(iv){
  const tel = String(iv.ph || '').replace(/[^\d+]/g, '');
  const body = encodeURIComponent(inviteText(iv));
  const subj = encodeURIComponent(iv.l === 'es' ? 'Entrevista por video — KIMCHI MART' : iv.l === 'ko' ? 'KIMCHI MART 화상 인터뷰 안내' : 'Video interview — KIMCHI MART');
  return '<div class="ivacts" data-c="' + esc(iv.c) + '">' +
    '<button class="btn sm" data-a="cp">' + t('cp') + '</button>' +
    '<a class="btn sm" href="sms:' + esc(tel) + '?&body=' + body + '">' + t('sms') + '</a>' +
    '<a class="btn sm" href="mailto:?subject=' + subj + '&body=' + body + '">' + t('em') + '</a>' +
    '<a class="btn sm" target="_blank" rel="noopener" href="' + esc(linkFor(iv)) + '">' + t('pv') + '</a>' +
    '<a class="btn sm p" target="_blank" rel="noopener" href="' + esc(hostRoom(iv)) + '">' + t('jn') + '</a>' +
  '</div>';
}
function render(box){
  const list = load();
  const L = lang();
  box.innerHTML =
    '<h2 style="margin-top:6px">' + t('h') + '</h2>' +
    '<div class="card" style="border:2px solid #1d4ed8">' +
      '<div class="sub" style="margin-bottom:10px">' + t('s') + '</div>' +
      '<div class="ivgrid">' +
        '<label>' + t('nm') + '<input id="ivN" maxlength="80" autocomplete="off"></label>' +
        '<label>' + t('ph') + '<input id="ivP" type="tel" maxlength="20" autocomplete="off"></label>' +
        '<label>' + t('ps') + '<input id="ivS" maxlength="80" autocomplete="off"></label>' +
        '<label>' + t('dt') + '<input id="ivT" type="datetime-local"></label>' +
        '<label>' + t('lg') + '<select id="ivL"><option value="en">English</option><option value="es">Español</option><option value="ko">한국어</option></select></label>' +
      '</div>' +
      '<button class="btn p" id="ivMk" style="margin-top:10px;width:100%">' + t('mk') + '</button>' +
      '<div id="ivOut"></div>' +
      (list.length ? '<div class="sub" style="margin:14px 0 6px;font-weight:800">' + t('rc') + '</div>' +
        list.map(iv => '<div class="ivrow"><div><b>' + esc(iv.n) + '</b>' + (iv.p ? ' · ' + esc(iv.p) : '') +
          (iv.t ? '<div class="sub">' + esc(whenText(iv, L)) + '</div>' : '') + '</div>' + actions(iv) +
          '<button class="ivx" data-rm="' + esc(iv.c) + '" title="' + t('rm') + '">✕</button></div>').join('') : '') +
    '</div>';
  box.querySelector('#ivMk').onclick = () => {
    const n = box.querySelector('#ivN').value.trim();
    if (!n) { alert(t('need')); box.querySelector('#ivN').focus(); return; }
    const iv = { c: newCode(), n, ph: box.querySelector('#ivP').value.trim(), p: box.querySelector('#ivS').value.trim(),
                 t: easternIso(box.querySelector('#ivT').value), l: box.querySelector('#ivL').value, at: Date.now() };
    const a = load(); a.unshift(iv); save(a);
    render(box);
    const out = box.querySelector('#ivOut');
    out.innerHTML = '<div class="ivnew"><div class="sub" style="word-break:break-all;margin-bottom:8px">' + esc(linkFor(iv)) + '</div>' + actions(iv) + '</div>';
  };
  box.onclick = async (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { save(load().filter(x => x.c !== rm.dataset.rm)); render(box); return; }
    const cp = e.target.closest('[data-a="cp"]');
    if (cp) {
      const c = cp.closest('.ivacts').dataset.c, iv = load().find(x => x.c === c);
      if (!iv) return;
      try { await navigator.clipboard.writeText(inviteText(iv)); cp.textContent = t('cpd'); setTimeout(() => cp.textContent = t('cp'), 1800); }
      catch(_) { prompt('', inviteText(iv)); }
    }
  };
}
function mount(){
  if (document.getElementById('hrIv')) return;
  const anchor = document.getElementById('hRooms'); if (!anchor) return;
  const st = document.createElement('style');
  st.textContent = '#hrIv .ivgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
    '#hrIv label{display:flex;flex-direction:column;gap:4px;font-size:.82em;font-weight:800}' +
    '#hrIv input,#hrIv select{padding:9px 10px;border:1.5px solid #cbd5e1;border-radius:10px;font:inherit;font-weight:600;min-width:0}' +
    '#hrIv .ivacts{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}#hrIv .ivacts .btn{text-decoration:none}' +
    '#hrIv .ivrow{position:relative;border-top:1px dashed #e5e7eb;padding:10px 26px 8px 0}' +
    '#hrIv .ivx{position:absolute;right:0;top:10px;border:0;background:none;color:#94a3b8;font-size:1em;cursor:pointer}' +
    '#hrIv .ivnew{margin-top:12px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:12px;padding:12px}' +
    '@media (max-width:520px){#hrIv .ivgrid{grid-template-columns:1fr}}';
  document.head.appendChild(st);
  const box = document.createElement('section'); box.id = 'hrIv';
  anchor.parentNode.insertBefore(box, anchor);
  render(box);
}
onAuthStateChanged(getAuth(app), u => {
  const old = document.getElementById('hrIv');
  if (allowed(u)) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount(); }
  else if (old) old.remove();
});
