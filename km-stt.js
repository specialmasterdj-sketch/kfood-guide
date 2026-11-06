/* 🎙 km-stt.js — 회의 통역의 "말 → 글" 을 **서버(구글)** 가 하게 하는 쪽.
   2026-11-06 전무님 "무조건 잘되게 만들어줘".

   왜 만들었나: 지금까지는 폰·브라우저가 공짜로 받아 적었다. 매장은 시끄럽고 발음이 제각각이라
   자주 틀렸고(실측 "나도 다시 다시 백"), 「내 언어」를 잘못 고르면 통째로 어긋났다.
   아이폰·안드로이드마다 되는 정도도 달랐다.

   어떻게: 마이크 소리를 듣고 있다가 **말이 멎으면 그 한 덩이를** 16kHz 모노 소리로 보낸다.
   브라우저가 주는 글자를 안 쓰므로 기기를 안 탄다. 받아 적기는 meetStt(Cloud Function)가 한다.

   🔑 소리를 Storage 가 아니라 **RTDB 에 base64 로** 잠깐 올린다 —
      Storage 규칙이 이미지만 허용하고 있어 규칙을 새로 게시해야 하는데,
      그건 다른 앱(사진 7.3GB)까지 걸린 파일이라 건드리지 않는 쪽을 골랐다.
      서버가 받아 적는 즉시 지운다.
*/
(function(){
  const SR = 16000;            // 구글에 보낼 소리 빠르기
  const QUIET = 1500;          // 이만큼 조용하면 한 문장이 끝난 것으로 본다
  const MIN_MS = 400;          // 너무 짧은 건 보내지 않는다 (기침·문 소리)
  const MAX_MS = 14000;        // 길게 말해도 이쯤에서 한 번 끊어 보낸다
  const LEVEL = 0.012;         // 이보다 작으면 조용한 것으로 본다

  let ctx = null, src = null, node = null, stream = null;
  let buf = [], bufLen = 0, speaking = false, quietAt = 0, startAt = 0, onLine = null, live = false;

  function flush(){
    const ms = bufLen / SR * 1000;
    const parts = buf; buf = []; bufLen = 0; speaking = false;
    if (ms < MIN_MS || !onLine) return;
    const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0; parts.forEach(p => { all.set(p, o); o += p.length; });
    onLine(wav16(all));
  }

  // Float32 소리를 16비트 WAV 로 — 구글이 바로 읽는 모양 (LINEAR16)
  function wav16(f32){
    const n = f32.length, b = new ArrayBuffer(n * 2), v = new DataView(b);
    for (let i = 0; i < n; i++) {
      let s = Math.max(-1, Math.min(1, f32[i]));
      v.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Uint8Array(b);
  }

  function b64(u8){
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }

  async function start(cb){
    if (live) return true;
    onLine = cb;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { return false; }
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    if (ctx.state === "suspended") { try { await ctx.resume(); } catch (_) {} }
    src = ctx.createMediaStreamSource(stream);
    // ScriptProcessor 는 낡았지만 아이폰 사파리까지 다 된다 — 여기서는 그게 더 중요하다
    node = ctx.createScriptProcessor(4096, 1, 1);
    const ratio = ctx.sampleRate / SR;
    node.onaudioprocess = e => {
      if (!live) return;
      const inp = e.inputBuffer.getChannelData(0);
      let sum = 0; for (let i = 0; i < inp.length; i++) sum += inp[i] * inp[i];
      const vol = Math.sqrt(sum / inp.length);
      const now = Date.now();
      // 16kHz 로 솎아 낸다 (간단한 건너뛰기 — 말소리에는 충분하다)
      const out = new Float32Array(Math.floor(inp.length / ratio));
      for (let i = 0; i < out.length; i++) out[i] = inp[Math.floor(i * ratio)];
      if (vol > LEVEL) {
        if (!speaking) { speaking = true; startAt = now; }
        quietAt = 0;
        buf.push(out); bufLen += out.length;
        if (now - startAt > MAX_MS) flush();
      } else if (speaking) {
        buf.push(out); bufLen += out.length;          // 말 끝의 여운도 같이 담는다
        if (!quietAt) quietAt = now;
        else if (now - quietAt > QUIET) flush();
      }
    };
    src.connect(node); node.connect(ctx.destination);
    live = true;
    return true;
  }

  function stop(){
    live = false;
    try { flush(); } catch (_) {}
    try { node && node.disconnect(); src && src.disconnect(); } catch (_) {}
    try { stream && stream.getTracks().forEach(t => t.stop()); } catch (_) {}
    try { ctx && ctx.close(); } catch (_) {}
    ctx = src = node = stream = null; buf = []; bufLen = 0; speaking = false;
  }

  window.KM_STT = { start, stop, b64, get live(){ return live; } };
})();
