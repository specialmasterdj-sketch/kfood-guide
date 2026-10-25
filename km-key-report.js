/* ============================================================
   km-key-report.js — 핵심 품목 점검(그로서리 Top 500 · 신선 데일리 · 야채 동선)을
   「제출」하면 두 군데로 알린다. (2026-10-25 사장님: "매니징 룸 연결해서 보여줘",
   "데일리 매니저 보고까지 같이 한 곳에서 보게")
     ① 매니징 룸(chat/messages/managing) 에 한 줄 요약 메시지
     ② inventory/keyItems/{kind}/sent/{날짜}/{지점}_{구역} 에 작은 제출 기록
        → report-board.html(일일 보고 현황판)이 이걸 읽어 날짜×지점 표에 같이 보여 준다.
   이름은 페이지의 NAME 칸(직접 입력)이 아니라 앱에 로그인한 계정(chat.me)으로 남긴다.
   실패해도 점검 저장 자체에는 영향이 없다 (알림만 못 감).
   ============================================================ */
(function(){
  const FB = 'https://kimchi-mart-order-default-rtdb.firebaseio.com';
  const BR = { coral:'CORAL_SPRINGS', hollywood:'HOLLYWOOD', lasolas:'LASOLAS', miami:'MIAMI', pembroke:'PEMBROKE_PINES', wpb:'WEST_PALM_BEACH' };
  const STORE_KO = { coral:'코럴 스프링스', hollywood:'헐리우드', lasolas:'라스올라스', miami:'마이애미', pembroke:'펨브로크', wpb:'웨스트팜비치' };
  const KIND = { grocery:{ ic:'🛒', ko:'그로서리 Top 500' }, fresh:{ ic:'🥬', ko:'신선 데일리' } };
  const safe = s => String(s).replace(/[.#$\[\]\/]/g, '_');

  async function authQuery(){
    for (let i = 0; i < 60 && !window.__getAuthToken; i++) await new Promise(r => setTimeout(r, 200));
    const tok = window.__getAuthToken ? await window.__getAuthToken() : null;
    return tok ? '?auth=' + encodeURIComponent(tok) : '';
  }

  // o: {kind:'grocery'|'fresh', zone, zoneKo, store, date, typedName, top, topDone, total, ok, low, no}
  window.kmKeyReportSent = async function(o){
    try {
      let me = null; try { me = JSON.parse(localStorage.getItem('chat.me') || 'null'); } catch(_){}
      const who = (me && me.name) || (o.typedName || '').trim() || '?';
      const q = await authQuery();
      if (!q) return;
      const ts = Date.now();
      const k = KIND[o.kind] || KIND.fresh;
      const rec = { at: ts, name: who, uid: (me && me.uid) || null, role: (me && me.role) || '',
                    typedName: (o.typedName || '').trim(), zone: o.zone, zoneKo: o.zoneKo || o.zone, store: o.store,
                    top: o.top ?? null, topDone: o.topDone ?? null, total: o.total ?? null,
                    ok: o.ok ?? null, low: o.low ?? null, no: o.no ?? null };
      await fetch(`${FB}/inventory/keyItems/${o.kind}/sent/${o.date}/${safe(o.store + '_' + o.zone)}.json${q}`, {
        method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(rec) });

      const time = new Date(ts).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
      const lines = [ `${k.ic} ${k.ko} — ${rec.zoneKo} · ${STORE_KO[o.store] || o.store}`,
                      `📅 ${o.date} · ${who} · ${time}` ];
      const parts = [];
      if (rec.top) parts.push(`✓ Top ${rec.topDone}/${rec.top} 확인`);
      else if (rec.total) parts.push(`✓ ${(rec.ok || 0) + (rec.low || 0) + (rec.no || 0)}/${rec.total} 확인`);
      if (rec.low) parts.push(`🟡 부족 ${rec.low}`);
      parts.push(rec.no ? `✗ 없음·안됨 ${rec.no}` : '✗ 없음 0');
      lines.push(parts.join(' · '));
      const msgId = 'm' + ts + Math.floor(Math.random() * 900);
      const msg = { sender: who, senderBranch: BR[o.store] || '', senderRole: rec.role || 'MANAGER', isManager: true,
                    color: '#1a5c3a', text: lines.join('\n'), ts, photos: [], files: [],
                    _keyReport: { kind: o.kind, zone: o.zone, store: o.store, date: o.date } };
      await fetch(`${FB}/chat/messages/managing/${msgId}.json${q}`, {
        method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(msg) });
      fetch(`${FB}/chat/rooms/managing.json${q}`, { method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ lastMsg: `${k.ic} ${k.ko} — ${STORE_KO[o.store] || o.store} ${rec.zoneKo}`, lastTs: ts, lastSender: who }) }).catch(()=>{});
    } catch(e){ console.warn('[km-key-report]', e); }
  };
})();
