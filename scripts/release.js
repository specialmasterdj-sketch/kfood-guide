#!/usr/bin/env node
// ============================================================================
// 🚦 KIMCHI MART 배포 게이트 — 2026-07-19 사장님 지시로 의무화된 절차의 실행 도구
//
// "재현 테스트 → 수정 → 재확인 → 구동 → 마지막 확인 → 배포 → 배포 후 확인 → 최종 완료"
//
// 사용법:
//   node scripts/release.js pre [파일...]
//     배포 전 게이트: ① 변경된(또는 지정한) html/js 전체 문법 검사
//                     ② scripts/test-*.js 회귀 테스트 전부 실행
//     하나라도 실패하면 exit 1 → 배포 금지.
//
//   node scripts/release.js post chat.html=chat_2026_07_19_xxx [파일=문자열 ...] [파일!=금지문자열]
//     배포 후 게이트: GitHub Pages 라이브에서 각 파일을 직접 내려받아
//     지정 문자열(BUST 등)이 있는지 / 금지 문자열(제거한 구 코드)이 없는지 확인.
//     반영될 때까지 최대 8분 폴링. 실패하면 exit 1 → "완료" 보고 금지.
// ============================================================================
'use strict';
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const LIVE = 'https://specialmasterdj-sketch.github.io/kfood-guide/';
// 알려진 추출 artifact — HTML 주석 안의 <script> 텍스트가 스크립트로 오인 추출되는 블록.
// (실제 브라우저는 주석으로 처리 — 오류 아님. 2026-07-18 확인)
const KNOWN_ARTIFACTS = ['가 CHAMP.slides 로 렌더'];

function die(msg){ console.error('\n💥 ' + msg + '\n→ 게이트 실패. 배포/완료 보고 금지.'); process.exit(1); }
function ok(msg){ console.log('✅ ' + msg); }

function nodeCheck(file){
  const r = spawnSync(process.execPath, ['--check', file], { encoding:'utf8' });
  return { ok: r.status === 0, err: (r.stderr || '').split('\n').slice(0,4).join('\n') };
}

function checkHtml(file){
  const html = fs.readFileSync(path.join(REPO, file), 'utf8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmrel-'));
  let n = 0, bad = 0;
  for (const [pat, ext] of [[/<script>([\s\S]*?)<\/script>/g, 'js'], [/<script type="module">([\s\S]*?)<\/script>/g, 'mjs']]){
    let m;
    while ((m = pat.exec(html)) !== null){
      const body = m[1];
      if (KNOWN_ARTIFACTS.some(a => body.slice(0, 400).includes(a))) { continue; }  // 알려진 artifact 스킵
      n++;
      const p = path.join(tmp, 'blk' + n + '.' + ext);
      fs.writeFileSync(p, body, 'utf8');
      const r = nodeCheck(p);
      if (!r.ok){ bad++; console.error('  ❌ ' + file + ' 블록 #' + n + '\n' + r.err); }
    }
  }
  if (bad) die(file + ' 문법 오류 ' + bad + '건');
  ok(file + ' — 스크립트 블록 ' + n + '개 문법 통과');
}

function checkJs(file){
  const src = fs.readFileSync(path.join(REPO, file), 'utf8');
  const isEsm = /^\s*import\s/m.test(src);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kmrel-')), path.basename(file) + (isEsm ? '.mjs' : '.js'));
  fs.writeFileSync(tmp, src, 'utf8');
  const r = nodeCheck(tmp);
  if (!r.ok) die(file + ' 문법 오류\n' + r.err);
  ok(file + ' — 문법 통과');
}

function runTests(){
  const tests = fs.readdirSync(path.join(REPO, 'scripts')).filter(f => /^test-.*\.js$/.test(f));
  if (!tests.length){ console.log('ℹ️ 회귀 테스트 없음 (scripts/test-*.js)'); return; }
  for (const t of tests){
    const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', t)], { encoding:'utf8' });
    process.stdout.write(r.stdout || '');
    if (r.status !== 0) die('회귀 테스트 실패: scripts/' + t + '\n' + (r.stderr || ''));
    ok('회귀 테스트 통과: scripts/' + t);
  }
}

async function fetchLive(file){
  const url = LIVE + file + '?nocache=' + Date.now();
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

async function post(args){
  if (!args.length) die('post 인자 필요: 파일=필수문자열 또는 파일!=금지문자열');
  const wants = [];   // {file, str, must}
  for (const a of args){
    let m = a.match(/^([^=!]+)!=(.+)$/);
    if (m) { wants.push({ file: m[1], str: m[2], must: false }); continue; }
    m = a.match(/^([^=]+)=(.+)$/);
    if (m) { wants.push({ file: m[1], str: m[2], must: true }); continue; }
    die('인자 형식 오류: ' + a);
  }
  const deadline = Date.now() + 8 * 60 * 1000;
  const files = [...new Set(wants.map(w => w.file))];
  while (true){
    let allOk = true, report = [];
    for (const f of files){
      let txt = '';
      try { txt = await fetchLive(f); } catch(e){ allOk = false; report.push('⏳ ' + f + ' fetch 실패: ' + e.message); continue; }
      for (const w of wants.filter(x => x.file === f)){
        const has = txt.includes(w.str);
        const pass = w.must ? has : !has;
        if (!pass) allOk = false;
        report.push((pass ? '✅' : '⏳') + ' ' + f + (w.must ? ' 에 "' : ' 에 금지문자열 "') + w.str.slice(0,60) + '" ' + (w.must ? (has ? '반영됨' : '아직 없음') : (has ? '아직 남아있음' : '제거 확인')));
      }
    }
    console.log(report.join('\n'));
    if (allOk){ console.log('\n🎉 배포 후 검증 전체 통과 — 라이브 반영 확인 완료'); return; }
    if (Date.now() > deadline) die('8분 내 라이브 반영 확인 실패');
    console.log('… 20초 후 재확인\n');
    await new Promise(r => setTimeout(r, 20000));
  }
}

(async function main(){
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'pre'){
    let files = args;
    if (!files.length){
      const out = execSync('git diff --name-only HEAD', { cwd: REPO, encoding:'utf8' })
                + execSync('git diff --name-only --cached', { cwd: REPO, encoding:'utf8' });
      files = [...new Set(out.split('\n').map(s => s.trim()).filter(Boolean))]
        .filter(f => /\.(html|js)$/.test(f) && fs.existsSync(path.join(REPO, f)));
      if (!files.length) console.log('ℹ️ 변경된 html/js 없음 — 회귀 테스트만 실행');
    }
    console.log('🚦 배포 전 게이트 — 대상: ' + (files.join(', ') || '(없음)') + '\n');
    for (const f of files){
      if (f.endsWith('.html')) checkHtml(f); else checkJs(f);
    }
    runTests();
    console.log('\n🎉 배포 전 게이트 통과 — git fetch → rebase → push 진행 가능');
  } else if (mode === 'post'){
    await post(args);
  } else {
    console.log('사용법:\n  node scripts/release.js pre [파일...]\n  node scripts/release.js post 파일=문자열 [파일!=금지문자열 ...]');
    process.exit(1);
  }
})().catch(e => die(e.stack || String(e)));
