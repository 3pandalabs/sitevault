// Home page visuals (redesign 2026-11-27). CSS only: the CSP allows no
// outside fonts or images and scripts only by nonce, so every visual here is
// HTML + CSS (the mock websites are drawn, not screenshots). Classes are
// prefixed sv-; all motion stops under prefers-reduced-motion. The businesses
// in the mock sites are made up.
import { esc } from "./util.js";

const MOCK_SITES = [
  { name: "Rivera Plumbing", slug: "riveraplumbing", icon: "🔧", color: "#1d4ed8", font: "ss" },
  { name: "Sweet Crumb Bakery", slug: "sweetcrumb", icon: "🥐", color: "#9a3412", font: "sf" },
  { name: "Green Leaf Lawn", slug: "greenleaflawn", icon: "🌿", color: "#15803d", font: "ss" },
  { name: "Glow Hair Studio", slug: "glowhair", icon: "✂️", color: "#7c3aed", font: "sf" },
  { name: "Bright Smile Dental", slug: "brightsmile", icon: "🦷", color: "#0f766e", font: "ss" },
] as const;
const SLOT = 4;
const rot = (i: number) => `--rd:${MOCK_SITES.length * SLOT}s;--rl:${i * SLOT - SLOT * 0.1}s`;
const first = (i: number) => (i === 0 ? " data-first" : "");

const TRADES = ["Plumbers", "Bakeries", "Hair salons", "Landscapers", "Dentists", "Cleaners", "Electricians", "Restaurants", "Auto repair", "Painters", "Pet groomers", "Food trucks", "Tutors", "Florists"];

export const HOME_CSS = `<style>
.sv-wide{width:100vw;margin-left:calc(50% - 50vw)}
.sv-h1{font-size:clamp(2.6rem,7vw,4.4rem);line-height:1.03;letter-spacing:-.04em;font-weight:800;margin:0 0 22px;text-wrap:balance}
.sv-h2{font-size:clamp(1.9rem,4.6vw,3rem);line-height:1.08;letter-spacing:-.035em;font-weight:800;margin:10px 0 14px;text-wrap:balance}
.sv-kick{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.75rem;letter-spacing:.2em;text-transform:uppercase;color:var(--accent-hi);margin:0}
.sv-shim{background:linear-gradient(100deg,#38bdf8 0%,#a78bfa 38%,#f472b6 62%,#38bdf8 100%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:sv-shim 6s ease-in-out infinite}
@keyframes sv-shim{0%,100%{background-position:0 50%}50%{background-position:100% 50%}}
.sv-scrib{position:relative;display:inline-block}
.sv-scrib svg{position:absolute;left:0;right:0;bottom:-.1em;width:100%;height:.3em;overflow:visible}
.sv-scrib path{stroke-dasharray:420;stroke-dashoffset:420;animation:sv-draw 1.3s .4s cubic-bezier(.65,0,.35,1) forwards}
@keyframes sv-draw{to{stroke-dashoffset:0}}
.sv-live{display:inline-block;width:8px;height:8px;border-radius:50%;background:#34d399;margin-right:8px;vertical-align:1px;animation:sv-blink 1.4s ease-in-out infinite}
@keyframes sv-blink{50%{opacity:.25}}
.sv-hero{display:grid;gap:48px;align-items:center;padding:28px 0 64px}
@media (min-width:960px){.sv-hero{grid-template-columns:1.05fr 1fr}}
.sv-hero .lead{margin-bottom:18px}
.sv-cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px}
.sv-cta .btn{padding:14px 24px;font-size:1.05rem}
.sv-shine{position:relative;overflow:hidden;box-shadow:0 10px 40px -10px rgba(56,189,248,.8)}
.sv-shine::before{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.6),transparent);transform:skewX(-20deg);animation:sv-shine 3.5s ease-in-out infinite}
@keyframes sv-shine{0%,60%{left:-60%}100%{left:130%}}
.sv-stage{position:relative;max-width:520px;width:100%;margin:0 auto;padding:18px 0 34px;perspective:1400px}
.sv-browser{position:relative;border-radius:16px;background:#18181b;border:1px solid rgba(255,255,255,.15);box-shadow:0 40px 80px -30px rgba(0,0,0,.9),0 0 80px -30px rgba(56,189,248,.45);overflow:hidden;animation:sv-float 7s ease-in-out infinite}
@keyframes sv-float{0%,100%{transform:rotateX(5deg) rotateY(-10deg) translateY(0)}50%{transform:rotateX(3deg) rotateY(-5deg) translateY(-12px)}}
.sv-bar{display:flex;align-items:center;gap:6px;padding:10px 12px;background:#27272a}
.sv-bar i{width:10px;height:10px;border-radius:50%;background:#52525b;flex:none}
.sv-bar i:nth-child(1){background:#f87171}.sv-bar i:nth-child(2){background:#fbbf24}.sv-bar i:nth-child(3){background:#34d399}
.sv-url{position:relative;flex:1;margin-left:8px;height:24px;border-radius:999px;background:#18181b;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#d4d4d8;overflow:hidden}
.sv-url span{position:absolute;inset:0;display:flex;align-items:center;padding-left:12px;white-space:nowrap}
.sv-url b{color:#7dd3fc;font-weight:500}
.sv-view{position:relative;aspect-ratio:4/3.2;background:#fff}
.sv-site{position:absolute;inset:0;display:flex;flex-direction:column;color:#111827;font-size:12px;line-height:1.35}
.sv-rot{opacity:0;animation:sv-rot var(--rd,20s) linear infinite;animation-delay:var(--rl,0s)}
@keyframes sv-rot{0%{opacity:0}2%{opacity:1}20%{opacity:1}22%{opacity:0}100%{opacity:0}}
.sv-rot-t{animation-name:sv-rot-t}
@keyframes sv-rot-t{0%,2%{opacity:0;transform:translateY(6px)}4.5%,18.5%{opacity:1;transform:none}20%,100%{opacity:0;transform:translateY(-4px)}}
.sv-site .ss{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.sv-site .sf{font-family:Georgia,"Iowan Old Style","Times New Roman",serif;font-weight:400;letter-spacing:-.01em}
.sv-nav{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;font-size:11px}
.sv-nav .nm{font-weight:800;font-size:13px;letter-spacing:-.01em}
.sv-nav nav{display:flex;gap:12px;opacity:.75}
.sv-k{font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
.sv-b{display:inline-block;padding:7px 12px;font-weight:700;font-size:11px}
.sv-pic{position:relative;overflow:hidden;display:grid;place-items:center}
.sv-pic span{font-size:58px;filter:drop-shadow(0 8px 16px rgba(0,0,0,.25));animation:sv-bob 4s ease-in-out infinite}
@keyframes sv-bob{50%{transform:translateY(-6px) rotate(-6deg)}}
.sv-pic::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 30% 25%,rgba(255,255,255,.35),transparent 45%)}
.sv-dot::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;margin-right:6px}
/* 1 spotlight: full-bleed photo hero, bold sans, square buttons (trades) */
.t-spot .hero{position:relative;flex:1.15;color:#fff;padding:0 18px 16px;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden}
.t-spot .hero .bg{position:absolute;inset:0}
.t-spot .hero .bg span{position:absolute;right:-6px;top:6px;font-size:150px;opacity:.22;transform:rotate(-18deg)}
.t-spot .hero>*{position:relative}
.t-spot .sv-nav{position:absolute;top:0;left:0;right:0;color:#fff;z-index:1}
.t-spot h4{margin:4px 0 10px;font-size:25px;line-height:1.05;font-weight:900;letter-spacing:-.03em}
.t-spot .sv-b{border-radius:4px}
.t-spot .row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px 16px}
.t-spot .row div{border:1px solid #e5e7eb;border-radius:4px;padding:8px;font-weight:700;font-size:10.5px}
.t-spot .row i{display:block;font-style:normal;font-weight:400;color:#6b7280;font-size:9.5px;margin-top:2px}
/* 2 editorial: centred serif, warm paper, image band, menu with leaders (food) */
.t-edit{background:#fbf6ee;color:#3b2a1e;text-align:center}
.t-edit .top{padding:14px 16px 8px}
.t-edit .nm{font-size:27px;line-height:1}
.t-edit .tg{font-style:italic;font-size:12px;margin-top:4px;opacity:.8}
.t-edit .band{height:92px;margin:8px 0}
.t-edit .band span{font-size:44px;letter-spacing:18px}
.t-edit .menu{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px;padding:4px 22px;text-align:left;font-size:11px}
.t-edit .menu div{display:flex;gap:4px}.t-edit .menu div::after{content:"";flex:1;border-bottom:1px dotted #b8a48e;margin-bottom:3px;order:1}
.t-edit .menu b{order:2;font-weight:600}
.t-edit .sv-b{border-radius:2px;margin:10px 4px 0;letter-spacing:.08em;text-transform:uppercase;font-size:9.5px}
/* 3 split: text panel + photo, sans, rounded (outdoor / active) */
.t-split{flex-direction:row!important}
.t-split .txt{flex:1.05;padding:16px;display:flex;flex-direction:column}
.t-split .nm{font-weight:900;font-size:13px;letter-spacing:-.01em}
.t-split h4{margin:14px 0 6px;font-size:22px;line-height:1.08;font-weight:800;letter-spacing:-.03em}
.t-split p{margin:0 0 10px;font-size:11px;opacity:.8}
.t-split .sv-b{border-radius:10px;align-self:flex-start}
.t-split ul{list-style:none;margin:auto 0 0;padding:0;display:grid;gap:4px;font-size:10.5px;font-weight:600}
.t-split ul li::before{content:"✓ ";font-weight:900}
.t-split .sv-pic{flex:1;border-radius:0;place-items:start center;padding-top:36px}
.t-split .sv-pic span{font-size:72px}
/* 4 beauty: serif, airy, pill buttons, arch photo (salon / spa) */
.t-beauty{background:#fbf8ff;color:#2e1f3f}
.t-beauty .sv-nav .nm{font-family:Georgia,serif;font-weight:400;font-size:15px;letter-spacing:.02em}
.t-beauty .wrapb{display:grid;grid-template-columns:1.1fr 1fr;gap:12px;align-items:center;padding:6px 18px 0;flex:1}
.t-beauty h4{margin:6px 0 8px;font-size:26px;line-height:1.05}
.t-beauty p{margin:0 0 12px;font-size:11px;opacity:.75}
.t-beauty .sv-b{border-radius:999px}
.t-beauty .sv-pic{height:150px;border-radius:999px 999px 14px 14px}
.t-beauty .strip{display:flex;justify-content:center;gap:16px;padding:10px 16px 12px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.7}
/* 5 clinical: crisp white, top nav, info card (health) */
.t-clin{background:#fff;color:#0f172a}
.t-clin .sv-nav{border-bottom:1px solid #e2e8f0}
.t-clin .wrapc{display:grid;grid-template-columns:1.15fr 1fr;gap:14px;padding:16px;flex:1;align-items:start}
.t-clin h4{margin:6px 0 8px;font-size:21px;line-height:1.12;font-weight:650;letter-spacing:-.02em}
.t-clin p{margin:0 0 12px;font-size:11px;color:#475569}
.t-clin .sv-b{border-radius:8px}
.t-clin .card{border:1px solid #e2e8f0;border-radius:12px;padding:10px;font-size:10.5px;box-shadow:0 8px 20px -12px rgba(15,23,42,.25)}
.t-clin .card div{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f1f5f9}
.t-clin .card div:last-child{border:0}
.t-clin .icons{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 16px 14px;font-size:10px;font-weight:600;text-align:center}
.t-clin .icons span{display:block;font-size:16px;margin-bottom:2px}
.sv-float{position:absolute;z-index:3;border-radius:16px;border:1px solid rgba(255,255,255,.15);background:rgba(24,24,27,.92);backdrop-filter:blur(8px);box-shadow:0 20px 40px -15px rgba(0,0,0,.8);padding:10px 14px;font-size:.8rem;line-height:1.35;animation:sv-chipf 6s ease-in-out infinite}
.sv-float b{display:block;font-size:.95rem;color:#f4f4f5}
.sv-float small{color:var(--muted)}
.sv-f1{top:-6px;right:-6px}.sv-f2{bottom:58px;left:-10px;animation-delay:-2s}
.sv-f3{bottom:0;left:24px;animation-delay:-4s;border-color:rgba(52,211,153,.35);background:rgba(6,78,59,.88);color:#a7f3d0;border-radius:999px;padding:7px 14px}
@media (min-width:1100px){.sv-f1{right:-44px}.sv-phone{right:-64px;bottom:-18px}.sv-f3{left:-28px}}
@keyframes sv-chipf{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-10px) rotate(2deg)}}
.sv-timer{display:flex;align-items:center;gap:10px}
.sv-ring{width:34px;height:34px;flex:none}
.sv-ring .run{stroke-dasharray:88;stroke-dashoffset:88;animation:sv-ring 5s linear infinite}
@keyframes sv-ring{to{stroke-dashoffset:0}}
.sv-phone{position:absolute;right:-8px;bottom:8px;z-index:2;width:120px;border-radius:22px;border:1px solid rgba(255,255,255,.2);background:#18181b;padding:5px;box-shadow:0 30px 50px -20px rgba(0,0,0,.9);animation:sv-chipf 8s ease-in-out infinite reverse}
.sv-phone .scr{position:relative;aspect-ratio:9/17;border-radius:17px;overflow:hidden;background:#fff}
.sv-phone .pt{padding:24px 9px 10px;color:#fff;font-size:14px;line-height:1.1}
.sv-phone .pt small{display:block;font-size:8.5px;opacity:.85;margin-top:3px;line-height:1.3}
.sv-phone .ph{margin:8px;height:68px;border-radius:9px;display:grid;place-items:center;font-size:30px}
.sv-phone .call{position:absolute;left:8px;right:8px;bottom:10px;border-radius:999px;padding:7px 0;text-align:center;color:#fff;font-weight:800;font-size:11px;animation:sv-pulse 2.2s ease-out infinite}
@keyframes sv-pulse{0%{box-shadow:0 0 0 0 rgba(56,189,248,.7)}100%{box-shadow:0 0 0 12px rgba(56,189,248,0)}}
@media (max-width:520px){.sv-f2{display:none}.sv-f1{padding:6px 10px}.sv-f1 .sv-ring{width:26px;height:26px}.sv-f3{font-size:.72rem;left:8px}.sv-phone{width:92px;right:-4px}.sv-phone .ph{height:48px;font-size:22px}.sv-f1{right:-4px}.sv-f2{left:-4px}.sv-pic span{font-size:40px}.sv-site h4{font-size:19px!important}.sv-nav nav{display:none}}
.sv-marq{border-block:1px solid var(--line);background:rgba(255,255,255,.02);padding:18px 0;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}
.sv-track{display:flex;width:max-content;animation:sv-marq 40s linear infinite}
.sv-marq:hover .sv-track{animation-play-state:paused}
@keyframes sv-marq{to{transform:translateX(-50%)}}
.sv-track b{display:flex;align-items:center;gap:24px;padding:0 24px;font-size:clamp(1.3rem,3vw,1.9rem);font-weight:700;letter-spacing:-.03em;color:#a1a1aa;white-space:nowrap}
.sv-track b::after{content:"✦";color:rgba(56,189,248,.7);font-size:.8em}
#how-it-works,#features{padding-top:72px}
#how-it-works>h2,#features>h2{text-align:center;font-size:clamp(1.9rem,4.6vw,3rem);line-height:1.1;letter-spacing:-.035em;font-weight:800;margin:0 0 36px}
#how-it-works>h2::before{content:"How it works"}#features>h2::before{content:"What you get"}
#how-it-works>h2::before,#features>h2::before{display:block;font:500 .75rem/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--accent-hi);margin-bottom:10px}
#how-it-works .steps{counter-reset:st}
#how-it-works .card{padding:26px;background:rgba(24,24,27,.7);transition:transform .35s cubic-bezier(.2,.8,.2,1),border-color .35s}
#how-it-works .card::before{counter-increment:st;content:counter(st);display:grid;place-items:center;width:52px;height:52px;border-radius:16px;margin-bottom:16px;font-size:1.5rem;font-weight:800;color:#09090b;background:linear-gradient(135deg,#7dd3fc,#a78bfa);box-shadow:0 10px 30px -10px rgba(56,189,248,.8)}
#how-it-works .card:hover,#features .card:hover{transform:translateY(-6px);border-color:rgba(56,189,248,.4)}
#how-it-works .card h3{font-size:1.1rem}
#features .steps{grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr))}
#features .card{padding:24px;background:rgba(24,24,27,.6);transition:transform .35s cubic-bezier(.2,.8,.2,1),border-color .35s}
#features .card .ic{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:rgba(56,189,248,.12);border:1px solid rgba(56,189,248,.25);font-size:1.3rem;margin-bottom:14px}
#features .plan-note{text-align:center}
.sv-stats{display:grid;gap:40px;align-items:center;padding:80px 0 24px}
@media (min-width:900px){.sv-stats{grid-template-columns:1fr 1fr}}
.sv-panel{border:1px solid var(--line);border-radius:20px;background:rgba(24,24,27,.75);padding:22px;box-shadow:0 30px 60px -30px rgba(0,0,0,.8)}
.sv-panel h3{margin:0 0 14px;font-size:.95rem}
.sv-src{display:grid;grid-template-columns:7.5rem 1fr 2.5rem;gap:10px;align-items:center;font-size:.85rem;color:var(--fg2);margin:0 0 10px}
.sv-src i{display:block;height:10px;border-radius:6px;background:linear-gradient(90deg,#38bdf8,#a78bfa);transform-origin:left;animation:sv-grow 1.6s cubic-bezier(.2,.8,.2,1) both;animation-delay:var(--d)}
.sv-src span:last-child{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
@keyframes sv-grow{from{transform:scaleX(0)}}
.sv-spark{display:flex;align-items:flex-end;gap:5px;height:70px;margin:18px 0 6px}
.sv-spark i{flex:1;border-radius:4px 4px 0 0;background:rgba(56,189,248,.35);animation:sv-up 1.4s cubic-bezier(.2,.8,.2,1) both;animation-delay:var(--d);transform-origin:bottom}
.sv-spark i:last-child{background:#38bdf8}
@keyframes sv-up{from{transform:scaleY(0)}}
.sv-ex{font-size:.75rem;color:var(--dim);margin:8px 0 0}
.sv-pro{display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;border:1px solid rgba(56,189,248,.35);background:rgba(56,189,248,.12);color:#bae6fd;font-size:.7rem;letter-spacing:.05em;text-transform:uppercase;vertical-align:middle}
#sv-pricing{padding:80px 0 24px}
#sv-pricing .sv-head{text-align:center;max-width:44rem;margin:0 auto}
#sv-pricing .price{margin:0}
#sv-pricing .plans{margin:36px auto 12px}
#sv-pricing .included{background:rgba(24,24,27,.75);border-radius:20px;padding:24px}
#sv-pricing .included.pro{border:1px solid transparent;background:linear-gradient(#141418,#141418) padding-box,conic-gradient(from var(--sva,0deg),#38bdf8,#a78bfa,#f472b6,#38bdf8) border-box;animation:sv-spin 8s linear infinite}
@property --sva{syntax:"<angle>";inherits:false;initial-value:0deg}
@keyframes sv-spin{to{--sva:360deg}}
#sv-pricing .plan-note{text-align:center}
.sv-promo{margin-top:28px;border-radius:20px;border:1px solid rgba(251,191,36,.3);background:radial-gradient(80% 120% at 0% 0%,rgba(251,191,36,.16),transparent 60%),rgba(24,24,27,.75);padding:22px 24px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px}
.sv-promo p{margin:0;font-size:1.1rem;font-weight:600;line-height:1.5}
.sv-promo p span{display:block;margin-top:6px;font-size:.95rem;font-weight:400;color:var(--fg2)}
.sv-promo .btn{background:#fbbf24;color:#09090b}.sv-promo .btn:hover{background:#fcd34d}
.sv-final{margin:72px 0 40px;border-radius:32px;border:1px solid var(--line);padding:64px 24px;text-align:center;overflow:hidden;background:radial-gradient(60% 80% at 12% 0%,rgba(56,189,248,.35),transparent 60%),radial-gradient(60% 80% at 88% 100%,rgba(139,92,246,.4),transparent 60%),radial-gradient(50% 60% at 50% 50%,rgba(244,114,182,.15),transparent 70%),#0b0b12}
.sv-final p{color:var(--fg2);font-size:1.1rem}
.sv-final .sv-cta{justify-content:center;margin-top:24px}
@media (prefers-reduced-motion:reduce){
.sv-shim,.sv-scrib path,.sv-live,.sv-shine::before,.sv-browser,.sv-pic span,.sv-float,.sv-ring .run,.sv-phone,.sv-phone .call,.sv-track,.sv-src i,.sv-spark i,#sv-pricing .included.pro{animation:none!important}
.sv-scrib path{stroke-dashoffset:0}
.sv-rot{animation:none!important}.sv-rot[data-first]{opacity:1}
}
</style>`;

// One example site per template look (spotlight, editorial, split, beauty,
// clinical), the way the real templates + category families differ.
const SITE_HTML = [
  // Rivera Plumbing: spotlight
  `<div class="sv-site t-spot ss">
    <div class="hero"><div class="bg" style="background:linear-gradient(135deg,#0b1f4d,#1d4ed8 70%,#3b82f6)"><span>🔧</span></div>
      <div class="sv-nav"><span class="nm">RIVERA PLUMBING</span><nav><span>Services</span><span>Area</span><span>Contact</span></nav></div>
      <span class="sv-k" style="color:#93c5fd">Licensed plumbers</span>
      <h4>Plumbing problems,<br>fixed fast.</h4>
      <div><span class="sv-b" style="background:#fff;color:#1d4ed8">📞 Call now</span> <span class="sv-b" style="border:1px solid rgba(255,255,255,.6)">Get directions</span></div>
    </div>
    <div class="row"><div>Leak repair<i>Same-day visits</i></div><div>Drain cleaning<i>Kitchen and bath</i></div><div>Water heaters<i>Repair or replace</i></div></div>
  </div>`,
  // Sweet Crumb Bakery: editorial
  `<div class="sv-site t-edit">
    <div class="top"><div class="sv-k" style="color:#9a3412">Bakery &amp; coffee</div><div class="nm sf">Sweet Crumb</div><div class="tg sf">Fresh bakes every morning</div></div>
    <div class="band sv-pic" style="background:linear-gradient(90deg,#f6d9b0,#e9b57a,#f6d9b0)"><span>🥐🍰☕</span></div>
    <div class="menu sf"><div>Croissant<b>$3.50</b></div><div>Sourdough loaf<b>$8</b></div><div>Cinnamon roll<b>$4</b></div><div>Latte<b>$4.75</b></div></div>
    <div><span class="sv-b ss" style="background:#3b2a1e;color:#fbf6ee">Call to order</span><span class="sv-b ss" style="border:1px solid #3b2a1e">Directions</span></div>
  </div>`,
  // Green Leaf Lawn: split
  `<div class="sv-site t-split ss">
    <div class="txt" style="background:#f0fdf4;color:#14532d"><span class="nm">🌿 GREEN LEAF LAWN</span>
      <h4>Lawn care your neighbors notice.</h4><p>Mowing, edging and seasonal cleanups.</p>
      <span class="sv-b" style="background:#15803d;color:#fff">📞 Get a quote</span>
      <ul><li>Weekly mowing</li><li>Hedge trimming</li><li>Fall cleanup</li></ul>
      <p class="sv-dot" style="margin:8px 0 0">Mon–Sat 8am–6pm</p></div>
    <div class="sv-pic" style="background:linear-gradient(160deg,#86efac,#16a34a 55%,#14532d)"><span>🌳</span></div>
  </div>`,
  // Glow Hair Studio: beauty
  `<div class="sv-site t-beauty ss">
    <div class="sv-nav"><span class="nm">Glow Hair Studio</span><nav><span>Services</span><span>Book</span></nav></div>
    <div class="wrapb"><div><span class="sv-k" style="color:#7c3aed">Hair salon</span><h4 class="sf">Cuts, color &amp; styling.</h4><p>A calm chair and a look you love.</p>
      <span class="sv-b" style="background:#2e1f3f;color:#fff">Book a visit</span></div>
      <div class="sv-pic" style="background:linear-gradient(180deg,#e9d5ff,#c084fc 60%,#7c3aed)"><span>✂️</span></div></div>
    <div class="strip"><span>Haircuts</span><span>Color</span><span>Blowouts</span></div>
  </div>`,
  // Bright Smile Dental: clinical
  `<div class="sv-site t-clin ss">
    <div class="sv-nav"><span class="nm" style="color:#0f766e">🦷 Bright Smile Dental</span><nav><span>Services</span><span>Hours</span><span>Contact</span></nav></div>
    <div class="wrapc"><div><span class="sv-k" style="color:#0f766e">Family dentistry</span><h4>Gentle care for the whole family.</h4><p>Checkups, cleanings and whitening.</p>
      <span class="sv-b" style="background:#0f766e;color:#fff">📞 Call to book</span></div>
      <div class="card"><b style="display:block;margin-bottom:4px" class="sv-dot">Open today</b><div><span>Mon–Thu</span><span>9–5</span></div><div><span>Fri</span><span>9–3</span></div><div><span>Sat–Sun</span><span>Closed</span></div></div></div>
    <div class="icons"><div><span>🪥</span>Cleanings</div><div><span>✨</span>Whitening</div><div><span>🧒</span>Kids</div></div>
  </div>`,
];

function mockSite(i: number): string {
  return SITE_HTML[i]!.replace('<div class="sv-site', `<div${first(i)} style="${rot(i)}" class="sv-rot sv-site`);
}

/** Hero visual: a browser and a phone cycling through example websites. */
export function heroStage(): string {
  return `<div class="sv-stage" role="img" aria-label="Example websites made with SiteVault, changing every few seconds">
  <div class="sv-browser" aria-hidden="true">
    <div class="sv-bar"><i></i><i></i><i></i><div class="sv-url">${MOCK_SITES.map((s, i) => `<span class="sv-rot sv-rot-t"${first(i)} style="${rot(i)}">🔒&nbsp;<b>${s.slug}</b>.3pandasite.com</span>`).join("")}</div></div>
    <div class="sv-view">${MOCK_SITES.map((_, i) => mockSite(i)).join("")}</div>
  </div>
  <div class="sv-phone" aria-hidden="true"><div class="scr">${MOCK_SITES.map(
    (s, i) =>
      `<div class="sv-rot"${first(i)} style="position:absolute;inset:0;${rot(i)}"><div class="pt ${s.font === "sf" ? "sf" : "ss"}" style="background:${s.color};font-family:${s.font === "sf" ? "Georgia,serif" : "ui-sans-serif,system-ui,sans-serif;font-weight:800"}">${esc(s.name)}<small style="font-family:ui-sans-serif,system-ui,sans-serif;font-weight:400">${s.slug}.3pandasite.com</small></div><div class="ph" style="background:${s.color}22">${s.icon}</div><div class="call" style="background:${s.color}">📞 Call</div></div>`,
  ).join("")}</div></div>
  <div class="sv-float sv-f1" aria-hidden="true"><div class="sv-timer"><svg class="sv-ring" viewBox="0 0 34 34"><circle cx="17" cy="17" r="14" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="4"/><circle class="run" cx="17" cy="17" r="14" fill="none" stroke="#38bdf8" stroke-width="4" stroke-linecap="round" transform="rotate(-90 17 17)"/></svg><div><small>From photos to live</small><b>About 5 minutes</b></div></div></div>
  <div class="sv-float sv-f3" aria-hidden="true">🔒 Hosting and HTTPS included</div>
</div>`;
}

/** Full-width strip of business types (decorative; the second copy makes the loop seamless). */
export function tradesMarquee(): string {
  const row = TRADES.map((t) => `<b>${esc(t)}</b>`).join("");
  return `<div class="sv-marq sv-wide" aria-label="Made for local businesses"><div class="sv-track"><div style="display:flex">${row}</div><div style="display:flex" aria-hidden="true">${row}</div></div></div>`;
}

/** Pro visitor-stats teaser with example numbers. */
export function statsDemo(): string {
  const src: [string, number, number][] = [["Google", 92, 41], ["Your AdVault ad", 64, 29], ["Facebook", 42, 19], ["WhatsApp", 30, 13], ["Instagram", 18, 8]];
  const days = [22, 30, 26, 38, 34, 45, 41, 52, 48, 60, 57, 70, 66, 82];
  return `<section class="sv-stats" aria-labelledby="sv-stats-h">
  <div>
    <p class="sv-kick">Visitor stats</p>
    <h2 class="sv-h2" id="sv-stats-h">See who found you, <span class="sv-shim">and how.</span></h2>
    <p class="lead" style="color:var(--muted)">With Pro, see visits day by day, where people came from, which towns they're in, and how many tapped Call or Directions. Counted on our side: no cookies, no trackers.</p>
  </div>
  <div class="sv-panel" aria-hidden="true">
    <h3>Where they found you <span class="sv-pro">Pro</span></h3>
    ${src.map(([n, w, c], i) => `<div class="sv-src"><span>${n}</span><span><i style="width:${w}%;--d:${(0.15 * i).toFixed(2)}s"></i></span><span>${c}</span></div>`).join("")}
    <div class="sv-spark">${days.map((h, i) => `<i style="height:${h}%;--d:${(0.05 * i).toFixed(2)}s"></i>`).join("")}</div>
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;font-size:.8rem;color:var(--muted)"><span>Visits, last 14 days</span><span>📞 Call and 📍 Directions taps</span></div>
    <p class="sv-ex">Example numbers.</p>
  </div>
</section>`;
}
