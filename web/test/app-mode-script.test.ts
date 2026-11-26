// @vitest-environment happy-dom
// APP_MODE_SCRIPT (src/app.ts): a TWA shares Chrome's cookie jar, so the
// sv_app cookie can reach a normal Chrome tab. The script keeps app mode per
// tab (sessionStorage) and clears a leaked cookie outside the app.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_MODE_SCRIPT } from "../src/app.js";

function run(opts: { search?: string; referrer?: string; flag?: boolean }) {
  sessionStorage.clear();
  if (opts.flag) sessionStorage.setItem("sv_app", "1");
  window.history.replaceState(null, "", `/edit/x${opts.search ?? ""}`);
  Object.defineProperty(document, "referrer", { value: opts.referrer ?? "", configurable: true });
  const replace = vi.fn();
  const cookies: string[] = [];
  Object.defineProperty(document, "cookie", { set: (v: string) => cookies.push(v), get: () => "", configurable: true });
  const loc = window.location;
  Object.defineProperty(window, "location", { value: { search: loc.search, href: loc.href, replace }, configurable: true });
  new Function(APP_MODE_SCRIPT)();
  Object.defineProperty(window, "location", { value: loc, configurable: true });
  return { replace, cookies };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("APP_MODE_SCRIPT", () => {
  it("in the app (?source=twa, app referrer, or this tab's flag): remembers it, keeps the cookie, no reload", () => {
    for (const o of [{ search: "?source=twa" }, { referrer: "android-app://com.threepandalabs.sitevault/" }, { flag: true }]) {
      const r = run(o);
      expect(r.replace).not.toHaveBeenCalled();
      expect(r.cookies.some((c) => c.startsWith("sv_app=1"))).toBe(true);
      expect(sessionStorage.getItem("sv_app")).toBe("1");
    }
  });
  it("a normal browser tab that got the shared cookie: clears it and reloads once", () => {
    const r = run({});
    expect(r.cookies.some((c) => c.startsWith("sv_app=;") && c.includes("Max-Age=0"))).toBe(true);
    expect(r.replace).toHaveBeenCalledTimes(1);
  });
});
