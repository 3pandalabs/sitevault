// SiteVault Worker. One Worker, no server, no database:
//   KV  SITES   site:<slug> -> Site JSON; rl:<ip>:<day> -> create counter
//   R2  PHOTOS  sites/<slug>/<rand>.<ext>
//
// Routes
//   GET  /                         home
//   GET  /new                      builder
//   POST /api/sites                create (multipart). JSON reply when Accept: json
//   GET  /s/<slug>                 the customer's site (path form, works today)
//   GET  <slug>.<SITES_DOMAIN>/    the same site on the customer-site domain,
//                                  once that domain exists (SITES_DOMAIN unset = off)
//   GET  /edit/<slug>?k=<key>      builder, prefilled
//   POST /api/sites/<slug>         update (key in the form)
//   POST /api/sites/<slug>/delete  remove (key in the form)
//   GET  /p/<key>                  photo from R2
//   GET  /privacy, /terms
//   GET  /metrics                  ops envelope for admin.3pandalabs.com (METRICS_TOKEN)
//   GET  /api/admin/sites          list (ADMIN_TOKEN)
//   POST /api/admin/sites/<slug>/remove   takedown (ADMIN_TOKEN)
//   POST /api/internal/sites       one-click create from AdVault (INTERNAL_TOKEN)

import { renderSite, type RenderContext } from "./render.js";
import { builderPage, donePage, homePage, messagePage, privacyPage, termsPage } from "./pages.js";
import { MAX_PHOTO_BYTES, MAX_PHOTOS, PHOTO_TYPES, parseContent, type FieldErrors, type Site, type SiteContent } from "./site.js";
import { randomKey, safeEqual, sha256Hex, slugify } from "./util.js";

export interface Env {
  SITES: KVNamespace;
  PHOTOS: R2Bucket;
  /** Cloudflare Images binding: shrinks uploads to web size. Optional at runtime. */
  IMAGES?: ImagesBinding;
  /** https://sitevault.3pandalabs.com */
  PUBLIC_ORIGIN: string;
  /** Customer-site domain, e.g. "3panda.site". Unset until the domain is bought. */
  SITES_DOMAIN?: string;
  METRICS_TOKEN?: string;
  ADMIN_TOKEN?: string;
  /** Shared with advault-api (SITEVAULT_INTERNAL_TOKEN) for one-click sites. */
  INTERNAL_TOKEN?: string;
  /** Sites one network address may create per day. */
  DAILY_CREATE_LIMIT?: string;
}

const RESERVED = new Set(["www", "api", "admin", "app", "mail", "new", "edit", "help", "support", "s", "p"]);
const bootedAt = Date.now();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (err) {
      console.error("unhandled", err instanceof Error ? err.stack : err);
      return html(messagePage("Something went wrong", "Please try again in a minute.", "Error"), 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Customer-site domain: <slug>.<SITES_DOMAIN>/ serves that site only.
  if (env.SITES_DOMAIN && url.hostname.endsWith(`.${env.SITES_DOMAIN}`)) {
    const slug = url.hostname.slice(0, -(env.SITES_DOMAIN.length + 1));
    if (path !== "/" || method !== "GET") return Response.redirect(`https://${url.hostname}/`, 302);
    return serveSite(env, slug);
  }

  if (method === "GET") {
    if (path === "/") return html(homePage());
    if (path === "/new") return builder(env, { kind: "new" });
    if (path === "/privacy") return html(privacyPage());
    if (path === "/terms") return html(termsPage());
    if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /edit/\nDisallow: /api/\n", { headers: { "content-type": "text/plain" } });
    if (path === "/metrics") return metrics(request, env);
    if (path === "/api/admin/sites") return adminList(request, env);
    let m = path.match(/^\/s\/([a-z0-9-]+)\/?$/);
    if (m) return serveSite(env, m[1]!);
    m = path.match(/^\/edit\/([a-z0-9-]+)$/);
    if (m) return editPage(env, m[1]!, url.searchParams.get("k") ?? "");
    if (path.startsWith("/p/")) return photo(env, decodeURIComponent(path.slice(3)), request);
    m = path.match(/^\/done\/([A-Za-z0-9_-]+)$/);
    if (m) return done(env, m[1]!);
  }

  if (method === "POST") {
    if (path === "/api/sites") return createSite(request, env);
    if (path === "/api/internal/sites") return createInternal(request, env);
    let m = path.match(/^\/api\/sites\/([a-z0-9-]+)$/);
    if (m) return updateSite(request, env, m[1]!);
    m = path.match(/^\/api\/sites\/([a-z0-9-]+)\/delete$/);
    if (m) return deleteSite(request, env, m[1]!);
    m = path.match(/^\/api\/admin\/sites\/([a-z0-9-]+)\/remove$/);
    if (m) return adminRemove(request, env, m[1]!);
  }

  return html(messagePage("Page not found", "There's nothing at this address."), 404);
}

// ---------------------------------------------------------------------------
// Responses

function nonce(): string {
  return randomKey(16);
}

function html(body: string, status = 200, scriptNonce?: string): Response {
  const csp = [
    "default-src 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "style-src 'unsafe-inline'",
    scriptNonce ? `script-src 'nonce-${scriptNonce}'` : "script-src 'none'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "cache-control": "no-store",
    },
  });
}

function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

// ---------------------------------------------------------------------------
// Storage

const siteKey = (slug: string) => `site:${slug}`;

async function loadSite(env: Env, slug: string): Promise<Site | null> {
  return env.SITES.get<Site>(siteKey(slug), "json");
}

async function saveSite(env: Env, site: Site): Promise<void> {
  await env.SITES.put(siteKey(site.slug), JSON.stringify(site), {
    metadata: { status: site.status, source: site.source, createdAt: site.createdAt },
  });
}

async function uniqueSlug(env: Env, businessName: string, city: string): Promise<string> {
  const base = slugify(businessName, city.split(",")[0] ?? "") || "my-business";
  for (let i = 0; i < 20; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    if (!RESERVED.has(candidate) && !(await env.SITES.get(siteKey(candidate)))) return candidate;
  }
  return `${base}-${randomKey(4).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

function renderCtx(env: Env, slug: string): RenderContext {
  return {
    siteUrl: siteUrl(env, slug),
    assetOrigin: env.PUBLIC_ORIGIN,
    homeUrl: env.PUBLIC_ORIGIN,
  };
}

function siteUrl(env: Env, slug: string): string {
  return env.SITES_DOMAIN ? `https://${slug}.${env.SITES_DOMAIN}/` : `${env.PUBLIC_ORIGIN}/s/${slug}`;
}

// ---------------------------------------------------------------------------
// Pages

async function serveSite(env: Env, slug: string): Promise<Response> {
  const site = await loadSite(env, slug);
  if (!site || site.status !== "live") {
    return html(messagePage("This website isn't available", "It may have been removed by its owner."), 404);
  }
  const res = html(renderSite(site, renderCtx(env, slug)));
  // Short edge cache: edits show within a minute, traffic spikes from an ad
  // don't hit KV for every visitor.
  res.headers.set("cache-control", "public, max-age=60");
  return res;
}

/** The "your site is live" page after a script-driven create (10-minute handoff). */
async function done(env: Env, handoff: string): Promise<Response> {
  const data = await env.SITES.get<{ siteUrl: string; editUrl: string }>(`done:${handoff}`, "json");
  if (!data) return html(messagePage("This page has expired", "Open your website or your edit link directly.", "Expired"), 404);
  const n = nonce();
  const res = html(donePage({ ...data, nonce: n }), 200, n);
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}

function builder(_env: Env, mode: Parameters<typeof builderPage>[0], errors?: FieldErrors, values?: Record<string, string>, status = 200): Response {
  const n = nonce();
  return html(builderPage(mode, n, errors, values), status, n);
}

async function editPage(env: Env, slug: string, key: string): Promise<Response> {
  const site = await authorize(env, slug, key);
  if (!site) return html(messagePage("Edit link not valid", "Check you copied the whole link. Lost it? Email 3pandas@3pandalabs.com.", "Can't open"), 403);
  return builder(env, { kind: "edit", site, key, photoUrl: (k) => `${env.PUBLIC_ORIGIN}/p/${k}` });
}

async function authorize(env: Env, slug: string, key: string): Promise<Site | null> {
  if (!key) return null;
  const site = await loadSite(env, slug);
  if (!site || site.status !== "live") return null;
  return safeEqual(await sha256Hex(key), site.editKeyHash) ? site : null;
}

// Photos and the ad video. Byte ranges are supported because iPhone Safari
// will not play a <video> whose server ignores Range.
async function photo(env: Env, key: string, request: Request): Promise<Response> {
  if (!/^sites\/[a-z0-9-]+\/[A-Za-z0-9_-]+\.(jpg|png|webp|mp4)$/.test(key)) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    // Keys are random and never reused, so they can be cached forever.
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  });
  const range = parseRange(request.headers.get("range"));
  if (range) {
    const obj = await env.PHOTOS.get(key, { range });
    if (!obj || !("body" in obj)) return new Response("Not found", { status: 404 });
    const start = "offset" in range ? range.offset : Math.max(0, obj.size - range.suffix);
    const end = "length" in range && range.length !== undefined ? Math.min(obj.size, start + range.length) - 1 : obj.size - 1;
    headers.set("content-type", obj.httpMetadata?.contentType ?? "application/octet-stream");
    headers.set("content-range", `bytes ${start}-${end}/${obj.size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  headers.set("content-type", obj.httpMetadata?.contentType ?? "image/jpeg");
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}

/** "bytes=0-" / "bytes=100-199" / "bytes=-500" -> an R2 range, else null. */
function parseRange(h: string | null): { offset: number; length?: number } | { suffix: number } | null {
  const m = h?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1]) return { suffix: Number(m[2]) };
  const offset = Number(m[1]);
  return m[2] ? { offset, length: Number(m[2]) - offset + 1 } : { offset };
}

// ---------------------------------------------------------------------------
// Create / update / delete

type Parsed = { fields: Record<string, string>; files: File[]; keep: string[]; video: File | null };

async function readForm(request: Request): Promise<Parsed | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("multipart/form-data") && !type.includes("application/x-www-form-urlencoded")) return null;
  const form = await request.formData();
  const fields: Record<string, string> = {};
  const files: File[] = [];
  const keep: string[] = [];
  let video: File | null = null;
  for (const [k, v] of form as unknown as Iterable<[string, string | File]>) {
    if (typeof v === "string") {
      if (k === "keep") keep.push(v);
      else fields[k] = v;
    } else if (k === "photos" && v.size > 0) {
      files.push(v);
    } else if (k === "video" && v.size > 0) {
      video = v;
    }
  }
  return { fields, files, keep, video };
}

function checkPhotos(files: File[], existing: number, maxBytes = MAX_PHOTO_BYTES): string | null {
  if (existing + files.length > MAX_PHOTOS) return `Up to ${MAX_PHOTOS} photos in total.`;
  for (const f of files) {
    if (!PHOTO_TYPES.includes(f.type)) return "Photos must be JPG, PNG or WebP.";
    if (f.size > maxBytes) return `Each photo must be under ${Math.round(maxBytes / 1024 / 1024)} MB.`;
  }
  return null;
}

/** Store a validated site and mint its edit key. Shared by both create paths. */
async function insertSite(env: Env, content: SiteContent, files: File[], source: Site["source"], videoFile: File | null = null) {
  const slug = await uniqueSlug(env, content.businessName, content.city);
  const key = randomKey();
  const now = new Date().toISOString();
  const site: Site = {
    ...content,
    slug,
    photos: await storePhotos(env, slug, files),
    video: await storeVideo(env, slug, videoFile),
    status: "live",
    source,
    editKeyHash: await sha256Hex(key),
    createdAt: now,
    updatedAt: now,
  };
  await saveSite(env, site);
  console.log("site_created", { slug, source, photos: site.photos.length, category: site.category });
  return { slug, siteUrl: siteUrl(env, slug), editUrl: `${env.PUBLIC_ORIGIN}/edit/${slug}?k=${encodeURIComponent(key)}` };
}

// One-click from AdVault. Server to server, bearer INTERNAL_TOKEN. The
// advertiser attested ownership inside AdVault, so no attest field; no per-IP
// limit (every call comes from the AdVault box). Photos are AdVault's own
// polished ad photos, which can be larger than a phone-shrunk upload.
async function createInternal(request: Request, env: Env): Promise<Response> {
  const auth = bearer(request, env.INTERNAL_TOKEN);
  if (auth !== "ok") return json({ ok: false, error: auth === "off" ? "internal_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  const form = await readForm(request);
  if (!form) return json({ ok: false, error: "bad_request" }, 400);
  const parsed = parseContent(form.fields);
  const errors: FieldErrors = parsed.ok ? {} : { ...parsed.errors };
  const photoErr = checkPhotos(form.files, 0, 8 * 1024 * 1024);
  if (photoErr) errors.photos = photoErr;
  // Only the internal path takes a video (AdVault's finished ad); the public
  // form doesn't, so a stranger can't host arbitrary video on our domain.
  if (form.video && (form.video.type !== "video/mp4" || form.video.size > MAX_VIDEO_BYTES)) {
    errors.video = "Video must be an MP4 under 40 MB.";
  }
  if (!parsed.ok || Object.keys(errors).length > 0) return json({ ok: false, error: "invalid", errors }, 400);
  return json({ ok: true, ...(await insertSite(env, parsed.value, form.files, "advault", form.video)) }, 201);
}

// Web size: at most 1600 px on the long side, JPEG q82 (~150-300 KB). A
// phone photo or AdVault's polished ad photo is 1 MB+, and a page of them is
// slow on a phone. If the Images binding is missing or fails, the original is
// stored rather than losing the photo.
async function webSize(env: Env, f: File): Promise<{ bytes: ArrayBuffer; type: string }> {
  if (env.IMAGES) {
    try {
      const out = await env.IMAGES.input(f.stream())
        .transform({ width: 1600, height: 1600, fit: "scale-down" })
        .output({ format: "image/jpeg", quality: 82 });
      const bytes = await out.response().arrayBuffer();
      if (bytes.byteLength > 0 && bytes.byteLength < f.size) return { bytes, type: "image/jpeg" };
    } catch (err) {
      console.warn("image resize failed, storing original", String(err));
    }
  }
  return { bytes: await f.arrayBuffer(), type: f.type };
}

async function storePhotos(env: Env, slug: string, files: File[]): Promise<string[]> {
  const keys: string[] = [];
  for (const f of files) {
    const { bytes, type } = await webSize(env, f);
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    const key = `sites/${slug}/${randomKey(9)}.${ext}`;
    await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });
    keys.push(key);
  }
  return keys;
}

const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

async function storeVideo(env: Env, slug: string, file: File | null): Promise<string | null> {
  if (!file) return null;
  const key = `sites/${slug}/${randomKey(9)}.mp4`;
  await env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: "video/mp4" } });
  return key;
}

async function deletePhotos(env: Env, keys: string[]): Promise<void> {
  if (keys.length) await env.PHOTOS.delete(keys);
}

/** Error reply: JSON for the script, a re-rendered form otherwise. */
function rejected(request: Request, env: Env, mode: Parameters<typeof builderPage>[0], errors: FieldErrors, fields: Record<string, string>, status = 400): Response {
  return wantsJson(request) ? json({ ok: false, errors }, status) : builder(env, mode, errors, fields, status);
}

async function rateLimited(request: Request, env: Env): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${await sha256Hex(`${ip}:${day}`)}`;
  const count = Number((await env.SITES.get(key)) ?? "0");
  const limit = Number(env.DAILY_CREATE_LIMIT ?? "5");
  if (count >= limit) return true;
  await env.SITES.put(key, String(count + 1), { expirationTtl: 60 * 60 * 26 });
  return false;
}

async function createSite(request: Request, env: Env): Promise<Response> {
  const form = await readForm(request);
  const mode = { kind: "new" } as const;
  if (!form) return rejected(request, env, mode, { form: "Please use the form." }, {});
  const { fields, files } = form;

  const parsed = parseContent(fields);
  const errors: FieldErrors = parsed.ok ? {} : { ...parsed.errors };
  if (fields.attest !== "yes") errors.attest = "Please confirm this.";
  const photoErr = checkPhotos(files, 0);
  if (photoErr) errors.photos = photoErr;
  if (Object.keys(errors).length > 0 || !parsed.ok) return rejected(request, env, mode, errors, fields);

  if (await rateLimited(request, env)) {
    return rejected(request, env, mode, { form: "Too many websites created from this connection today. Try again tomorrow." }, fields, 429);
  }

  const { slug, editUrl } = await insertSite(env, parsed.value, files, "web");
  const n = nonce();
  const page = donePage({ siteUrl: siteUrl(env, slug), editUrl, nonce: n });
  // The done page carries the only copy of the edit key: render it straight
  // into this response rather than redirecting with the key in a URL that
  // ends up in history. The script path gets the same page via a one-time
  // KV handoff that expires in 10 minutes.
  if (wantsJson(request)) {
    const handoff = randomKey(18);
    await env.SITES.put(`done:${handoff}`, JSON.stringify({ siteUrl: siteUrl(env, slug), editUrl }), { expirationTtl: 600 });
    return json({ ok: true, next: `/done/${handoff}` });
  }
  return html(page, 201, n);
}

async function updateSite(request: Request, env: Env, slug: string): Promise<Response> {
  const form = await readForm(request);
  if (!form) return json({ ok: false, errors: { form: "Please use the form." } }, 400);
  const site = await authorize(env, slug, form.fields.key ?? "");
  if (!site) {
    return wantsJson(request)
      ? json({ ok: false, errors: { form: "Your edit link isn't valid any more. Reload it and try again." } }, 403)
      : html(messagePage("Edit link not valid", "Reload your edit link and try again.", "Can't save"), 403);
  }
  const mode = { kind: "edit", site, key: form.fields.key!, photoUrl: (k: string) => `${env.PUBLIC_ORIGIN}/p/${k}` } as const;

  const parsed = parseContent(form.fields);
  const errors: FieldErrors = parsed.ok ? {} : { ...parsed.errors };
  const kept = site.photos.filter((k) => form.keep.includes(k));
  const photoErr = checkPhotos(form.files, kept.length);
  if (photoErr) errors.photos = photoErr;
  if (Object.keys(errors).length > 0 || !parsed.ok) return rejected(request, env, mode, errors, form.fields);

  const removed = site.photos.filter((k) => !kept.includes(k));
  const dropVideo = Boolean(site.video) && form.fields.keepVideo !== "yes";
  if (dropVideo && site.video) removed.push(site.video);
  const added = await storePhotos(env, slug, form.files);
  const next: Site = {
    ...site,
    ...parsed.value,
    photos: [...kept, ...added],
    video: dropVideo ? null : (site.video ?? null),
    updatedAt: new Date().toISOString(),
  };
  await saveSite(env, next);
  await deletePhotos(env, removed);

  const target = siteUrl(env, slug);
  return wantsJson(request) ? json({ ok: true, next: target }) : Response.redirect(target, 303);
}

async function deleteSite(request: Request, env: Env, slug: string): Promise<Response> {
  const form = await readForm(request);
  const site = form ? await authorize(env, slug, form.fields.key ?? "") : null;
  if (!site) return html(messagePage("Edit link not valid", "Reload your edit link and try again.", "Can't remove"), 403);
  await removeSite(env, site);
  return html(messagePage("Your website has been removed", "It's offline and its photos are deleted.", "Removed"));
}

async function removeSite(env: Env, site: Site): Promise<void> {
  // Keep the record (status removed) so the slug isn't handed to someone else
  // and an abuse report can still be traced; the content is the photos.
  await deletePhotos(env, site.video ? [...site.photos, site.video] : site.photos);
  await saveSite(env, { ...site, photos: [], video: null, status: "removed", updatedAt: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Ops

function bearer(request: Request, expected: string | undefined): "ok" | "off" | "no" {
  if (!expected) return "off";
  const presented = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return safeEqual(presented, expected) ? "ok" : "no";
}

async function listSites(env: Env): Promise<{ name: string; metadata?: unknown }[]> {
  const out: { name: string; metadata?: unknown }[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.SITES.list({ prefix: "site:", cursor });
    out.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

async function metrics(request: Request, env: Env): Promise<Response> {
  const auth = bearer(request, env.METRICS_TOKEN);
  if (auth === "off") return json({ error: "metrics_disabled" }, 503);
  if (auth === "no") return json({ error: "unauthorized" }, 401);
  const keys = await listSites(env);
  const meta = keys.map((k) => (k.metadata ?? {}) as { status?: string; source?: string });
  // Shared envelope across 3PandaLabs apps (see mealmargin's /metrics). No
  // database and no long-lived process, so those parts are null.
  return json({
    app: "sitevault",
    collectedAt: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - bootedAt) / 1000),
    counts: {
      sites: keys.length,
      sitesLive: meta.filter((m) => m.status === "live").length,
      sitesFromAdvault: meta.filter((m) => m.source === "advault").length,
    },
    traffic: null,
    process: null,
    database: null,
  });
}

async function adminList(request: Request, env: Env): Promise<Response> {
  const auth = bearer(request, env.ADMIN_TOKEN);
  if (auth !== "ok") return json({ error: auth === "off" ? "admin_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  const keys = await listSites(env);
  return json({ sites: keys.map((k) => ({ slug: k.name.slice(5), ...(k.metadata as object), url: siteUrl(env, k.name.slice(5)) })) });
}

async function adminRemove(request: Request, env: Env, slug: string): Promise<Response> {
  const auth = bearer(request, env.ADMIN_TOKEN);
  if (auth !== "ok") return json({ error: auth === "off" ? "admin_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  const site = await loadSite(env, slug);
  if (!site) return json({ error: "not_found" }, 404);
  await removeSite(env, site);
  console.log("site_removed_by_admin", { slug });
  return json({ ok: true });
}
