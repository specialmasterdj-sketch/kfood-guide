// back-nav.js — 김치마트 모든 앱 공통 백버튼 헬퍼
// PC 브라우저 ← 버튼 / 폰 시스템 백제스처 누르면 페이지를 떠나지 않고
// (1) 열린 모달/오버레이 닫기 → (2) sub-view 면 홈으로 → (3) 그래도 없으면 브라우저 기본 동작.
//
// 자동: .overlay.show / .modal-backdrop.show / #lightbox.show 가 떠 있으면 백 시 자동 닫힘
//       (MutationObserver 로 show 클래스 추가 감지 → pushState).
// 페이지 직접 등록: kmBack.attachView(isHome, goHome) 또는 kmBack.register(fn, priority).
(function(){
  if (window.__kmBackInjected) return;
  window.__kmBackInjected = true;

  const handlers = []; // { fn, priority }

  function visibleOverlay(){
    return document.querySelector('.overlay.show, .modal-backdrop.show, #lightbox.show, .lightbox.show');
  }

  function isOverlayLike(el){
    if (!el || el.nodeType !== 1) return false;
    if (el.id === 'lightbox') return true;
    return el.classList && (
      el.classList.contains('overlay') ||
      el.classList.contains('modal-backdrop') ||
      el.classList.contains('lightbox')
    );
  }

  // overlay show 감지 → 자동 pushState 한 칸
  // (페이지 코드가 push 안 해도 백버튼이 페이지를 떠나지 않게)
  const showObserver = new MutationObserver(muts => {
    for (const m of muts){
      if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
      const el = m.target;
      if (!isOverlayLike(el)) continue;
      if (el.classList.contains('show')){
        const cur = (history.state && history.state.kmBack) || null;
        if (cur !== 'overlay'){
          try { history.pushState({ kmBack: 'overlay' }, ''); } catch(e){}
        }
      }
    }
  });

  function attachAll(root){
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.overlay, .modal-backdrop, #lightbox, .lightbox').forEach(el => {
      try { showObserver.observe(el, { attributes: true, attributeFilter: ['class'] }); } catch(e){}
    });
  }

  // 새로 추가되는 overlay 도 자동 관찰
  function watchBody(){
    attachAll(document);
    const bodyObs = new MutationObserver(muts => {
      for (const m of muts){
        if (m.addedNodes){
          m.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            if (isOverlayLike(node)) {
              try { showObserver.observe(node, { attributes: true, attributeFilter: ['class'] }); } catch(e){}
            }
            attachAll(node);
          });
        }
      }
    });
    if (document.body) bodyObs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchBody);
  else watchBody();

  window.kmBack = {
    /** 추가 핸들러 등록. fn이 true 반환 시 처리됨 (체인 중단). */
    register(fn, priority){
      handlers.push({ fn, priority: priority || 50 });
      handlers.sort((a, b) => a.priority - b.priority);
    },
    /** sub-view 진입 시 history stack 한 칸 추가. */
    push(stateName){
      try {
        const cur = history.state || {};
        if (cur.kmBack === stateName) return;
        history.pushState({ kmBack: stateName || 'view' }, '');
      } catch(e){}
    },
    /**
     * Multi-page 앱 패턴 등록.
     *   isHome(): true 면 sub-view 가 아닌 홈 화면 (백버튼이 페이지를 떠남)
     *   goHome(): home 으로 돌아가는 함수 (예: () => goView('home'))
     * + sub-view 진입 시 한 번 push() 호출 필요.
     */
    attachView(isHome, goHome){
      this.register(() => {
        try {
          if (typeof isHome === 'function' && !isHome()){
            if (typeof goHome === 'function') goHome();
            return true;
          }
        } catch(e){}
        return false;
      }, 30);
    }
  };

  window.addEventListener('popstate', function(e){
    // 1) 보이는 overlay/lightbox 가 있으면 닫기
    const ov = visibleOverlay();
    if (ov){
      ov.classList.remove('show');
      // lightbox 이미지 src 비우기 (메모리)
      if (ov.id === 'lightbox' || ov.classList.contains('lightbox')){
        const img = ov.querySelector('img');
        if (img) img.src = '';
      }
      return;
    }
    // 2) 페이지가 등록한 핸들러 우선순위 순
    for (const h of handlers){
      try { if (h.fn(e) === true) return; } catch(err){ console.warn('[kmBack]', err); }
    }
    // 3) 그 외 — 브라우저 기본 동작 (이미 popstate 가 처리됨)
  });
})();
