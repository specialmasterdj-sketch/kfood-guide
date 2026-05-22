// ============================================================
// lang-sync.js — 모든 앱 공통 언어 동기화 레이어
// ============================================================
// 목적:
//   - 한 페이지에서 언어 변경 시 다른 탭/창의 모든 앱이 즉시 따라옴
//   - 키 혼재 (kimchi_lang / hub.lang / tasks.lang) 자동 정규화
//
// 사용:
//   <script src="./lang-sync.js?v=1"></script>  ← 다른 스크립트보다 먼저 로드
//
// 동작:
//   1) 페이지 로드 시 — 3개 키 중 하나라도 값 있으면 나머지 둘에 미러링
//   2) storage 이벤트 — 다른 탭에서 변경 감지 → 키 정규화 + window.setLang 호출
//   3) setLang 노출 안 된 페이지는 location.reload() 폴백
// ============================================================
(function(){
  'use strict';
  var KEYS = ['kimchi_lang', 'hub.lang', 'tasks.lang'];
  var VALID = { ko:1, en:1, es:1 };

  function readCurrent(){
    for (var i = 0; i < KEYS.length; i++) {
      var v = null;
      try { v = localStorage.getItem(KEYS[i]); } catch(e){}
      if (v && VALID[v]) return v;
    }
    return null;
  }

  function mirrorAll(v, except){
    if (!VALID[v]) return;
    KEYS.forEach(function(k){
      if (k === except) return;
      try {
        if (localStorage.getItem(k) !== v) localStorage.setItem(k, v);
      } catch(e){}
    });
  }

  // 1) 페이지 로드 시 즉시 정규화 — 한 키만 셋팅된 상태였다면 나머지 채움
  //    🆕 2026-05-22 전무님 — 한국 직원이 2% 라 기본 언어 영어 강제.
  //    A) 첫 방문 (localStorage 비어있음) → 'en' 강제
  //    B) 기존 사용자 (마이그레이션 마커 없음) → 한 번만 'en' 으로 reset.
  //       이후 사용자가 KO/ES 클릭하면 그 값이 저장되고 다시는 강제 안 됨.
  var MIG_KEY = 'lang_default_v1_en_migration';
  var migrated = false;
  try { migrated = !!localStorage.getItem(MIG_KEY); } catch(e){}
  var current = readCurrent();
  if (!current || !migrated) {
    current = 'en';
    KEYS.forEach(function(k){ try { localStorage.setItem(k, 'en'); } catch(e){} });
    try { localStorage.setItem(MIG_KEY, String(Date.now())); } catch(e){}
  }
  mirrorAll(current);

  // 2) 다른 탭/창에서 변경 시
  window.addEventListener('storage', function(e){
    if (!e.key || KEYS.indexOf(e.key) === -1) return;
    if (!e.newValue || !VALID[e.newValue]) return;
    // 나머지 키도 같은 값으로 통일 (자기 자신 포함 — 이미 e.key 는 새 값임)
    mirrorAll(e.newValue, e.key);
    // 페이지의 setLang 호출 — 즉시 UI 반영
    var changed = false;
    if (typeof window.setLang === 'function') {
      try { window.setLang(e.newValue); changed = true; } catch(_){}
    }
    // setLang 없거나 실패하면 reload 폴백 (단순 페이지들)
    if (!changed) {
      try { location.reload(); } catch(_){}
    }
  });

  // 3) 외부에서 일관 저장 위한 헬퍼 — 옵션
  window.__langSync = {
    set: function(v){
      if (!VALID[v]) return false;
      mirrorAll(v);
      if (typeof window.setLang === 'function') {
        try { window.setLang(v); } catch(_){}
      }
      return true;
    },
    get: readCurrent
  };
})();
