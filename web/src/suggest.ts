// One-tap suggestions for the owner-facing builder/edit form. Each free-text
// field gets up to three "✨ Use: ..." chips; tapping one fills the field.
// Suggestions are templates over what the form already knows (business name,
// type, town) and are resolved both here (first render) and in the builder's
// inline script (live, as the owner types). No network, no AI, nothing stored:
// a chip only fills the box; the owner still edits and saves as usual.
// Facts only: suggestions restate what the owner typed (name, type, town) and
// make no claims (no "family-owned", years, prices or reviews).
// Never used on customer sites (render.ts).

import { CATEGORIES, HOURS_TEMPLATE, SERVICE_TEMPLATES, type CategoryKey } from "./site.js";
import { esc } from "./util.js";

/** `l`: chip label (defaults to the filled value); `v`: the value, with {name} {town} {noun} {word} tokens. */
export type SuggestTemplate = { l?: string; v: string };

/** The fields that get chips. Skipped: slug (has its own live suggestions), phone, email, street address. */
export const SUGGEST_FIELDS = ["businessName", "city", "serviceArea", "tagline", "offer", "services", "hours", "about"] as const;
export type SuggestField = (typeof SUGGEST_FIELDS)[number];

/** "a trusted ___ in Secaucus": what the business is, in a sentence. */
const NOUN: Record<CategoryKey, string> = {
  landscaping: "lawn care company",
  cleaning: "cleaning service",
  plumbing: "plumber",
  electrical: "electrician",
  hvac: "heating & cooling company",
  handyman: "handyman",
  salon: "hair & beauty salon",
  barber: "barbershop",
  spa: "spa",
  restaurant: "restaurant",
  bakery: "bakery",
  dentist: "dental practice",
  clinic: "medical clinic",
  fitness: "fitness studio",
  auto: "auto repair shop",
  carwash: "car wash",
  realestate: "real estate team",
  petcare: "pet care service",
  other: "local business",
};

/** "Secaucus ___": a plain business-name word. Empty = no name suggestion. */
const NAME_WORD: Record<CategoryKey, string> = {
  landscaping: "Lawn Care",
  cleaning: "Cleaning",
  plumbing: "Plumbing",
  electrical: "Electric",
  hvac: "Heating & Cooling",
  handyman: "Handyman",
  salon: "Salon",
  barber: "Barbershop",
  spa: "Spa",
  restaurant: "Kitchen",
  bakery: "Bakery",
  dentist: "Dental",
  clinic: "Family Clinic",
  fitness: "Fitness",
  auto: "Auto Repair",
  carwash: "Car Wash",
  realestate: "Realty",
  petcare: "Pet Care",
  other: "",
};

const TRADES = new Set<CategoryKey>(["landscaping", "cleaning", "plumbing", "electrical", "hvac", "handyman", "auto", "realestate", "petcare"]);
const VISITS = new Set<CategoryKey>(["salon", "barber", "spa", "dentist", "clinic", "fitness"]);

const week = (wk: string, sat: string, sun: string) =>
  ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((d) => `${d}: ${wk}`).concat([`Saturday: ${sat}`, `Sunday: ${sun}`]).join("\n");

function templatesFor(field: SuggestField, cat: CategoryKey | ""): SuggestTemplate[] {
  switch (field) {
    case "businessName":
      return cat && NAME_WORD[cat] ? [{ v: "{town} {word}" }] : [];
    case "city":
      // Only ever derived from the owner's own address / service area, never an example town.
      return [{ v: "{town}" }];
    case "serviceArea":
      return [{ v: "{town} and nearby towns" }, { v: "{town} and surrounding areas" }];
    case "tagline":
      return [
        { v: "Your trusted {noun} in {town}" },
        { v: "Proudly serving {town} and nearby" },
        { v: "Your local {noun}. Call today to book" },
      ];
    case "offer": {
      const first = !cat
        ? "Free estimates, call today"
        : TRADES.has(cat)
          ? "Free estimates, call today"
          : VISITS.has(cat)
            ? "15% off your first visit"
            : "10% off your first order";
      return [{ v: first }, { v: "10% off for first-time customers" }, { v: "Refer a friend and you both save 10%" }];
    }
    case "services": {
      const t = cat ? SERVICE_TEMPLATES[cat] : "";
      return t ? [{ l: `Common ${CATEGORIES[cat as CategoryKey].label.toLowerCase()} services`, v: t }] : [];
    }
    case "hours":
      return [
        { l: "Mon-Fri 9am-5pm, weekends closed", v: HOURS_TEMPLATE },
        { l: "Mon-Sat 8am-6pm, Sunday closed", v: week("8:00 am - 6:00 pm", "8:00 am - 6:00 pm", "Closed") },
        { l: "Every day 10am-8pm", v: week("10:00 am - 8:00 pm", "10:00 am - 8:00 pm", "10:00 am - 8:00 pm") },
      ];
    case "about":
      return [
        { v: "{name} is a {noun} serving {town} and nearby. Call us today, we'd be glad to help." },
        { v: "{name} is your local {noun} in {town}. Get in touch to find out how we can help." },
        { v: "{name} is a local business. Get in touch to find out how we can help." },
      ];
  }
}

/** Every field's templates for every category ("" = none chosen yet), for the inline script. */
export function suggestTable(): Record<string, Record<string, SuggestTemplate[]>> {
  const out: Record<string, Record<string, SuggestTemplate[]>> = {};
  for (const f of SUGGEST_FIELDS) {
    out[f] = { "": templatesFor(f, "") };
    for (const c of Object.keys(CATEGORIES) as CategoryKey[]) out[f]![c] = templatesFor(f, c);
  }
  return out;
}

export const SUGGEST_NOUNS = NOUN;
export const SUGGEST_NAME_WORDS = NAME_WORD;

export type SuggestContext = { businessName?: string; category?: string; city?: string; address?: string; serviceArea?: string };

/** The town: city before the comma, else from "street, town, ST zip", else the first area served. */
export function townOf(ctx: SuggestContext): string {
  const first = (s: string) => s.split(",")[0]!.trim();
  if (ctx.city?.trim()) return first(ctx.city);
  const parts = (ctx.address ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 2]!;
  if (ctx.serviceArea?.trim()) return first(ctx.serviceArea);
  return "";
}

/** Fill tokens; null when any token is empty (the chip is then left out). */
export function fillTemplate(t: string, tokens: Record<string, string>): string | null {
  let missing = false;
  const s = t.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const x = (tokens[k] ?? "").trim();
    if (!x) missing = true;
    return x;
  });
  return missing ? null : s;
}

export function suggestionsFor(field: SuggestField, ctx: SuggestContext): { label: string; value: string }[] {
  const cat = (ctx.category && ctx.category in CATEGORIES ? ctx.category : "") as CategoryKey | "";
  const tokens = {
    name: ctx.businessName ?? "",
    town: townOf(ctx),
    noun: cat ? NOUN[cat] : "",
    word: cat ? NAME_WORD[cat] : "",
  };
  const out: { label: string; value: string }[] = [];
  for (const t of templatesFor(field, cat)) {
    const value = fillTemplate(t.v, tokens);
    if (value === null || out.some((o) => o.value === value)) continue;
    out.push({ label: t.l ?? value, value });
    if (out.length === 3) break;
  }
  return out;
}

/** The chip row under a field. Always rendered (maybe empty) so the script can refill it live. */
export function suggestChips(field: SuggestField, ctx: SuggestContext): string {
  const chips = suggestionsFor(field, ctx)
    .map(
      (s) =>
        `<button type="button" class="suggest-chip" data-suggest="${esc(s.value).replace(/\n/g, "&#10;")}" data-target="${field}">✨ Use: ${esc(s.label)}</button>`,
    )
    .join("");
  return `<div class="suggest" data-suggest-for="${field}">${chips}</div>`;
}

/**
 * Client half (goes into the builder's nonce'd inline script): one delegated
 * click handler fills + focuses the field; name/type/town edits re-render the
 * chips with the same templates and the same rules as suggestionsFor above.
 */
export const SUGGEST_SCRIPT = `
(function(){
  var T=${JSON.stringify(suggestTable())}, NOUN=${JSON.stringify(NOUN)}, WORD=${JSON.stringify(NAME_WORD)};
  document.addEventListener('click',function(ev){
    var b=ev.target&&ev.target.closest?ev.target.closest('[data-suggest]'):null; if(!b) return;
    ev.preventDefault();
    var f=document.getElementById(b.getAttribute('data-target')); if(!f||f.readOnly) return;
    f.value=b.getAttribute('data-suggest');
    try{ f.dispatchEvent(new Event('input',{bubbles:true})); }catch(e){}
    f.focus();
    try{ var n=f.value.length; f.setSelectionRange(n,n); }catch(e){}
  });
  var val=function(id){ var el=document.getElementById(id); return el?el.value:''; };
  var first=function(s){ return s.split(',')[0].trim(); };
  var town=function(){
    if(val('city').trim()) return first(val('city'));
    var p=val('address').split(',').map(function(x){return x.trim();}).filter(Boolean);
    if(p.length>=3) return p[p.length-2];
    if(val('serviceArea').trim()) return first(val('serviceArea'));
    return '';
  };
  var render=function(){
    var cat=val('category'); if(!NOUN[cat]) cat='';
    var tok={name:val('businessName'),town:town(),noun:cat?NOUN[cat]:'',word:cat?WORD[cat]:''};
    [].slice.call(document.querySelectorAll('[data-suggest-for]')).forEach(function(box){
      var list=(T[box.getAttribute('data-suggest-for')]||{})[cat]||[], seen=[], out=[];
      list.forEach(function(t){
        if(out.length>=3) return;
        var miss=false, v=t.v.replace(/\\{(\\w+)\\}/g,function(_,k){ var x=(tok[k]||'').trim(); if(!x) miss=true; return x; });
        if(miss||seen.indexOf(v)>=0) return;
        seen.push(v); out.push({l:t.l||v,v:v});
      });
      box.textContent='';
      out.forEach(function(s){
        var b=document.createElement('button'); b.type='button'; b.className='suggest-chip';
        b.setAttribute('data-suggest',s.v); b.setAttribute('data-target',box.getAttribute('data-suggest-for'));
        b.textContent='✨ Use: '+s.l; box.appendChild(b);
      });
    });
  };
  ['businessName','category','city','address','serviceArea'].forEach(function(id){
    var el=document.getElementById(id); if(!el) return;
    el.addEventListener('input',render); el.addEventListener('change',render);
  });
})();`;
