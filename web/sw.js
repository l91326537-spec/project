'use strict';
/*
 * 소리길 서비스 워커: 앱 파일을 기기에 저장해 인터넷 없이도 열리게 한다.
 * 앱 파일(html·js·css)은 인터넷이 되면 늘 새로 받아 바로 새 버전을 보여 주고, 안 되면 저장해 둔 것을 쓴다.
 * 음성 파일과 글꼴은 바뀌지 않으므로 저장해 둔 것을 먼저 쓴다. 저장된 파일을 모두 비우려면 VERSION을 올린다.
 */
const VERSION = 'sorigil-v5';
const SHELL = ['./', 'index.html', 'style.css', 'content.js', 'focus.js', 'fit.js', 'qr.js', 'ads.js', 'speak.js', 'app.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const NET_WAIT = 3000; // 인터넷이 느리면 이만큼 기다린 뒤 저장해 둔 파일을 쓴다

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const font = /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !font) return;
  const stable = font || /\/voice\/(m\/)?[^/]+\.(mp3|m4a|ogg|wav)$/.test(url.pathname);
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    const save = (res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; };
    // 음성·글꼴: 저장한 것 먼저
    if (stable) return hit || fetch(req).then(save);
    // 앱 파일: 브라우저 캐시도 건너뛰고 새로 받는다(GitHub Pages는 10분 동안 옛 파일을 줄 수 있다)
    const net = fetch(req, { cache: 'no-cache' }).then(save);
    const fallback = () => hit || (req.mode === 'navigate' ? c.match('index.html') : Response.error());
    if (!hit) return net.catch(fallback);
    const slow = new Promise((res) => setTimeout(() => res(null), NET_WAIT));
    e.waitUntil(net.catch(() => {}));
    return Promise.race([net.catch(() => null), slow]).then((res) => res || hit);
  }));
});
