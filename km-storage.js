// Kimchi Mart — IndexedDB-backed persistent storage.
//
// 배경: top500 재고/사진이 반복적으로 사라지는 사건 (5/15, 5/16) 후 도입.
// 원인 가설: iOS Safari localStorage 의 5MB 쿼터 / 7일 ITP 만료 / PWA 재설치 등
// 으로 백업이 silent 하게 사라짐.
//
// IndexedDB 는 ~디스크의 50% (수 GB) 쿼터 + iOS 의 storage eviction 정책에서
// localStorage 보다 훨씬 더 잘 살아남음. navigator.storage.persist() 와 함께
// 사용하면 사용자가 명시적으로 지우기 전까지 영구.
//
// 사용 방법:
//   <script src="./km-storage.js?v=1"></script>
//   await kmStorage.ready();
//   await kmStorage.setPhoto(key, dataURL, meta);
//   const all = await kmStorage.getAllPhotos();
//
// 키 구조: localStorage 와 동일 (마이그레이션 없이 mirror 가능).

(function(){
  const DB_NAME = 'kimchi-mart-storage';
  const DB_VERSION = 1;
  const STORE_PHOTOS = 'photos';   // key: photoKey, value: { dataURL, meta, ts }
  const STORE_STATE = 'state';     // key: 'branch::code', value: { branch, code, entry, ts }
  const STORE_RAW = 'raw';         // key: any, value: any (백업 JSON 보관 등)

  let dbPromise = null;

  function openDB(){
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB not supported'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_PHOTOS)) db.createObjectStore(STORE_PHOTOS);
        if (!db.objectStoreNames.contains(STORE_STATE))  db.createObjectStore(STORE_STATE);
        if (!db.objectStoreNames.contains(STORE_RAW))    db.createObjectStore(STORE_RAW);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function txn(store, mode){
    return openDB().then(db => db.transaction(store, mode).objectStore(store));
  }

  function reqToPromise(req){
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function persistStorage(){
    try {
      if (navigator.storage && navigator.storage.persist){
        const granted = await navigator.storage.persist();
        console.info('[km-storage] persistent storage:', granted);
        return granted;
      }
    } catch(e) { console.warn('[km-storage] persist() failed', e); }
    return false;
  }

  async function estimate(){
    try {
      if (navigator.storage && navigator.storage.estimate){
        return await navigator.storage.estimate();
      }
    } catch(_){}
    return null;
  }

  // -------- Photos --------
  async function setPhoto(key, dataURL, meta){
    const store = await txn(STORE_PHOTOS, 'readwrite');
    return reqToPromise(store.put({ dataURL, meta: meta||null, ts: Date.now() }, key));
  }
  async function getPhoto(key){
    const store = await txn(STORE_PHOTOS, 'readonly');
    return reqToPromise(store.get(key));
  }
  async function deletePhoto(key){
    const store = await txn(STORE_PHOTOS, 'readwrite');
    return reqToPromise(store.delete(key));
  }
  async function getAllPhotos(){
    const store = await txn(STORE_PHOTOS, 'readonly');
    const keys = await reqToPromise(store.getAllKeys());
    const vals = await reqToPromise(store.getAll());
    const out = {};
    keys.forEach((k, i) => { out[k] = vals[i]; });
    return out;
  }

  // -------- State (재고 점검) --------
  function stateKey(branch, code){ return branch + '::' + code; }
  async function setState(branch, code, entry){
    const store = await txn(STORE_STATE, 'readwrite');
    return reqToPromise(store.put({ branch, code, entry, ts: Date.now() }, stateKey(branch, code)));
  }
  async function deleteState(branch, code){
    const store = await txn(STORE_STATE, 'readwrite');
    return reqToPromise(store.delete(stateKey(branch, code)));
  }
  async function getAllState(){
    const store = await txn(STORE_STATE, 'readonly');
    const vals = await reqToPromise(store.getAll());
    // group by branch → { branch: { code: entry } }
    const out = {};
    vals.forEach(v => {
      if (!out[v.branch]) out[v.branch] = {};
      out[v.branch][v.code] = v.entry;
    });
    return out;
  }

  // -------- Raw (사용자 JSON 백업 보관 등) --------
  async function setRaw(key, value){
    const store = await txn(STORE_RAW, 'readwrite');
    return reqToPromise(store.put(value, key));
  }
  async function getRaw(key){
    const store = await txn(STORE_RAW, 'readonly');
    return reqToPromise(store.get(key));
  }

  // -------- 1회용 localStorage → IndexedDB 마이그레이션 --------
  async function migrateFromLocalStorage(){
    let migrated = 0;
    // photos
    try {
      const raw = localStorage.getItem('top500.photoBackup') || '{}';
      const bk = JSON.parse(raw);
      for (const [k, v] of Object.entries(bk)){
        if (v && (v.dataURL || typeof v === 'string')){
          await setPhoto(k, v.dataURL || v, v.meta || null);
          migrated++;
        }
      }
    } catch(_){}
    // state
    try {
      const raw = localStorage.getItem('top500.stateBackup') || '{}';
      const bk = JSON.parse(raw);
      for (const [branch, items] of Object.entries(bk)){
        for (const [code, entry] of Object.entries(items||{})){
          await setState(branch, code, entry);
          migrated++;
        }
      }
    } catch(_){}
    if (migrated > 0) console.info('[km-storage] migrated ' + migrated + ' items from localStorage');
    return migrated;
  }

  // 최초 사용 시 persist + migration 자동 실행
  let _ready = null;
  function ready(){
    if (_ready) return _ready;
    _ready = (async () => {
      await openDB();
      await persistStorage();
      await migrateFromLocalStorage();
    })();
    return _ready;
  }

  window.kmStorage = {
    ready, persistStorage, estimate,
    setPhoto, getPhoto, deletePhoto, getAllPhotos,
    setState, deleteState, getAllState,
    setRaw, getRaw,
    _stateKey: stateKey,
  };

  // 페이지 로드 시 자동 초기화 (silent — 호출자가 ready() await 하지 않아도 동작)
  ready().catch(e => console.warn('[km-storage] init failed', e));
})();
