// Owner stats charts (edit page "Stats" tab, 2026-11-20). Inline SVG built on
// the server: no chart library, no CDN, nothing for the CSP to allow. Every
// breakdown ships ALL its views in the HTML (Bars | Pie | Table, or for visits
// by day Line | Bars | Table); a tiny nonce'd script (STATS_VIEW_SCRIPT in
// pages.ts) only switches which one shows. Without JS the default view shows.
// Never rendered on a customer site.
import { esc } from "./util.js";

export type Row = { label: string; n: number };

/**
 * Categorical slots for the dark chrome (dataviz reference palette, dark
 * column, validated in fixed order), never cycled: past PIE_MAX slices the
 * rest folds into "Other" (neutral grey, not a series hue).
 */
export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c"] as const;
export const OTHER_COLOR = "#71717a";
/** At most this many named slices; anything past it is "Other". */
export const PIE_MAX = SERIES.length;
const SURFACE = "#09090b";

/** Top PIE_MAX rows by count, the rest summed as "Other" (only when there is a rest). */
export function bucket(rows: Row[], max = PIE_MAX): Row[] {
  const sorted = [...rows].filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  if (sorted.length <= max) return sorted;
  const top = sorted.slice(0, max);
  const rest = sorted.slice(max).reduce((s, r) => s + r.n, 0);
  return [...top, { label: "Other", n: rest }];
}

const pct = (n: number, total: number) => (total ? (n / total) * 100 : 0);
const pctLabel = (p: number) => `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1).replace(/\.0$/, "")}%`;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Pie with a legend (names + percentages). role=img + an aria-label summary; the Table view is the full data. */
export function pieSvg(caption: string, rows: Row[]): string {
  const slices = bucket(rows);
  const total = slices.reduce((s, r) => s + r.n, 0);
  if (!total) return `<p class="hint">No visits yet.</p>`;
  const cx = 80, cy = 80, rad = 76;
  const color = (i: number, r: Row) => (r.label === "Other" && i === slices.length - 1 && slices.length > PIE_MAX ? OTHER_COLOR : SERIES[i % SERIES.length]!);
  let start = -90;
  const parts = slices.map((r, i) => {
    const deg = (r.n / total) * 360;
    const p = pct(r.n, total);
    const title = `<title>${esc(r.label)}: ${r.n} (${pctLabel(p)})</title>`;
    const data = ` data-deg="${r2(deg)}" data-pct="${r2(p)}" fill="${color(i, r)}" stroke="${SURFACE}" stroke-width="2"`;
    let shape: string;
    if (slices.length === 1) {
      shape = `<circle class="slice" cx="${cx}" cy="${cy}" r="${rad}"${data}>${title}</circle>`;
    } else {
      const a0 = (start * Math.PI) / 180, a1 = ((start + deg) * Math.PI) / 180;
      const x0 = r2(cx + rad * Math.cos(a0)), y0 = r2(cy + rad * Math.sin(a0));
      const x1 = r2(cx + rad * Math.cos(a1)), y1 = r2(cy + rad * Math.sin(a1));
      shape = `<path class="slice" d="M${cx} ${cy}L${x0} ${y0}A${rad} ${rad} 0 ${deg > 180 ? 1 : 0} 1 ${x1} ${y1}Z"${data}>${title}</path>`;
    }
    start += deg;
    return shape;
  });
  const summary = `${caption}: ${slices.map((r) => `${r.label} ${pctLabel(pct(r.n, total))}`).join(", ")}.`;
  const legend = slices
    .map((r, i) => `<li><span class="sw" style="background:${color(i, r)}" aria-hidden="true"></span>${esc(r.label)} <span class="pv">${pctLabel(pct(r.n, total))}</span></li>`)
    .join("");
  return `<figure class="chart pie"><svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="${esc(summary)}">${parts.join("")}</svg><ul class="legend" aria-hidden="true">${legend}</ul></figure>`;
}

/** Horizontal bars (HTML, the look the stats already had). Text stays in text colours. */
export function barsHtml(caption: string, head: string, rows: Row[]): string {
  if (!rows.length) return `<p class="hint">No visits yet.</p>`;
  const max = Math.max(...rows.map((r) => r.n), 1);
  return `<table class="bars"><caption class="sr">${esc(caption)}</caption><thead><tr><th scope="col">${esc(head)}</th><th scope="col"><span class="hint">Share</span></th><th scope="col" class="n">Visits</th></tr></thead><tbody>${rows
    .map((r) => `<tr><th scope="row">${esc(r.label)}</th><td aria-hidden="true"><span class="bar" style="width:${Math.round((r.n / max) * 100)}%"></span></td><td class="n">${r.n}</td></tr>`)
    .join("")}</tbody></table>`;
}

/** Plain numbers: name, visits, share. Always present, so no reader depends on a chart. */
export function dataTable(caption: string, head: string, rows: Row[]): string {
  if (!rows.length) return `<p class="hint">No visits yet.</p>`;
  const total = rows.reduce((s, r) => s + r.n, 0);
  return `<table class="bars data"><caption class="sr">${esc(caption)}</caption><thead><tr><th scope="col">${esc(head)}</th><th scope="col" class="n">Visits</th><th scope="col" class="n">Share</th></tr></thead><tbody>${rows
    .map((r) => `<tr><th scope="row">${esc(r.label)}</th><td class="n">${r.n}</td><td class="n">${pctLabel(pct(r.n, total))}</td></tr>`)
    .join("")}</tbody></table>`;
}

const W = 320, H = 140, PADL = 28, PADB = 18, PADT = 8;

function axis(max: number): string {
  const y = (v: number) => r2(PADT + (H - PADT - PADB) * (1 - v / max));
  return `<line x1="${PADL}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="rgba(255,255,255,.25)"/><line x1="${PADL}" x2="${W}" y1="${y(max)}" y2="${y(max)}" stroke="rgba(255,255,255,.08)"/><text x="${PADL - 4}" y="${y(max) + 4}" text-anchor="end" fill="#a1a1aa" font-size="10">${max}</text><text x="${PADL - 4}" y="${y(0) + 4}" text-anchor="end" fill="#a1a1aa" font-size="10">0</text>`;
}

function ends(rows: Row[]): string {
  if (!rows.length) return "";
  const last = rows[rows.length - 1]!;
  return `<text x="${PADL}" y="${H - 4}" fill="#a1a1aa" font-size="10">${esc(rows[0]!.label)}</text>${rows.length > 1 ? `<text x="${W}" y="${H - 4}" text-anchor="end" fill="#a1a1aa" font-size="10">${esc(last.label)}</text>` : ""}`;
}

/** Visits by day as a 2px line (one series: the caption names it, no legend). */
export function lineSvg(caption: string, rows: Row[]): string {
  if (!rows.length) return `<p class="hint">No visits yet.</p>`;
  const max = Math.max(...rows.map((r) => r.n), 1);
  const step = rows.length > 1 ? (W - PADL - 6) / (rows.length - 1) : 0;
  const pt = (r: Row, i: number) => `${r2(PADL + 3 + i * step)},${r2(PADT + (H - PADT - PADB) * (1 - r.n / max))}`;
  const pts = rows.map(pt);
  const dots = rows
    .map((r, i) => {
      const [x, y] = pts[i]!.split(",");
      return `<circle cx="${x}" cy="${y}" r="4" fill="${SERIES[0]}" stroke="${SURFACE}" stroke-width="2"><title>${esc(r.label)}: ${r.n}</title></circle>`;
    })
    .join("");
  const peak = rows.reduce((a, b) => (b.n > a.n ? b : a));
  const label = `${caption}: ${rows.length} day${rows.length === 1 ? "" : "s"}, busiest ${peak.label} with ${peak.n} visit${peak.n === 1 ? "" : "s"}.`;
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}">${axis(max)}<polyline points="${pts.join(" ")}" fill="none" stroke="${SERIES[0]}" stroke-width="2" stroke-linejoin="round"/>${dots}${ends(rows)}</svg></figure>`;
}

/** Visits by day as columns, rounded data end, 2px gap between columns. */
export function columnsSvg(caption: string, rows: Row[]): string {
  if (!rows.length) return `<p class="hint">No visits yet.</p>`;
  const max = Math.max(...rows.map((r) => r.n), 1);
  const slot = (W - PADL) / rows.length;
  const bw = Math.max(2, slot - 2);
  const base = H - PADB;
  const bars = rows
    .map((r, i) => {
      const h = r2(((H - PADT - PADB) * r.n) / max);
      return `<rect x="${r2(PADL + i * slot + 1)}" y="${r2(base - h)}" width="${r2(bw)}" height="${h}" rx="${Math.min(4, bw / 2)}" fill="${SERIES[0]}"><title>${esc(r.label)}: ${r.n}</title></rect>`;
    })
    .join("");
  const peak = rows.reduce((a, b) => (b.n > a.n ? b : a));
  const label = `${caption}: ${rows.length} day${rows.length === 1 ? "" : "s"}, busiest ${peak.label} with ${peak.n} visit${peak.n === 1 ? "" : "s"}.`;
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}">${axis(max)}${bars}${ends(rows)}</svg></figure>`;
}

export type ViewKind = "bars" | "pie" | "table" | "line" | "columns";
const VIEW_LABEL: Record<ViewKind, string> = { bars: "Bars", pie: "Pie", table: "Table", line: "Line", columns: "Bars" };

/**
 * One breakdown card: a heading, a "Bars | Pie | Table" toggle (radio-like
 * buttons, aria-pressed) and every view in the HTML. The first view is the
 * default and the only one shown without JS (the others carry `hidden`, the
 * Table view excepted: it stays reachable as a <details> fallback).
 */
export function chartCard(id: string, caption: string, head: string, rows: Row[], kind: "category" | "time"): string {
  const views: ViewKind[] = kind === "time" ? ["line", "columns", "table"] : ["bars", "pie", "table"];
  const render = (v: ViewKind) =>
    v === "bars" ? barsHtml(caption, head, rows) : v === "pie" ? pieSvg(caption, rows) : v === "line" ? lineSvg(caption, rows) : v === "columns" ? columnsSvg(caption, rows) : dataTable(caption, head, rows);
  const toggle = `<div class="viewtoggle" role="group" aria-label="${esc(`Show ${caption.toLowerCase()} as`)}" hidden>${views
    .map((v, i) => `<button type="button" data-view="${v}" aria-pressed="${i === 0}">${VIEW_LABEL[v]}</button>`)
    .join("")}</div>`;
  const body = views
    .map((v, i) => `<div class="view" data-view="${v}"${i === 0 ? "" : " hidden"}>${render(v)}</div>`)
    .join("");
  return `<section class="statcard" id="${esc(id)}" aria-labelledby="${esc(id)}-h" data-chart><div class="statcard-head"><h3 id="${esc(id)}-h">${esc(caption)}</h3>${toggle}</div>${body}</section>`;
}
