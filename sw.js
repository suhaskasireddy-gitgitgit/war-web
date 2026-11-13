// The old address's offline copy, retired (tools/play-worker/README.md). A browser checks for a new sw.js on its own,
// so this reaches phones that never open the forwarder page itself: it drops the kept build and unregisters, and
// every later visit goes to the network, where the forwarder is.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  const base = new URL(self.registration.scope).pathname;
  for (const name of await caches.keys()) if (name.startsWith("war|" + base + "|")) await caches.delete(name);
  await self.registration.unregister();
})()));
