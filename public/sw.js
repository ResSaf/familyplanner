/* App-shell cache only. API responses and auth are never cached (section 8). */
const CACHE = 'familyplanner-shell-v3'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/badge-96.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.auth/')) return

  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')))
    return
  }
  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(e.request, copy))
        return res
      })),
    )
  }
})

/*
 * Phone notifications (5.15). The API encrypts each one for this phone; the browser decrypts it and hands it here.
 * A notice with the same tag as one already showing replaces it, so a repeat doesn't stack up.
 */
self.addEventListener('push', (e) => {
  let n = {}
  try {
    n = e.data ? e.data.json() : {}
  } catch {
    n = { body: e.data ? e.data.text() : '' }
  }
  e.waitUntil(
    self.registration.showNotification(n.title || 'FamilyPlanner', {
      body: n.body || '',
      tag: n.tag || undefined,
      renotify: Boolean(n.tag),
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: typeof n.url === 'string' && n.url.startsWith('/') ? n.url : '/' },
    }),
  )
})

/** Tapping opens the planner at the notice's page, reusing an open window if there is one. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin && !new URL(w.url).pathname.startsWith('/display'))
      if (win) {
        await win.focus()
        return 'navigate' in win ? win.navigate(url).catch(() => undefined) : undefined
      }
      return self.clients.openWindow(url)
    }),
  )
})
