// Drop-in fetch interceptor that auto-attaches the Firebase Auth ID token
// to every RTDB REST call. Pages can keep using plain fetch() — the global
// patch below appends ?auth=<token> when the URL targets firebaseio.com,
// so they pass the rules' `auth != null` check without touching each call.
//
// Usage: load BEFORE the page's main module so fetch is already patched
// when the page starts firing requests:
//   <script type="module" src="./fb-auth-fetch.js?v=1"></script>
//
// Pages that already explicitly append ?auth=<token> stay compatible —
// the patch's "auth=" check skips re-appending.
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const cfg = {
  apiKey: "AIzaSyBwL0Wa1Q8aFhZp5hsn9gTw5aZwXUdAVy4",
  authDomain: "kimchi-mart-order.firebaseapp.com",
  databaseURL: "https://kimchi-mart-order-default-rtdb.firebaseio.com",
  projectId: "kimchi-mart-order"
};
const app = getApps().length ? getApp() : initializeApp(cfg);
const auth = getAuth(app);

async function getIdToken() {
  try {
    const u = auth.currentUser;
    if (u) return await u.getIdToken();
  } catch (e) {}
  return null;
}
window.__getAuthToken = getIdToken;

// Monkey-patch fetch so every page automatically picks up auth without
// changing its existing call sites. Only RTDB hostnames are touched.
const originalFetch = window.fetch.bind(window);
window.fetch = async function (input, init) {
  let url = (typeof input === 'string') ? input : (input && input.url) || '';
  if (url && url.includes('firebaseio.com')) {
    const tok = await getIdToken();
    if (tok && !url.includes('auth=')) {
      const sep = url.includes('?') ? '&' : '?';
      const newUrl = url + sep + 'auth=' + encodeURIComponent(tok);
      if (typeof input === 'string') {
        input = newUrl;
      } else if (input instanceof Request) {
        input = new Request(newUrl, input);
      }
    }
  }
  return originalFetch(input, init);
};

// Pages can listen for this to retry initial fetches once the token
// has been restored from IndexedDB (auth state isn't ready synchronously).
onAuthStateChanged(auth, () => {
  try { window.dispatchEvent(new Event('fb-auth-ready')); } catch (_) {}
});
