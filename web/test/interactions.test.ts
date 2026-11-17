// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { SITE_JS } from "../src/render.js";

// The first-party site JS (SITE_JS) is a self-invoking function. We build the
// minimal markup it enhances, run it against a real DOM (happy-dom), and assert
// the slider + lightbox behaviour. Layout-dependent drag positions aren't
// checked (happy-dom has no layout), only the discrete interactions.
const runSiteJs = () => new Function(SITE_JS)();

const baCmp = `
  <ul class="ba"><li>
    <div class="ba-cmp" style="--pos:50%">
      <img class="ba-base" src="https://x/after.jpg" alt="After: Acme job 1">
      <div class="ba-reveal"><img src="https://x/before.jpg" alt="Before: Acme job 1"></div>
      <span class="ba-tag ba-tag-b">Before</span>
      <span class="ba-tag ba-tag-a">After</span>
      <div class="ba-divider" role="slider" tabindex="0" aria-valuenow="50"><span class="ba-handle">⇄</span></div>
    </div>
  </li></ul>`;
const gallery = `<ul class="gallery"><li><img src="https://x/g1.jpg" alt="Acme, photo 2"></li></ul>`;

beforeEach(() => {
  document.documentElement.className = "";
  document.body.innerHTML = baCmp + gallery;
});

describe("before/after slider", () => {
  it("arrow keys move the divider and update aria-valuenow", () => {
    runSiteJs();
    const div = document.querySelector(".ba-divider")!;
    const cmp = document.querySelector(".ba-cmp") as HTMLElement;
    div.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(cmp.style.getPropertyValue("--pos")).toBe("55%");
    expect(div.getAttribute("aria-valuenow")).toBe("55");
    div.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(cmp.style.getPropertyValue("--pos")).toBe("50%");
  });

  it("clicking the frame opens Before and After side by side", () => {
    runSiteJs();
    document.querySelector(".ba-cmp")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const pbox = document.querySelector(".pairbox") as HTMLElement;
    expect(pbox).toBeTruthy();
    expect(pbox.hidden).toBe(false);
    const figs = pbox.querySelectorAll(".pairfig");
    expect(figs.length).toBe(2);
    expect(figs[0]!.querySelector("figcaption")!.textContent).toBe("Before");
    expect(figs[1]!.querySelector("figcaption")!.textContent).toBe("After");
    expect(figs[0]!.querySelector("img")!.src).toContain("before.jpg");
    expect(figs[1]!.querySelector("img")!.src).toContain("after.jpg");
  });

  it("Escape closes the side-by-side view", () => {
    runSiteJs();
    document.querySelector(".ba-cmp")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const pbox = document.querySelector(".pairbox") as HTMLElement;
    expect(pbox.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(pbox.classList.contains("open")).toBe(false);
  });

  it("a click right after a drag does not open the lightbox", () => {
    runSiteJs();
    const div = document.querySelector(".ba-divider")!;
    div.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10 }));
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 40 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    document.querySelector(".ba-cmp")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const pbox = document.querySelector(".pairbox") as HTMLElement | null;
    expect(pbox === null || pbox.hidden).toBeTruthy();
  });
});

describe("gallery lightbox", () => {
  it("clicking a gallery photo opens the single-image lightbox", () => {
    runSiteJs();
    document.querySelector(".gallery img")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const box = document.querySelector(".lightbox:not(.pairbox)") as HTMLElement;
    expect(box).toBeTruthy();
    expect(box.hidden).toBe(false);
    expect(box.querySelector("img")!.src).toContain("g1.jpg");
  });
});
