'use strict';
/*
 * QR 코드 만들기 (바이트 모드, 오류 복원 L, 1~20판)
 * 선생님이 만든 숙제 링크를 보호자 휴대폰으로 바로 옮기려고 쓴다. 인터넷 연결 없이 그림을 만든다.
 * 쓰는 법: QR.svg('https://...') → <svg> 문자열
 */
const QR = (() => {
  // 판마다 [오류 코드워드/블록, 1묶음 블록 수, 1묶음 데이터 코드워드, (2묶음 블록 수, 데이터 코드워드)]
  const EC_L = [null, [7, 1, 19], [10, 1, 34], [15, 1, 55], [20, 1, 80], [26, 1, 108], [18, 2, 68], [20, 2, 78],
    [24, 2, 97], [30, 2, 116], [18, 2, 68, 2, 69], [20, 4, 81], [24, 2, 92, 2, 93], [26, 4, 107],
    [30, 3, 115, 1, 116], [22, 5, 87, 1, 88], [24, 5, 98, 1, 99], [28, 1, 107, 5, 108], [30, 5, 120, 1, 121],
    [28, 3, 113, 4, 114], [28, 3, 107, 5, 108]];
  // 판마다 맞춤 무늬(alignment pattern) 중심 좌표
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46],
    [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
    [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90]];

  // GF(256) 곱셈표
  const EXP = new Uint8Array(512); const LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  function rsBytes(data, n) { // 오류 복원 코드워드
    let g = [1];
    for (let i = 0; i < n; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); }
      g = ng;
    }
    const res = new Uint8Array(data.length + n);
    res.set(data);
    for (let i = 0; i < data.length; i++) {
      const c = res[i];
      if (c) for (let j = 0; j < g.length; j++) res[i + j] ^= mul(g[j], c);
    }
    return res.slice(data.length);
  }

  // 형식·판 정보에 붙는 오류 검출 비트(BCH)
  const bch = (v, poly, deg, dataBits) => {
    let d = v << deg;
    for (let i = dataBits - 1; i >= 0; i--) if (d & (1 << (deg + i))) d ^= poly << i;
    return d & ((1 << deg) - 1);
  };

  function codewords(text, ver) {
    const bytes = new TextEncoder().encode(text);
    const t = EC_L[ver]; const blocks = [];
    for (let i = 0; i < t[1]; i++) blocks.push(t[2]);
    for (let i = 0; i < (t[3] || 0); i++) blocks.push(t[4]);
    const total = blocks.reduce((a, b) => a + b, 0);
    const lenBits = ver < 10 ? 8 : 16;
    const bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(4, 4); push(bytes.length, lenBits); // 바이트 모드
    for (const b of bytes) push(b, 8);
    if (bits.length + 4 <= total * 8) push(0, 4); else while (bits.length < total * 8) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const words = [];
    for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    for (let i = 0; words.length < total; i++) words.push(i % 2 ? 0x11 : 0xec); // 남은 자리 채우기

    const data = []; const ec = []; let at = 0;
    for (const n of blocks) {
      const d = Uint8Array.from(words.slice(at, at + n)); at += n;
      data.push(d); ec.push(rsBytes(d, t[0]));
    }
    const out = []; // 블록을 번갈아 섞는다
    for (let i = 0; i < Math.max(...blocks); i++) for (const d of data) if (i < d.length) out.push(d[i]);
    for (let i = 0; i < t[0]; i++) for (const e of ec) out.push(e[i]);
    return out;
  }

  function matrix(text, ver, mask) {
    const n = 17 + 4 * ver;
    const m = Array.from({ length: n }, () => new Array(n).fill(null)); // null이면 데이터 자리
    const set = (r, c, v) => { if (r >= 0 && c >= 0 && r < n && c < n) m[r][c] = v; };
    const finder = (r0, c0) => {
      for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr; const c = c0 + dc;
        const d = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        if (r >= 0 && c >= 0 && r < n && c < n) set(r, c, dr < 0 || dc < 0 || dr > 6 || dc > 6 ? 0 : d !== 2 ? 1 : 0);
      }
    };
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 ? 0 : 1); set(i, 6, i % 2 ? 0 : 1); } // 타이밍 무늬
    for (const r of ALIGN[ver]) for (const c of ALIGN[ver]) {
      if ((r < 9 && c < 9) || (r < 9 && c > n - 10) || (r > n - 10 && c < 9)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0);
    }
    set(n - 8, 8, 1); // 늘 검은 칸
    const v5 = (1 << 3) | mask; // 오류 복원 L은 01
    const fmtBits = (((v5 << 10) | bch(v5, 0x537, 10, 5)) ^ 0x5412);
    const bit = (x, i) => (x >> i) & 1;
    for (let i = 0; i <= 5; i++) set(i, 8, bit(fmtBits, i)); // 왼쪽 위 한 벌
    set(7, 8, bit(fmtBits, 6)); set(8, 8, bit(fmtBits, 7)); set(8, 7, bit(fmtBits, 8));
    for (let i = 9; i < 15; i++) set(8, 14 - i, bit(fmtBits, i));
    for (let i = 0; i < 8; i++) set(8, n - 1 - i, bit(fmtBits, i)); // 나머지 두 곳에 한 벌 더
    for (let i = 8; i < 15; i++) set(n - 15 + i, 8, bit(fmtBits, i));
    if (ver >= 7) {
      const vb = (ver << 12) | bch(ver, 0x1f25, 12, 6);
      for (let i = 0; i < 18; i++) {
        set(Math.floor(i / 3), n - 11 + (i % 3), bit(vb, i));
        set(n - 11 + (i % 3), Math.floor(i / 3), bit(vb, i));
      }
    }

    const words = codewords(text, ver);
    const maskFn = [(r, c) => (r + c) % 2, (r, c) => r % 2, (r, c) => c % 3, (r, c) => (r + c) % 3,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2, (r, c) => ((r * c) % 2) + ((r * c) % 3),
      (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2][mask];
    let bi = 0; // 오른쪽 아래에서 두 칸씩 지그재그로 채운다
    for (let col = n - 1; col > 0; col -= 2) {
      if (col === 6) col = 5; // 타이밍 줄은 건너뛴다
      const up = ((col + 1) & 2) === 0;
      for (let i = 0; i < n; i++) {
        const r = up ? n - 1 - i : i;
        for (const c of [col, col - 1]) {
          if (m[r][c] !== null) continue;
          const v = bi < words.length * 8 ? (words[bi >> 3] >> (7 - (bi & 7))) & 1 : 0;
          bi++;
          m[r][c] = v ^ (maskFn(r, c) === 0 ? 1 : 0);
        }
      }
    }
    return m;
  }

  // 규격의 벌점 규칙(ISO/IEC 18004 표 11)으로 마스크를 고른다
  function penalty(m) {
    const n = m.length; let p = 0;
    const seqOf = (get) => { const a = new Array(n); for (let j = 0; j < n; j++) a[j] = get(j); return a; };
    const lines = [];
    for (let i = 0; i < n; i++) lines.push(seqOf((j) => m[i][j]), seqOf((j) => m[j][i]));
    for (const seq of lines) {
      let len = 1;
      for (let j = 1; j <= n; j++) {
        if (j < n && seq[j] === seq[j - 1]) { len++; continue; }
        if (len >= 5) p += len - 2; // 같은 색이 5칸 이상 이어짐
        len = 1;
      }
      // 1:1:3:1:1 무늬 앞뒤로 밝은 칸 4개(찾기 무늬와 헷갈리는 모양)
      const pat = [1, 0, 1, 1, 1, 0, 1];
      for (let j = 0; j + 7 <= n;) {
        let hit = true;
        for (let k = 0; k < 7; k++) if (seq[j + k] !== pat[k]) { hit = false; break; }
        if (!hit) { j++; continue; }
        const quiet = (a) => a.every((v) => !v);
        if (quiet(seq.slice(Math.max(0, j - 4), j)) || quiet(seq.slice(j + 7, j + 11))) { p += 40; j += 7; } else j += 4;
      }
    }
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { // 같은 색 2x2 덩어리
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
    }
    let dark = 0;
    for (const row of m) for (const v of row) dark += v;
    p += 10 * Math.floor(Math.abs((100 * dark) / (n * n) - 50) / 5); // 검은 칸이 절반에서 멀어진 만큼
    return p;
  }

  function build(text) {
    const len = new TextEncoder().encode(text).length;
    let ver = 0;
    for (let v = 1; v <= 20; v++) {
      const t = EC_L[v];
      const cap = t[1] * t[2] + (t[3] || 0) * (t[4] || 0);
      if (4 + (v < 10 ? 8 : 16) + 8 * len <= cap * 8) { ver = v; break; }
    }
    if (!ver) throw new Error('너무 긴 글자예요');
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      // 2번 마스크(세로 줄무늬)는 규격에 맞지만, 잘 못 읽는 카메라가 있어 쓰지 않는다
      if (mask === 2) continue;
      const p = penalty(matrix(text, ver, mask));
      if (!best || p < best[0]) best = [p, mask];
    }
    return matrix(text, ver, best[1]);
  }

  // 검은 칸을 한 path로 모아 그린다(칸이 수백 개라 따로 그리면 느리다)
  function svg(text, { margin = 2, cls = '' } = {}) {
    const m = build(text); const n = m.length; const size = n + margin * 2;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    return `<svg class="qr ${cls}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="숙제 링크 QR 코드">
      <rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#15241c"/></svg>`;
  }

  return { build, svg };
})();
if (typeof module !== 'undefined') module.exports = QR;
