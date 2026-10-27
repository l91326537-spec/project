'use strict';
/*
 * 소리길 서비스 워커: 앱 파일을 기기에 저장해 인터넷 없이도 열리게 한다.
 * 고친 파일은 뒤에서 받아 두었다가 다음 실행 때부터 보인다. 저장된 파일을 모두 비우려면 VERSION을 올린다.
 */
const VERSION = 'sorigil-v3';
const SHELL = ['./', 'index.html', 'style.css', 'content.js', 'focus.js', 'app.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 저장해 둔 파일을 먼저 보여 주고, 뒤에서 새 파일을 받아 다음 실행 때 쓴다.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const font = /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !font) return;
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }).catch(() => hit || (req.mode === 'navigate' ? c.match('index.html') : Response.error()));
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
