import { describe, expect, it } from "vitest";
import { emailProblem, hashPassword, normaliseEmail, passwordProblem, sameOrigin, sessionCookie, sessionToken, verifyPassword } from "../src/accounts.js";
import { accountPage, authPage } from "../src/pages.js";

describe("accounts", () => {
  it("validates email and password", () => {
    expect(normaliseEmail("  Bella@Example.COM ")).toBe("bella@example.com");
    expect(emailProblem("bella@example.com")).toBeNull();
    expect(emailProblem("bella")).not.toBeNull();
    expect(emailProblem("")).not.toBeNull();
    expect(passwordProblem("short")).not.toBeNull();
    expect(passwordProblem("long enough")).toBeNull();
  });
  it("hashes passwords and verifies only the right one", async () => {
    const pw = await hashPassword("correct horse", 1000);
    expect(pw.hash).not.toContain("correct");
    expect(await verifyPassword("correct horse", pw)).toBe(true);
    expect(await verifyPassword("wrong horse", pw)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
    expect((await hashPassword("correct horse", 1000)).hash).not.toBe(pw.hash); // salted
  });
  it("reads only a well-formed session cookie", () => {
    const t = "A".repeat(40);
    expect(sessionToken(`x=1; sv_session=${t}; y=2`)).toBe(t);
    expect(sessionToken("sv_session=<script>")).toBeNull();
    expect(sessionToken(null)).toBeNull();
    const c = sessionCookie(t);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) expect(c).toContain(flag);
  });
  it("requires an Origin header from our own site for session POSTs", () => {
    const req = (o?: string) => new Request("https://sv.test/x", { method: "POST", headers: o ? { origin: o } : {} });
    expect(sameOrigin(req("https://sv.test"), "https://sv.test")).toBe(true);
    expect(sameOrigin(req("https://evil.test"), "https://sv.test")).toBe(false);
    expect(sameOrigin(req(), "https://sv.test")).toBe(false);
  });
  it("renders sign-in and My websites safely", () => {
    const login = authPage("login", { email: "<b>x</b>", next: "javascript:alert(1)" });
    expect(login).not.toContain("<b>x</b>");
    expect(login).toContain('value="/account"');
    const page = accountPage("o@x.test", [{ slug: "bellas", name: "Bella's <Salon>", siteUrl: "https://bellas.3pandasite.com/", state: "live" }]);
    expect(page).toContain("Bella&#39;s &lt;Salon&gt;");
    expect(page).toContain('href="/edit/bellas"');
    expect(page).toContain("Sign out");
  });
});
