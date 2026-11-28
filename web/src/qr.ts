// A tiny QR code encoder, drawn as SVG on the server (2026-11-27): the owner's
// printable "Leave us a review" card. No CDN, no dependency, no script on the
// page. Byte mode, error correction level M, versions 1-10 (up to 213 bytes:
// plenty for <slug>.3pandasite.com/review). Follows the QR spec (ISO 18004) the
// same way Project Nayuki's reference encoder does (MIT).

const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;
/** Format bits for error correction level M. */
const ECL_M_FORMAT = 0;

function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (ver: number) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver]! * BLOCKS_M[ver]!;

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => (result[i]! ^= gfMul(coef, factor)));
  }
  return result;
}

/** The data codewords for `bytes` in byte mode at version `ver` (padded). */
function encodeData(bytes: Uint8Array, ver: number): number[] {
  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(ver) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

function withEcc(data: number[], ver: number): number[] {
  const numBlocks = BLOCKS_M[ver]!;
  const eccLen = ECC_PER_BLOCK_M[ver]!;
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) result.push(block[i]!);
    });
  }
  return result;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Grid {
  readonly size: number;
  readonly dark: boolean[][];
  readonly fixed: boolean[][];
  constructor(readonly ver: number) {
    this.size = ver * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  set(x: number, y: number, d: boolean) {
    this.dark[y]![x] = d;
    this.fixed[y]![x] = true;
  }
  functionPatterns() {
    const s = this.size;
    for (let i = 0; i < s; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [
      [3, 3],
      [s - 4, 3],
      [3, s - 4],
    ] as const) {
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < s && y >= 0 && y < s) this.set(x, y, dist !== 2 && dist !== 4);
        }
    }
    const pos = this.alignmentPositions();
    const n = pos.length;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(pos[i]! + dx, pos[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    this.formatBits(0);
    this.versionBits();
  }
  alignmentPositions(): number[] {
    if (this.ver === 1) return [];
    const numAlign = Math.floor(this.ver / 7) + 2;
    const step = Math.ceil((this.ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = this.size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }
  formatBits(mask: number) {
    const data = (ECL_M_FORMAT << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    const s = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(i));
    this.set(8, s - 8, true);
  }
  versionBits() {
    if (this.ver < 7) return;
    let rem = this.ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const d = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, d);
      this.set(b, a, d);
    }
  }
  codewords(data: number[]) {
    let i = 0;
    const s = this.size;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < s; vert++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? s - 1 - vert : vert;
          if (!this.fixed[y]![x] && i < data.length * 8) {
            this.dark[y]![x] = ((data[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
    }
  }
  mask(m: number) {
    const f = MASKS[m]!;
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) if (!this.fixed[y]![x] && f(x, y)) this.dark[y]![x] = !this.dark[y]![x];
  }
  /** The spec's mask penalty (N1 runs, N2 blocks, N3 finder-like, N4 balance). */
  penalty(): number {
    const s = this.size;
    const d = this.dark;
    let p = 0;
    const lines: boolean[][] = [];
    for (let y = 0; y < s; y++) lines.push(d[y]!);
    for (let x = 0; x < s; x++) lines.push(d.map((row) => row[x]!));
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= s; i++) {
        if (i < s && line[i] === line[i - 1]) run++;
        else {
          if (run >= 5) p += 3 + (run - 5);
          run = 1;
        }
      }
      const str = line.map((v) => (v ? "1" : "0")).join("");
      for (const pat of ["10111010000", "00001011101"]) {
        for (let at = str.indexOf(pat); at !== -1; at = str.indexOf(pat, at + 1)) p += 40;
      }
    }
    for (let y = 0; y < s - 1; y++)
      for (let x = 0; x < s - 1; x++) {
        const c = d[y]![x];
        if (c === d[y]![x + 1] && c === d[y + 1]![x] && c === d[y + 1]![x + 1]) p += 3;
      }
    let darkCount = 0;
    for (const row of d) for (const v of row) if (v) darkCount++;
    const total = s * s;
    p += (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
    return p;
  }
}

/** The QR modules for `text` (true = dark), or null if it is too long. */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  let ver = 1;
  while (ver <= MAX_VERSION && bytes.length > dataCodewords(ver) - (ver <= 9 ? 2 : 3)) ver++;
  if (ver > MAX_VERSION) return null;
  const codewords = withEcc(encodeData(bytes, ver), ver);
  let best: Grid | null = null;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const g = new Grid(ver);
    g.functionPatterns();
    g.codewords(codewords);
    g.mask(m);
    g.formatBits(m);
    const score = g.penalty();
    if (score < bestScore) {
      best = g;
      bestScore = score;
    }
  }
  return best!.dark;
}

/** An SVG QR code (4-module quiet zone, black on white), or null if `text` is too long. */
export function qrSvg(text: string, opts: { title?: string; px?: number } = {}): string | null {
  const m = qrMatrix(text);
  if (!m) return null;
  const n = m.length + 8;
  let path = "";
  m.forEach((row, y) => row.forEach((dark, x) => dark && (path += `M${x + 4} ${y + 4}h1v1h-1z`)));
  const px = opts.px ?? 240;
  const title = opts.title ? `<title>${opts.title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img"${opts.title ? ` aria-label="${opts.title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}"` : ""}>${title}<rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
