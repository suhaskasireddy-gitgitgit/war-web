// WAR's offline copy: the page, the engine files, the icons and the manifest, kept so the game opens with no connection.
//
// Online nothing changes: the page is always fetched from the network first, so version.json and the reload in
// bootWhenCurrent work as before, and a new build is never shadowed by a kept one. The engine files carry the build in
// their ?v= query, so a kept copy can only ever be that build's own bytes. Offline, the last build that booted is served.
//
// Prod (war-web/) and dev (war-web/dev/) share one origin and so one set of caches: every cache name carries this
// worker's folder, and this worker only answers for files directly in its folder or its Build/, never a sub-folder's.
// Relay, accounts, feedback, version.json and the game's own data and news fetches are never touched.

const SCOPE = self.registration.scope;
const BASE = new URL(SCOPE).pathname;
const PREFIX = "war|" + BASE + "|";
const META = PREFIX + "kept";
const CURRENT = SCOPE + "__kept-build";
// A shell slower than this, when one is kept, gives way to the kept one: a phone on one bar waits seconds, not a minute.
const SHELL_WAIT_MS = 6000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

function rest(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : null;
}

function buildOf(html) {
  const m = /var BUILD = ("(?:[^"\\]|\\.)*");/.exec(html);
  try { return m ? JSON.parse(m[1]) : null; } catch (_) { return null; }
}

async function keptBuild() {
  const r = await (await caches.open(META)).match(CURRENT);
  return r ? r.text() : null;
}

async function keptShell() {
  const v = await keptBuild();
  return v ? (await caches.open(PREFIX + v)).match(SCOPE) : undefined;
}

// The page as fetched, filed under the build it names, so a kept shell always matches the engine kept beside it.
async function fileShell(res) {
  const html = await res.text();
  const v = buildOf(html);
  if (!v) return;
  await (await caches.open(PREFIX + v)).put(SCOPE, new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
}

async function shell(e) {
  const kept = await keptShell();
  const net = fetch(e.request).then((res) => {
    if (res.ok && res.type === "basic") e.waitUntil(fileShell(res.clone()));
    return res;
  });
  if (!kept) return net;
  const late = new Promise((done) => setTimeout(() => done(null), SHELL_WAIT_MS));
  return Promise.race([net.catch(() => null), late]).then((res) => res || kept);
}

async function engine(e, url) {
  const name = PREFIX + url.searchParams.get("v");
  const cache = await caches.open(name);
  const hit = await cache.match(url.href, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(e.request);
  if (res.status === 200 && res.type === "basic") e.waitUntil(cache.put(url.href, res.clone()));
  return res;
}

async function nearby(e, url) {
  try {
    return await fetch(e.request);
  } catch (err) {
    for (const name of await caches.keys()) {
      if (!name.startsWith(PREFIX)) continue;
      const hit = await (await caches.open(name)).match(url.href, { ignoreVary: true, ignoreSearch: true });
      if (hit) return hit;
    }
    throw err;
  }
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const r = rest(url);
  if (r === null) return;
  if (e.request.mode === "navigate" && (r === "" || r === "index.html")) e.respondWith(shell(e));
  else if (r.startsWith("Build/") && !r.slice(6).includes("/") && url.searchParams.has("v")) e.respondWith(engine(e, url));
  else if (!r.includes("/") && /\.(png|webmanifest)$/.test(r)) e.respondWith(nearby(e, url));
});

// The page says which build just booted and the files it used. Once every one is kept, that build becomes the one served
// offline and every other build's copy in this folder is dropped, so a phone holds one build per folder, about 40MB.
async function keep(version, urls) {
  const cache = await caches.open(PREFIX + version);
  for (const u of urls) {
    const url = new URL(u, SCOPE);
    if (rest(url) === null || rest(url).includes("/") && !rest(url).startsWith("Build/")) continue;
    if (await cache.match(url.href, { ignoreVary: true })) continue;
    const res = await fetch(url.href);
    if (res.status !== 200) return;
    await cache.put(url.href, res);
  }
  if (!(await cache.match(SCOPE))) {
    const res = await fetch(SCOPE, { cache: "no-store" });
    if (!res.ok) return;
    const html = await res.text();
    if (buildOf(html) !== version) return;   // a newer build landed meanwhile; keep the last whole one
    await cache.put(SCOPE, new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
  }
  await (await caches.open(META)).put(CURRENT, new Response(version));
  for (const name of await caches.keys())
    if (name.startsWith(PREFIX) && name !== META && name !== PREFIX + version) await caches.delete(name);
}

self.addEventListener("message", (e) => {
  const m = e.data || {};
  if (m.type === "keep" && typeof m.version === "string" && Array.isArray(m.urls)) e.waitUntil(keep(m.version, m.urls));
});
