const CACHE='charito-shell-v27-closing';
const FILES=['./shift-entry.js','./workshop.js','./workshop-model.js','./workshop.css','./','./index.html','./app.js','./sales-ui.css','./fiscal.js','./fiscal-model.js','./fiscal.css','./control.js','./backup.js','./clean.css','./admin-reports.js','./report-model.js','./reports.css','./security.js','./v2.js','./product-order.js','./sale-history.js','./navigation.js','./work-dialogs.js','./date-time-picker.js','./order-photos.js','./order-experience.js','./experience.css','./users.js','./session.js','./sale-language.js','./sale-voice.js','./style.css','./comfort.css','./comfort.js','./supabase.js','./favicon.svg','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(!FILES.some(p=>new URL(p,self.registration.scope).pathname===url.pathname))return;
 event.respondWith(fetch(event.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}return r;}).catch(()=>caches.match(event.request)));
});
