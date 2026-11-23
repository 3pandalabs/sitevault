// Makes the SiteVault main site an installable PWA: a web manifest, app icons,
// and a minimal service worker. The SW exists so the app is installable and has
// an offline fallback, but it NEVER caches dynamic or signed-in pages — it only
// shows a tiny offline page when a navigation fails with no network. Customer
// sites (the businesses' own) are not PWAs; this is the SiteVault app itself.

import { ICON_180_PNG, ICON_192_PNG, ICON_512_PNG, ICON_MASKABLE_PNG } from "./pwa-icons.js";

export const PWA_MANIFEST = {
  name: "SiteVault",
  short_name: "SiteVault",
  description: "Build and edit a website for your local business in about five minutes.",
  start_url: "/?source=pwa",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  lang: "en",
  dir: "ltr",
  background_color: "#09090b",
  theme_color: "#09090b",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

/** base64 PNG by request path. */
export const PWA_ICONS: Record<string, string> = {
  "/icon-192.png": ICON_192_PNG,
  "/icon-512.png": ICON_512_PNG,
  "/icon-maskable.png": ICON_MASKABLE_PNG,
  // iOS home-screen icon (<link rel="apple-touch-icon">), 180x180.
  "/apple-touch-icon.png": ICON_180_PNG,
};

export function pngBytes(base64: string): ArrayBuffer {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// Conservative SW: network-first for navigations with an offline fallback; it
// does not cache responses, so signed-in / edited pages are never served stale.
export const SERVICE_WORKER = `
var OFFLINE='<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>SiteVault \\u2014 offline</title><style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#09090b;color:#f4f4f5;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px;line-height:1.5}a{color:#38bdf8}</style><h1>You\\u2019re offline</h1><p>Reconnect to the internet and try again.</p>';
self.addEventListener('install',function(e){self.skipWaiting();});
self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim());});
self.addEventListener('fetch',function(e){
  var r=e.request;
  if(r.mode==='navigate'){
    e.respondWith(fetch(r).catch(function(){return new Response(OFFLINE,{headers:{'content-type':'text/html; charset=utf-8'}});}));
  }
});
`;

/** The inline snippet (nonce'd) that registers the service worker. */
export const SW_REGISTER = `if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})});}`;

/**
 * Digital Asset Links for the Android TWA (android/, package
 * com.threepandalabs.sitevault), served at /.well-known/assetlinks.json.
 * Chrome checks it before opening the site full screen; without a matching
 * fingerprint the app shows a URL bar and Play rejects it as a webview wrapper.
 *
 * Once the app exists in Play Console, add EVERY fingerprint Play lists under
 * Test and release -> Setup -> App signing ("Copy all certificate
 * fingerprints"): the classical App Signing key, the "Quantum-ready (beta)"
 * key and any further signing certificate. AdVault showed an address bar on a
 * newer phone until all of them were listed (2026-11-22). Deploy the Worker
 * before promoting a release. See infra/play-store/README.md.
 */
export const ASSET_LINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.threepandalabs.sitevault",
      sha256_cert_fingerprints: [
        // upload key (C:\Users\Anil\Documents\keys\sitevault-upload.jks, alias "upload", 2026-11-22):
        // signs the uploaded AAB and any locally built APK.
        "FF:63:A0:89:BD:68:BE:24:CD:75:17:C0:84:7A:5C:28:2B:26:31:19:B3:D0:CF:3E:D9:72:F0:26:C4:AC:03:3F",
        // Play App Signing (app 4975632034778278927), every SHA-256 Play lists: classical, quantum-ready, extra cert.
        "42:46:0B:C9:07:56:10:C1:E4:82:33:EC:84:70:A0:4E:AC:72:F6:51:23:44:0B:4A:8B:3C:17:28:FE:57:DC:F9",
        "B6:F7:A3:82:AD:5B:2E:A3:51:F2:BF:15:BF:72:75:F0:0C:51:AC:7D:8C:68:95:1D:D8:BE:6A:89:89:1B:ED:3A",
        "61:20:31:D0:CC:40:16:4C:7D:78:76:4C:72:F7:3B:58:CB:83:40:F5:30:69:E7:30:BD:82:3B:59:57:87:8F:94",
      ],
    },
  },
];
