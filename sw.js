/* ひと呼吸：画面を端末に保存して、すぐ開くためのしくみ。データは保存しない（データは暗号化して別に置く） */
const V='hk-20261125212923',FILES=["./", "./index.html", "./app.js?v=20261125212923", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
  e.respondWith(caches.match(r,{ignoreSearch:r.mode==='navigate'}).then(m=>m||fetch(r)))});
