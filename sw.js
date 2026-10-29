// Hält die Seite bereit, damit sie im Gym auch ohne Empfang startet. Erst das Netz fragen (so kommen
// Änderungen sofort an), bei Ausfall den Zwischenspeicher nehmen. Die Trainingsdaten selbst liegen im
// localStorage des Browsers und laufen hier nie durch. Bei Änderungen an dieser Datei CACHE hochzählen.
const CACHE = "trainingslog-v1";
const SHELL = ["./", "index.html", "training.css", "training.js", "catalog.json", "hud.css", "fonts.css", "manifest.webmanifest",
  "icons/icon-192.png", "fonts/Rajdhani-500-latin.woff2", "fonts/Rajdhani-600-latin.woff2", "fonts/Rajdhani-700-latin.woff2",
  "fonts/ShareTechMono-400-latin.woff2"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((cache) => cache.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html")))
  );
});
