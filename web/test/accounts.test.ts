import { describe, expect, it } from "vitest";
import { emailProblem, hashPassword, normaliseEmail, passwordProblem, sameOrigin, sessionCookie, sessionToken, verifyPassword } from "../src/accounts.js";
import { accountPage, authPage, privacyPage } from "../src/pages.js";

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
    expect(page).toContain('href="/edit/bellas#edit"');
    expect(page).toContain("Sign out");
  });

  it("shows a review-pending bell on the website card only when reviews await approval", () => {
    const none = accountPage("o@x.test", [{ slug: "b", name: "B", siteUrl: "https://b.3pandasite.com/", state: "live", pendingReviews: 0 }]);
    expect(none).not.toContain("pending approval");
    const some = accountPage("o@x.test", [{ slug: "b", name: "B", siteUrl: "https://b.3pandasite.com/", state: "live", pendingReviews: 2 }]);
    expect(some).toContain('title="2 reviews pending approval"');
    expect(some).toContain('href="/edit/b#reviews"');
  });
});

import { homePage } from "../src/pages.js";

describe("one website per account", () => {
  it("home hero: a signed-in owner is sent to their site; a visitor is sent to sign in", () => {
    const owner = homePage(true, null, true, true);
    expect(owner).toContain("Go to my website");
    const visitor = homePage(true, null, false, false);
    expect(visitor).toContain("Sign in to get started");
    expect(visitor).not.toContain('href="/new"'); // no Build before signing in
  });
  it("My website hides the add-a-site form once the account has one", () => {
    const one = accountPage("o@x.test", [{ slug: "b", name: "B", siteUrl: "https://b.3pandasite.com/", state: "live" }]);
    expect(one).toContain("One website per account");
    expect(one).not.toContain("/account/claim");
    expect(accountPage("o@x.test", [])).toContain("/account/claim");
  });
  it("an admin can build more than one website", () => {
    const admin = accountPage("a@x.test", [{ slug: "b", name: "B", siteUrl: "https://b.3pandasite.com/", state: "live" }], { admin: true });
    expect(admin).toContain("Build another website");
    expect(admin).not.toContain("One website per account");
    expect(admin).toContain('href="/new"');
  });
});

describe("sign out in the header", () => {
  it("shows only when signed in", () => {
    expect(homePage(true, null, true, true)).toContain('action="/logout"');
    expect(homePage(true, null, false, false)).not.toContain('action="/logout"');
  });
});

describe("account deletion (Play: in-app + public URL)", () => {
  it("My website links to AdVault's Delete account through the one-tap sign-in", () => {
    const page = accountPage("o@x.test", [{ slug: "b", name: "B", siteUrl: "https://b.3pandasite.com/", state: "live" }]);
    expect(page).toContain("Delete my account");
    expect(page).toContain('href="/go/advault?to=%2Fdashboard%2Fsettings%23delete-account"');
    expect(page).toContain("/privacy#delete-account");
    expect(page).toContain("sitevault@3pandalabs.com");
    expect(accountPage("o@x.test", [])).toContain("Delete my account");
  });
  it("the privacy page has a public #delete-account section", () => {
    const page = privacyPage();
    expect(page).toContain('id="delete-account"');
    expect(page).toContain("Settings, Delete account");
    expect(page).toContain("Your website is removed separately");
  });
});
