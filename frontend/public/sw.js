/**
 * QuantumShield Service Worker
 * Handles PWA offline shell caching, zero-knowledge push wake-up notifications,
 * and background client focus.
 */

const CACHE_NAME = 'quantumshield-shell-v1';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

// --- Lifecycle: Install ------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Pre-caching partial failure (assets will be cached dynamically):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// --- Lifecycle: Activate ----------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// --- Fetch: Cache with Network Fallback (Exclude API & WS) -------------------
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypass service worker caching for WebSocket, API endpoints, and room requests
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/rooms') ||
    url.pathname.startsWith('/health') ||
    url.pathname.startsWith('/ws/') ||
    url.protocol === 'ws:' ||
    url.protocol === 'wss:'
  ) {
    return;
  }

  // Network-first strategy for index and app assets with offline cache fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Cache successful responses for GET requests
        if (event.request.method === 'GET' && networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        // Navigation fallback
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('Offline - QuantumShield App Shell', { status: 503, statusText: 'Offline' });
      })
  );
});

// --- Zero-Knowledge Push Notification Event ----------------------------------
self.addEventListener('push', (event) => {
  let payload = {
    title: 'QuantumShield',
    body: 'New encrypted signal received',
    icon: '/icon-192.png',
    badge: '/favicon.svg',
    tag: 'qs-signal',
    timestamp: Date.now(),
    url: '/',
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch {
      const text = event.data.text();
      if (text) {
        payload.body = text;
      }
    }
  }

  const notificationOptions = {
    body: payload.body,
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/favicon.svg',
    tag: payload.tag || 'qs-signal',
    renotify: true,
    vibrate: [100, 50, 100],
    data: {
      url: payload.url || '/',
      timestamp: payload.timestamp,
      roomId: payload.room_id,
    },
    actions: [
      { action: 'open', title: 'Open Secure Room' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'QuantumShield', notificationOptions)
  );
});

// --- Notification Click Event -----------------------------------------------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus already open QuantumShield tab if exists
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
