const CACHE='book-club-shell-v1';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/manifest.webmanifest'])).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/'))return;
  if(req.mode==='navigate')event.respondWith(fetch(req).catch(()=>caches.match('/')));
  else if(/\.(?:js|css|png|jpg|jpeg|webp|svg|woff2?)$/i.test(url.pathname))event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));return r})));
});
