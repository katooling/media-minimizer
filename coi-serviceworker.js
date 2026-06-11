const OFFLINE_CACHE_VERSION = "20260307-1";
const APP_CACHE = `media-minimizer-${OFFLINE_CACHE_VERSION}`;
const CORE_ASSET_VERSION = "20260307-1";

const APP_SHELL_PATHS = [
    "./",
    "./index.html",
    "./styles.css",
    "./app.js",
    "./manifest.webmanifest",
    "./coi-serviceworker.js",
    "./assets/icons/icon-192.png",
    "./assets/icons/icon-512.png",
    "./assets/icons/icon-maskable-512.png",
    "./vendor/ffmpeg/ffmpeg/classes.js",
    "./vendor/ffmpeg/ffmpeg/const.js",
    "./vendor/ffmpeg/ffmpeg/errors.js",
    "./vendor/ffmpeg/ffmpeg/index.js",
    "./vendor/ffmpeg/ffmpeg/types.js",
    "./vendor/ffmpeg/ffmpeg/utils.js",
    "./vendor/ffmpeg/ffmpeg/worker.js",
    "./vendor/ffmpeg/util/const.js",
    "./vendor/ffmpeg/util/errors.js",
    "./vendor/ffmpeg/util/index.js",
    "./vendor/ffmpeg/util/types.js",
];

const RUNTIME_CACHE_PATHS = [
    `./vendor/ffmpeg/ffmpeg/worker.js?v=${CORE_ASSET_VERSION}`,
    `./vendor/ffmpeg/core-mt-fast/ffmpeg-core.js?v=${CORE_ASSET_VERSION}`,
    `./vendor/ffmpeg/core-mt-fast/ffmpeg-core.wasm?v=${CORE_ASSET_VERSION}`,
    `./vendor/ffmpeg/core-mt-fast/ffmpeg-core.worker.js?v=${CORE_ASSET_VERSION}`,
    `./vendor/ffmpeg/core-st-large/ffmpeg-core.js?v=${CORE_ASSET_VERSION}`,
    `./vendor/ffmpeg/core-st-large/ffmpeg-core.wasm?v=${CORE_ASSET_VERSION}`,
    `./vendor/ffmpeg/core-st-lite/ffmpeg-core.js?v=${CORE_ASSET_VERSION}`,
    `./vendor/ffmpeg/core-st-lite/ffmpeg-core.wasm?v=${CORE_ASSET_VERSION}`,
];

const PRECACHE_PATHS = [...APP_SHELL_PATHS, ...RUNTIME_CACHE_PATHS];

let coepCredentialless = false;

if (typeof window === "undefined") {
    self.addEventListener("install", (event) => {
        event.waitUntil(
            caches.open(APP_CACHE)
                .then((cache) => cache.addAll(APP_SHELL_PATHS.map((path) => new URL(path, self.registration.scope).href)))
                .then(() => self.skipWaiting())
        );
    });

    self.addEventListener("activate", (event) => {
        event.waitUntil(
            caches.keys()
                .then((keys) => Promise.all(keys
                    .filter((key) => key.startsWith("media-minimizer-") && key !== APP_CACHE)
                    .map((key) => caches.delete(key))))
                .then(() => self.clients.claim())
                .then(() => {
                    warmRuntimeCache().catch((error) => console.error("Runtime cache warm failed:", error));
                })
        );
    });

    self.addEventListener("message", (event) => {
        if (!event.data) {
            return;
        }
        if (event.data.type === "deregister") {
            event.waitUntil(
                self.registration
                    .unregister()
                    .then(() => self.clients.matchAll())
                    .then((clients) => {
                        clients.forEach((client) => client.navigate(client.url));
                    })
            );
            return;
        }
        if (event.data.type === "coepCredentialless") {
            coepCredentialless = Boolean(event.data.value);
            return;
        }
        if (event.data.type === "warmRuntimeCache") {
            event.waitUntil(warmRuntimeCache());
        }
    });

    self.addEventListener("fetch", (event) => {
        const request = event.request;
        if (request.method !== "GET" || (request.cache === "only-if-cached" && request.mode !== "same-origin")) {
            return;
        }

        const url = new URL(request.url);
        if (url.origin !== self.location.origin) {
            return;
        }

        if (request.mode === "navigate") {
            event.respondWith(handleNavigation(request));
            return;
        }

        if (isCacheableAppAsset(url)) {
            event.respondWith(cacheFirst(request));
        }
    });
} else {
    (() => {
        const coi = {
            shouldRegister: () => true,
            shouldDeregister: () => false,
            coepCredentialless: () => !(window.chrome || window.netscape),
            doReload: () => window.location.reload(),
            quiet: false,
            ...window.coi,
        };

        const navigatorRef = navigator;

        if (navigatorRef.serviceWorker?.controller) {
            navigatorRef.serviceWorker.controller.postMessage({
                type: "coepCredentialless",
                value: coi.coepCredentialless(),
            });
            navigatorRef.serviceWorker.controller.postMessage({ type: "warmRuntimeCache" });

            if (coi.shouldDeregister()) {
                navigatorRef.serviceWorker.controller.postMessage({ type: "deregister" });
            }
        }

        if (!coi.shouldRegister()) {
            return;
        }

        if (!window.isSecureContext) {
            !coi.quiet && console.log("Media Minimizer service worker not registered: a secure context is required.");
            return;
        }

        if (!navigatorRef.serviceWorker) {
            return;
        }

        navigatorRef.serviceWorker.register(window.document.currentScript.src).then(
            (registration) => {
                !coi.quiet && console.log("Media Minimizer service worker registered", registration.scope);

                registration.addEventListener("updatefound", () => {
                    const installingWorker = registration.installing;
                    if (!installingWorker) {
                        return;
                    }
                    installingWorker.addEventListener("statechange", () => {
                        if (installingWorker.state === "installed" && (navigatorRef.serviceWorker.controller || window.crossOriginIsolated === false)) {
                            !coi.quiet && console.log("Reloading page to use Media Minimizer service worker.");
                            coi.doReload();
                        }
                    });
                });

                if (window.crossOriginIsolated === false && registration.active && !navigatorRef.serviceWorker.controller) {
                    !coi.quiet && console.log("Reloading page to use Media Minimizer service worker.");
                    coi.doReload();
                }
            },
            (error) => {
                !coi.quiet && console.error("Media Minimizer service worker failed to register:", error);
            }
        );
    })();
}

async function warmRuntimeCache() {
    const cache = await caches.open(APP_CACHE);
    await Promise.allSettled(RUNTIME_CACHE_PATHS.map(async (path) => {
        const url = new URL(path, self.registration.scope).href;
        const cached = await cache.match(url);
        if (cached) {
            return;
        }
        const response = await fetchWithIsolationHeaders(new Request(url));
        if (response.ok) {
            await cache.put(url, response);
        }
    }));
}

async function handleNavigation(request) {
    try {
        const response = await fetchWithIsolationHeaders(request);
        const cache = await caches.open(APP_CACHE);
        cache.put(new URL("./index.html", self.registration.scope).href, response.clone()).catch(() => {});
        return response;
    } catch (error) {
        const cached = await caches.match(new URL("./index.html", self.registration.scope).href);
        if (cached) {
            return addIsolationHeaders(cached);
        }
        return new Response("Media Minimizer is not available offline yet. Open it once while online to finish setup.", {
            status: 503,
            statusText: "Service Unavailable",
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
            },
        });
    }
}

async function cacheFirst(request) {
    const cached = await caches.match(request, { ignoreSearch: false });
    if (cached) {
        return addIsolationHeaders(cached);
    }

    const response = await fetchWithIsolationHeaders(request);
    if (response.ok) {
        const cache = await caches.open(APP_CACHE);
        cache.put(request, response.clone()).catch(() => {});
    }
    return response;
}

async function fetchWithIsolationHeaders(request) {
    const effectiveRequest = coepCredentialless && request.mode === "no-cors"
        ? new Request(request, { credentials: "omit" })
        : request;
    const response = await fetch(effectiveRequest);
    if (response.status === 0) {
        return response;
    }
    return addIsolationHeaders(response);
}

function addIsolationHeaders(response) {
    if (response.status === 0) {
        return response;
    }

    const headers = new Headers(response.headers);
    headers.set("Cross-Origin-Embedder-Policy", coepCredentialless ? "credentialless" : "require-corp");
    if (!coepCredentialless) {
        headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    }
    headers.set("Cross-Origin-Opener-Policy", "same-origin");

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

function isCacheableAppAsset(url) {
    if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) {
        return false;
    }

    const relativePath = `.${url.pathname.slice(new URL(self.registration.scope).pathname.length - 1)}`;
    if (PRECACHE_PATHS.some((path) => path.split("?")[0] === relativePath || path === `${relativePath}${url.search}`)) {
        return true;
    }

    return relativePath.startsWith("./vendor/ffmpeg/ffmpeg/")
        || relativePath.startsWith("./vendor/ffmpeg/util/")
        || relativePath.startsWith("./vendor/ffmpeg/core-mt-fast/")
        || relativePath.startsWith("./vendor/ffmpeg/core-st-large/")
        || relativePath.startsWith("./vendor/ffmpeg/core-st-lite/");
}
