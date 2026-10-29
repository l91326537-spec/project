'use strict';
/*
 * 소리길 말하기 연습: 듣기만큼 말하기도 확인한다.
 * - 발음(따라 말하기): 들은 말을 소리 내어 따라 하면 음성 인식 결과를 음절과 자모 단위로 견주고,
 *   다르게 들린 소리마다 발음 요령을 알려 준다. 요즘 말에서 같게 소리 나는 모음(ㅐ·ㅔ, ㅙ·ㅞ·ㅚ)과
 *   받침(낫·낮·낟은 모두 [낟])은 같은 소리로 친다.
 * - 목소리('아—' 길게 내기, 1-5 칸): 마이크 소리의 크기와 높이를 바로 재서 2초 넘게 고르게 내는지 본다.
 * - 억양(말끝 올리기·내리기, 4-5 칸): 같은 말을 묻는 말(끝을 올림)과 대답하는 말(끝을 내림)로 말하고 높낮이 그래프로 본다.
 * - 소음 속에서 주문하기(5-5 칸): 카페 소음을 깔고 듣고, 소음이 깔린 채로 또박또박 따라 말한다.
 * 목소리와 억양은 음성 인식 없이 이 기기 안에서 재고, 마이크 소리는 저장하지 않는다.
 */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SPEAK_N = 5;
const AAH_SEC = 2;      // '아—'는 2초 넘게
const TUNE_UP = 2;      // 묻는 말: 말끝이 앞부분보다 반음 2개 넘게 올라가면
const TUNE_FLAT = 1;    // 대답하는 말: 반음 1개보다 덜 올라가면(대개 내려간다)
const hasNumber = (t) => /(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|삼|사|오|육|칠|팔|구|십) ?(번|시|개|층|원|월|잔|분|살)/.test(t); // 음성 인식이 숫자로 적는 문장은 뺀다
// 5-5: 카페에서 손님이 하는 말(content.js의 카페 문장과 생활 문장에서 골랐다. 음성 파일이 있다)
const ORDER_LINES = ['연하게 해 주세요', '얼음 적게 넣어 주세요', '시럽은 따로 주세요', '디카페인으로 바꿀 수 있어요?', '설탕 빼 주세요', '얼음 빼 주세요',
  '우유 빼 주세요', '큰 걸로 주세요', '작은 걸로 주세요', '따뜻한 유자차 주세요', '차가운 자몽차 주세요', '치즈 케이크 하나 주세요', '포크 하나 더 주세요',
  '물티슈 있어요?', '여기 자리 있어요?', '케이크도 있어요?', '화장실 열쇠 주세요', '휴지 좀 더 주세요', '포장해 주세요', '카드로 계산할게요', '영수증 주세요'];
// 4-5: 끝만 바꾸면 묻는 말도 대답하는 말도 되는 말. 의문사(어디·뭐·언제)가 든 물음은 끝이 내려가서 뺐다.
const TUNE_LINES = ['밥 먹었어요', '잘 잤어요', '약 먹었어요', '많이 아파요', '열이 나요', '집에 가요', '비가 와요', '배고파요', '괜찮아요', '다 했어요',
  '맛있어요', '추워요', '손 씻었어요', '피곤해요', '시간 있어요', '다 나았어요'];

// kind: say 따라 말하기(음성 인식), voice 목소리 크기·길이, tune 말끝 높낮이
const SPEAK_MODES = {
  word: { kind: 'say', name: '쉬운 단어', icon: '🍎', about: '사과, 우유처럼 쉬운 낱말', items: () => [...new Set([...WORD_SETS[1], ...WORD_SETS[2]].flat())] },
  pair: { kind: 'say', name: '헷갈리는 단어', icon: '🌾', about: '살과 쌀처럼 한 소리만 다른 낱말', items: () => [...new Set(WORD_SETS[3].flat())] },
  sentence: { kind: 'say', name: '생활 문장', icon: '💬', about: '물 좀 주세요 같은 짧은 문장', items: () => [...new Set(SENTENCE_SETS[1].flat())].filter((t) => !hasNumber(t)) },
  weak: { kind: 'say', name: '내가 약한 소리', icon: '🎯', about: '말할 때 자주 다르게 들린 소리가 든 낱말', items: () => weakSpeakWords() },
  order: { kind: 'say', name: '소음 속에서 주문하기', icon: '☕', about: '카페 소음 속에서 듣고 또박또박 주문해요', items: () => ORDER_LINES, noise: { id: 'cafe', snr: 12 } },
  aah: { kind: 'voice', name: '"아—" 길게 내기', icon: '🎈', about: `${AAH_SEC}초 넘게, 고른 크기와 높이로` },
  tune: { kind: 'tune', name: '말끝 올리기·내리기', icon: '🎵', about: '묻는 말은 끝을 올리고, 대답은 내려요' },
};
const SPEAK_KIND = { say: '발음', voice: '목소리', tune: '억양' };
const canMic = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && !!(window.AudioContext || window.webkitAudioContext);
// 이 기기에서 칸 통과를 확인할 수 있는지: 따라 말하기는 음성 인식이, 목소리·억양은 마이크만 있으면 된다
const speakReady = (mode) => (SPEAK_MODES[mode]?.kind === 'say' ? !!Recognition : canMic());
// 기계가 확인한 판(녹음해서 스스로 견준 판은 점수와 칸 통과에서 뺀다)
const speakJudged = (x) => !!(x.asr || x.auto);

/* ---------- 마이크로 목소리 재기 ---------- */

let activeMic = null; // 다른 화면으로 가면 끈다
async function openMic() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch {}
  // 자동 음량 조절을 끄고 들어야 크기가 고른지 잴 수 있다
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const c = audio();
  const src = c.createMediaStreamSource(stream);
  const an = c.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
  const mute = c.createGain(); mute.gain.value = 0; // 사파리는 출력에 이어야 분석기가 돈다(소리는 내지 않는다)
  src.connect(an); an.connect(mute); mute.connect(c.destination);
  const mic = {
    an, sr: c.sampleRate,
    close() {
      try { src.disconnect(); an.disconnect(); mute.disconnect(); } catch {}
      stream.getTracks().forEach((t) => t.stop());
      if (activeMic === mic) activeMic = null;
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    },
  };
  if (activeMic) activeMic.close();
  activeMic = mic;
  return mic;
}

// 목소리 높이(Hz)를 YIN 방식으로 찾는다(de Cheveigné & Kawahara 2002). 2:1로 줄여 계산을 덜고 70~600Hz만 본다. 못 찾으면 0
function pitchOf(x, sr) {
  const n = x.length >> 1; const y = new Float32Array(n); const fs = sr / 2;
  for (let i = 0; i < n; i++) y[i] = (x[2 * i] + x[2 * i + 1]) / 2;
  const lo = Math.max(2, Math.floor(fs / 600)); const hi = Math.min(Math.ceil(fs / 70), (n >> 1) - 1);
  const w = n - hi - 1;
  const d = new Float32Array(hi + 2);
  for (let tau = 1; tau <= hi + 1; tau++) { let s = 0; for (let i = 0; i < w; i++) { const v = y[i] - y[i + tau]; s += v * v; } d[tau] = s; }
  const cm = new Float32Array(hi + 2); cm[0] = 1; let sum = 0;
  for (let tau = 1; tau <= hi + 1; tau++) { sum += d[tau]; cm[tau] = sum ? (d[tau] * tau) / sum : 1; }
  for (let tau = lo; tau <= hi; tau++) {
    if (cm[tau] < 0.2) {
      while (tau < hi && cm[tau + 1] < cm[tau]) tau++;
      const a = cm[tau - 1]; const b = cm[tau]; const c = cm[tau + 1];
      const den = a - 2 * b + c; const p = den ? (a - c) / (2 * den) : 0;
      return fs / (tau + Math.max(-1, Math.min(1, p)));
    }
  }
  return 0;
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const pctl = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const sdOf = (a) => { if (a.length < 2) return 0; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)); };
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const VOICE_OVER = 12; // 방 소음보다 이만큼(dB) 크면 목소리로 본다
const AAH_SOFT = 18;   // 방 소음보다 이만큼 크지 않으면 '작아요'

// 25ms마다 크기(dB)와 높이(Hz)를 재서 모은다. 목소리가 나오다 quiet ms 동안 그치거나 max ms가 지나면 멈춘다.
// 처음 0.2초는 방 소음을 잰다. onFrame(f, room): 화면에 바로 보여 줄 때
function captureVoice(mic, { max = 6000, quiet = 700, wait = 5000, onFrame }) {
  const buf = new Float32Array(mic.an.fftSize);
  const frames = []; const t0 = performance.now();
  let room = null; let on = null; let last = 0; let run = 0; let stop = false;
  const done = new Promise((res) => {
    const id = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      mic.an.getFloatTimeDomainData(buf);
      let s = 0; let pk = 0;
      for (let i = 0; i < buf.length; i++) { s += buf[i] * buf[i]; const a = Math.abs(buf[i]); if (a > pk) pk = a; }
      const db = Math.max(-100, 10 * Math.log10(s / buf.length + 1e-12));
      // 방 소음: 처음 0.2초의 평균, 그 뒤로는 더 조용한 순간이 오면 내린다. 마이크가 막 켜질 때의 빈 소리(-85dB 아래)는 뺀다.
      // 처음부터 말해도 놓치지 않게 -50dB를 넘지 않고, 아주 작은 잡음까지 목소리로 보지 않게 -75dB 아래로 내리지 않는다
      if (db > -85) {
        if (t < 0.2 || room == null) room = room == null ? db : (room + db) / 2;
        else if (db < room) room = (room * 3 + db) / 4;
      }
      room = Math.max(-75, Math.min(room ?? -60, -50));
      const voiced = t >= 0.2 && db > room + VOICE_OVER;
      const f = { t, db, pk, hz: voiced ? pitchOf(buf, mic.sr) : 0, v: voiced };
      frames.push(f);
      if (voiced) { run++; last = t; if (on == null && run >= 3) on = t - 0.05; } else run = 0;
      if (onFrame) onFrame(f, room);
      const end = stop || t * 1000 >= max || (on != null && (t - last) * 1000 >= quiet) || (on == null && t * 1000 >= wait);
      if (end) { clearInterval(id); res({ frames, room, heard: on != null }); }
    }, 25);
  });
  return { done, stop() { stop = true; } };
}

// '아—' 한 번: 목소리가 이어진 가장 긴 구간의 길이, 크기·높이가 얼마나 고른지, 크기가 알맞은지
function analyzeAah({ frames, room }) {
  const segs = []; let cur = null;
  for (const f of frames) {
    if (!f.v) continue;
    if (cur && f.t - cur.end <= 0.15) { cur.end = f.t; cur.fs.push(f); } // 0.15초 안의 짧은 끊김은 이어진 것으로 본다
    else segs.push(cur = { start: f.t, end: f.t, fs: [f] });
  }
  const seg = segs.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  if (!seg || seg.fs.length < 4) return null;
  const dur = Math.round((seg.end - seg.start + 0.04) * 10) / 10;
  const mid = seg.fs.filter((f) => f.t >= seg.start + 0.25 && f.t <= seg.end - 0.15); // 시작과 끝은 빼고 본다
  const body = mid.length >= 6 ? mid : seg.fs;
  const sdDb = Math.round(sdOf(body.map((f) => f.db)) * 10) / 10;
  const hzs = body.map((f) => f.hz).filter(Boolean);
  const hz = Math.round(median(hzs)) || null;
  const sts = hz ? hzs.map((h) => 12 * Math.log2(h / hz)).filter((s) => Math.abs(s) < 6) : []; // 한 옥타브씩 튀는 것은 잘못 잰 것
  const sdSt = sts.length >= 6 ? Math.round(sdOf(sts) * 10) / 10 : null;
  const level = median(body.map((f) => f.db));
  const soft = level - room < AAH_SOFT;
  const loud = body.filter((f) => f.pk >= 0.98).length > body.length * 0.05; // 마이크에서 소리가 찢어진다
  const checks = { long: dur >= AAH_SEC, even: sdDb <= 3.5, steady: sdSt == null || sdSt <= 1.5, size: !soft && !loud };
  const score = Math.round(100 * (0.4 * clamp01(dur / AAH_SEC) + 0.2 * clamp01((6 - sdDb) / 2.5) + 0.2 * (sdSt == null ? 1 : clamp01((3 - sdSt) / 1.5)) + 0.2 * (checks.size ? 1 : 0)));
  return { dur, sdDb, sdSt, hz, soft, loud, checks, ok: Object.values(checks).every(Boolean), score, seg };
}

// 말끝 높낮이: 마지막 0.25초(끝 음절)가 앞부분보다 반음 몇 개만큼 올라갔는지. 목소리 높이는 사람마다 달라서 그 사람의 가운데 높이를 0으로 둔다
function analyzeTune({ frames }) {
  const v = frames.filter((f) => f.v && f.hz);
  if (v.length < 8) return null;
  const mid0 = median(v.map((f) => f.hz));
  let pts = v.map((f) => ({ t: f.t, st: 12 * Math.log2(f.hz / mid0) })).filter((p) => Math.abs(p.st) < 9);
  pts = pts.map((p, i) => ({ t: p.t, st: median(pts.slice(Math.max(0, i - 2), i + 3).map((q) => q.st)) })); // 다섯 점 가운데값으로 다듬는다
  if (pts.length < 8) return null;
  const t0 = pts[0].t; const t1 = pts[pts.length - 1].t;
  const endFrom = t1 - 0.25;
  const end = pts.filter((p) => p.t >= endFrom).map((p) => p.st);
  let mid = pts.filter((p) => p.t >= t0 + 0.2 * (t1 - t0) && p.t < t1 - 0.35).map((p) => p.st);
  if (mid.length < 3) mid = pts.filter((p) => p.t < endFrom).map((p) => p.st);
  if (mid.length < 3 || !end.length) return null;
  const base = median(mid);
  return { pts, endFrom, base, delta: Math.round((pctl(end, 0.8) - base) * 10) / 10 };
}

/* ---------- 발음 견주기 ---------- */

const jamo = (t) => [...t].flatMap((ch) => decompose(ch)?.filter(Boolean) || [ch]);
const plain = (t) => t.replace(/[\s.,!?~'"“”‘’·]/g, '');
// 요즘 말에서 같게 소리 나는 모음은 하나로 친다
const VOWEL_SAME = { 'ㅔ': 'ㅐ', 'ㅖ': 'ㅒ', 'ㅞ': 'ㅙ', 'ㅚ': 'ㅙ' };
// 받침은 일곱 가지 소리로 난다(뒤에 모음이 와서 넘어갈 때는 빼고)
const FINAL_SOUND = { 'ㄲ': 'ㄱ', 'ㅋ': 'ㄱ', 'ㄳ': 'ㄱ', 'ㄺ': 'ㄱ', 'ㄵ': 'ㄴ', 'ㄶ': 'ㄴ', 'ㅅ': 'ㄷ', 'ㅆ': 'ㄷ', 'ㅈ': 'ㄷ', 'ㅊ': 'ㄷ', 'ㅌ': 'ㄷ', 'ㅎ': 'ㄷ',
  'ㄼ': 'ㄹ', 'ㄽ': 'ㄹ', 'ㄾ': 'ㄹ', 'ㅀ': 'ㄹ', 'ㄻ': 'ㅁ', 'ㅍ': 'ㅂ', 'ㅄ': 'ㅂ', 'ㄿ': 'ㅂ' };
// 음절마다 소리로 견줄 자모 [첫소리, 모음, 받침]. 한글이 아니면 그 글자
function soundKeys(s) {
  const ch = [...s];
  return ch.map((c, i) => {
    const j = decompose(c);
    if (!j) return c;
    const next = ch[i + 1] && decompose(ch[i + 1]);
    const linked = next && next[0] === 'ㅇ'; // 받침이 뒤 음절 첫소리로 넘어간다(연음)
    return [j[0], VOWEL_SAME[j[1]] || j[1], linked ? j[2] : FINAL_SOUND[j[2]] || j[2]];
  });
}
const keyStr = (k) => (Array.isArray(k) ? k.join('') : k);
// 두 배열의 편집 거리와 정렬. ops: [같음|바뀜|빠짐|더함, a의 자리, b의 자리](없으면 -1)
function align(a, b) {
  const m = a.length; const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const ops = []; let i = m; let j = n;
  while (i || j) {
    if (i && j && dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { ops.unshift([a[i - 1] === b[j - 1] ? 'same' : 'sub', i - 1, j - 1]); i--; j--; }
    else if (i && dp[i][j] === dp[i - 1][j] + 1) { ops.unshift(['del', i - 1, -1]); i--; }
    else { ops.unshift(['ins', -1, j - 1]); j--; }
  }
  return { dist: dp[m][n], ops };
}
const POS3 = ['초성', '중성', '종성'];
// 목표 말과 인식된 말을 견준다. score: 자모가 얼마나 같은지(0~100)
// syl: 음절마다 {t: 목표, h: 들린 것, st: same 같음 | near 한두 자모만 다름 | miss 다르거나 빠짐 | extra 더 들림, dirs: [{pos, want, got}]}
// diffs: 다르게 들린 소리 '초성 ㅅ↔ㅆ'(아예 다른 말로 들렸으면 비워 둔다)
function judge(target, heard) {
  const a = [...plain(target)]; const b = [...plain(heard)];
  const ka = soundKeys(a.join('')); const kb = soundKeys(b.join(''));
  const flat = (ks) => ks.flatMap((k) => (Array.isArray(k) ? k.filter(Boolean) : [k]));
  const ja = flat(ka);
  const score = Math.max(0, Math.round(100 * (1 - align(ja, flat(kb)).dist / Math.max(ja.length, 1))));
  const { ops } = align(ka.map(keyStr), kb.map(keyStr));
  const syl = ops.map(([op, i, j]) => {
    const t = i >= 0 ? a[i] : ''; const h = j >= 0 ? b[j] : '';
    if (op === 'same') return { t, h, i, st: 'same', dirs: [] };
    if (op === 'ins') return { t, h, i, st: 'extra', dirs: [] };
    if (op === 'del') return { t, h, i, st: 'miss', dirs: [] };
    const x = ka[i]; const y = kb[j];
    const dirs = Array.isArray(x) && Array.isArray(y) ? [0, 1, 2].filter((k) => x[k] !== y[k]).map((k) => ({ pos: POS3[k], want: x[k], got: y[k] })) : [];
    return { t, h, i, st: dirs.length && dirs.length <= 2 ? 'near' : 'miss', dirs };
  });
  const diffs = [];
  if (score >= 50) for (const s of syl) if (s.st === 'near') for (const d of s.dirs) { const c = contrastKey(d); if (!diffs.includes(c)) diffs.push(c); }
  return { score, syl, diffs, heard };
}
const contrastKey = ({ pos, want, got }) => `${pos} ${[want || '없음', got || '없음'].sort().join('↔')}`;

// 목표 말을 음절 칸으로: 맞음은 초록, 한두 자모만 다르면 노랑(아래에 들린 음절), 빠졌거나 아예 다르면 밤색
function sylGrid(target, syl) {
  const gaps = new Set(); let k = 0; // 띄어쓰기 자리
  for (const ch of target.replace(/[.,!?~'"“”‘’·]/g, '')) { if (/\s/.test(ch)) gaps.add(k); else k++; }
  return `<span class="syl-grid">${syl.map((s) => {
    const gap = s.i >= 0 && gaps.has(s.i) ? ' gap' : '';
    if (s.st === 'extra') return `<span class="syl extra${gap}"><b>+</b><small>${esc(s.h)}</small></span>`;
    const under = s.st === 'same' ? '&nbsp;' : s.h ? esc(s.h) : '빠짐';
    return `<span class="syl ${s.st}${gap}"><b>${esc(s.t)}</b><small>${under}</small></span>`;
  }).join('')}</span>`;
}

/* ---------- 발음 요령 ---------- */

const LAX = 'ㄱㄷㅂㅈㅅ'; const TENSE = 'ㄲㄸㅃㅉㅆ'; const ASP = 'ㅋㅌㅍㅊ';
const PLACE = { 'ㅂ': 'lips', 'ㅃ': 'lips', 'ㅍ': 'lips', 'ㅁ': 'lips', 'ㄷ': 'tip', 'ㄸ': 'tip', 'ㅌ': 'tip', 'ㄴ': 'tip', 'ㄹ': 'tip', 'ㅅ': 'sib', 'ㅆ': 'sib',
  'ㅈ': 'pal', 'ㅉ': 'pal', 'ㅊ': 'pal', 'ㄱ': 'back', 'ㄲ': 'back', 'ㅋ': 'back', 'ㅎ': 'throat' };
const PLACE_TIP = {
  lips: 'ㅂ·ㅃ·ㅍ·ㅁ은 두 입술을 붙였다 떼요. 거울을 보며 입술이 닫히는지 확인해 보세요.',
  tip: 'ㄷ·ㄸ·ㅌ·ㄴ은 혀끝을 윗니 뒤 잇몸에 붙였다 떼요.',
  sib: 'ㅅ·ㅆ은 혀를 붙이지 않고 윗니 뒤 좁은 틈으로 바람을 "스" 하고 흘려요.',
  pal: 'ㅈ·ㅉ·ㅊ은 혀 앞쪽을 입천장에 넓게 붙였다가 바람과 함께 떼요.',
  back: 'ㄱ·ㄲ·ㅋ은 혀 뒤쪽을 입천장 안쪽에 붙였다 떼요. 입술과 혀끝은 쓰지 않아요.',
  throat: 'ㅎ은 입김을 "하" 하고 목에서 먼저 내보내요.',
};
const NASAL_TIP = 'ㅁ·ㄴ은 코로 울리는 소리예요. 코를 살짝 잡고 말해 보면 ㅁ·ㄴ에서만 코가 떨려요.';
const LIQUID_TIP = 'ㄹ은 혀끝으로 윗잇몸을 가볍게 한 번 튕겨요.';
const eun = (j) => j + ('ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'.includes(j) ? '는' : '은'); // 자모 이름은 자음이면 받침으로 끝난다(기역, 니은…)
function onsetTip(want, got) {
  if (!want || want === 'ㅇ') return got === 'ㅎ' ? '모음으로 바로 시작해요. 입김이 먼저 새지 않게 해요.' : '모음으로 바로 시작해요. 앞에 다른 소리가 붙지 않게 해요.';
  if (!got || got === 'ㅇ') return `첫소리 ${want}을 빠뜨리지 말고 또렷하게 시작해요. ${want === 'ㄹ' ? LIQUID_TIP : PLACE_TIP[PLACE[want]] || ''}`.trim();
  if ((want === 'ㄴ' && got === 'ㄹ') || (want === 'ㄹ' && got === 'ㄴ')) return `${LIQUID_TIP} ㄴ은 혀끝을 붙인 채 코로 소리를 울려요.`;
  if (want === 'ㄹ' || got === 'ㄹ') return want === 'ㄹ' ? LIQUID_TIP : PLACE_TIP[PLACE[want]] || null;
  if ('ㅁㄴ'.includes(want) !== 'ㅁㄴ'.includes(got) && PLACE[want] === PLACE[got]) return NASAL_TIP;
  if (PLACE[want] === PLACE[got]) {
    const asp = [want, got].find((j) => ASP.includes(j)); const tense = [want, got].find((j) => TENSE.includes(j)); const lax = [want, got].find((j) => LAX.includes(j));
    if (asp) return `${eun(asp)} 숨을 "훅" 세게 내보내요. 입 앞에 휴지를 대고 말하면 휴지가 크게 흔들려야 해요.${tense ? ` ${eun(tense)} 숨을 거의 내보내지 않아요.` : ''}`;
    if (tense && lax) return tense === 'ㅆ' ? 'ㅆ은 혀와 목에 힘을 주고 바람을 세고 날카롭게, ㅅ은 힘을 빼고 부드럽게 내요.'
      : `${eun(tense)} 목과 혀에 힘을 꽉 주고 짧고 단단하게, ${eun(lax)} 힘을 빼고 부드럽게 내요.`;
  }
  if (PLACE[want] === 'sib' || PLACE[got] === 'sib') return PLACE_TIP.sib + (PLACE[want] === 'sib' ? '' : ` ${PLACE_TIP[PLACE[want]] || ''}`);
  return PLACE_TIP[PLACE[want]] || null;
}
const ROUND = 'ㅗㅜㅛㅠ'; const UNROUND = 'ㅓㅡㅕ';
function vowelTip(want, got) {
  const pair = [want, got].sort().join('');
  if (pair === 'ㅗㅜ') return 'ㅗ는 입을 조금 더 벌려 동그랗게, ㅜ는 입술을 작게 오므려 앞으로 내밀어요.';
  if ((ROUND.includes(want) && UNROUND.includes(got)) || (UNROUND.includes(want) && ROUND.includes(got))) return 'ㅗ·ㅜ는 입술을 동그랗게 앞으로 내밀어요. ㅓ·ㅡ는 입술을 둥글리지 않아요.';
  if (pair === 'ㅏㅓ') return 'ㅏ는 입을 크게 벌리고, ㅓ는 턱을 조금만 내리고 입술은 편하게 둬요.';
  if (pair === 'ㅡㅣ') return 'ㅣ는 입꼬리를 옆으로 당기고, ㅡ는 입술을 편 채 혀를 조금 뒤로 당겨요.';
  const y = [want, got].find((j) => 'ㅑㅕㅛㅠㅒㅖ'.includes(j));
  if (y) return `${eun(y)} "이"에서 시작해 빠르게 미끄러지듯 소리 내요.`;
  const w = [want, got].find((j) => 'ㅘㅝㅙㅞㅚㅟ'.includes(j));
  if (w) return `${eun(w)} 입술을 동그랗게 했다가 빠르게 펴면서 소리 내요.`;
  if (want === 'ㅢ' || got === 'ㅢ') return 'ㅢ는 "으"에서 "이"로 빠르게 옮겨 가요.';
  if (pair === 'ㅏㅐ' || pair === 'ㅐㅓ') return 'ㅐ는 ㅏ·ㅓ보다 입을 덜 벌리고 혀를 앞으로 내밀어요.';
  return '거울을 보며 입 모양을 천천히 따라 해 보세요.';
}
const FINAL_TIP = { 'ㅁ': '입술을 닫고 끝내요', 'ㄴ': '혀끝을 윗잇몸에 붙이고 끝내요', 'ㅇ': '혀 뒤를 올리고 코로 "응" 하고 끝내요',
  'ㄹ': '혀끝을 윗잇몸에 댄 채 소리를 혀 옆으로 흘려요', 'ㄱ': '혀 뒤로 막고 소리를 터뜨리지 않고 끝내요',
  'ㄷ': '혀끝으로 막고 소리를 터뜨리지 않고 끝내요', 'ㅂ': '입술을 닫아 막고 소리를 터뜨리지 않고 끝내요' };
const finalHow = (j) => (FINAL_TIP[j] ? `받침 ${j}은 ${FINAL_TIP[j]}.` : '받침을 끝까지 또렷하게 소리 내요.');
function codaTip(want, got) {
  if (!got) return `받침 ${want}을 빠뜨리지 말고 끝까지 내요. 받침이 빠지면 다른 말이 돼요. ${FINAL_TIP[want] ? `${want}은 ${FINAL_TIP[want]}.` : ''}`.trim();
  if (!want) return '받침 없이 모음으로 끝내요.';
  const nasal = 'ㅁㄴㅇ'; const stop = 'ㅂㄷㄱ';
  if (nasal.includes(want) && nasal.includes(got)) return 'ㅁ 받침은 입술을 닫고, ㄴ 받침은 혀끝을 윗잇몸에 붙이고, ㅇ 받침은 입을 연 채 혀 뒤를 올려 끝내요.';
  if (stop.includes(want) && stop.includes(got)) return 'ㅂ 받침은 입술로, ㄷ 받침은 혀끝으로, ㄱ 받침은 혀 뒤로 막고 끝내요.';
  if ((nasal + stop).includes(want) && (nasal + stop).includes(got) && nasal.includes(want) !== nasal.includes(got)) return '받침 ㅁ·ㄴ·ㅇ은 코로 울리며 끝나고, ㅂ·ㄷ·ㄱ은 소리를 막고 끝나요.';
  return FINAL_TIP[want] ? finalHow(want) : onsetTip(want, got) || finalHow(want); // 뒤 음절로 넘어가는 받침은 첫소리처럼 난다
}
// 다르게 들린 소리 하나에 맞는 발음 요령. want: 내야 할 소리, got: 들린 소리('': 없음)
function sayTip({ pos, want, got }) {
  return (pos === '초성' ? onsetTip(want, got) : pos === '중성' ? vowelTip(want, got) : codaTip(want, got)) || null;
}
// '초성 ㅅ↔ㅆ'처럼 방향이 없는 기록에서: 없음이 아닌 쪽을 내야 할 소리로 본다
function tipOfKey(c) {
  const [pos, pair] = c.split(' '); const [x, y] = pair.split('↔').map((j) => (j === '없음' ? '' : j));
  return sayTip(x ? { pos, want: x, got: y } : { pos, want: y, got: x });
}

/* ---------- 음성 인식과 녹음 ---------- */

let activeRec = null;
function listenOnce() {
  return new Promise((res, rej) => {
    const r = new Recognition();
    r.lang = 'ko-KR'; r.interimResults = false; r.maxAlternatives = 5; r.continuous = false;
    let done = false;
    r.onresult = (e) => { done = true; res([...e.results[0]].map((x) => x.transcript.trim()).filter(Boolean)); };
    r.onerror = (e) => { done = true; rej(e.error || 'error'); };
    r.onend = () => { activeRec = null; if (!done) res([]); };
    activeRec = r;
    r.start();
  });
}

// 따라 말하기 녹음(음성 인식이 없는 브라우저용). 목소리가 없으면 null
async function recordClip(ms) {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { toast('마이크를 쓸 수 없어요. 브라우저 설정에서 마이크를 허용해 주세요.'); return null; }
  const rec = new MediaRecorder(stream); const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise((r) => { rec.onstop = r; });
  rec.start(); setTimeout(() => rec.state === 'recording' && rec.stop(), ms);
  await done; stream.getTracks().forEach((t) => t.stop());
  const blob = new Blob(chunks, { type: rec.mimeType });
  const peak = await peakLevel(blob);
  if (peak != null && peak < 0.02) { toast('목소리가 들리지 않았어요. 다시 녹음해 주세요.'); return null; }
  return blob;
}

/* ---------- 본보기 소리 ---------- */

// '아—' 본보기: 고른 높이와 크기로 2.5초
function playAahModel() {
  return playBuffer(voiceBuffer(audio(), { dur: 2.5, f0: () => 190, res: LING[0].f }));
}
// 말끝 본보기: 음절 수만큼 '아아아' 하고, 묻는 말은 끝 음절을 반음 7개쯤 올리고 대답은 반음 4개쯤 내린다
function playTuneModel(text, up) {
  const n = Math.max(2, plain(text).length); const dur = Math.min(2.4, 0.2 * n + 0.15);
  const last = 1 - 1 / n;
  const f0 = (p) => { const b = 190 * (1 - 0.06 * p); if (p < last) return b; const q = (p - last) / (1 - last); return b * (up ? 1 + 0.5 * Math.pow(q, 1.3) : 1 - 0.22 * q); };
  const c = audio(); const buf = voiceBuffer(c, { dur, f0, res: LING[0].f });
  const d = buf.getChannelData(0); const sr = buf.sampleRate;
  for (let i = 0; i < d.length; i++) { const p = (i / sr / dur) * n; const k = p - Math.floor(p); d[i] *= 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, k * 1.15)); } // 음절마다 살짝 끊어지게
  return playBuffer(buf);
}

/* ---------- 약한 소리 ---------- */

// 말할 때 자주 다르게 들린 소리(많은 것부터)
const speakWeakTop = (n, d = data) => Object.entries(d.speakConf || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
// 그 소리가 든 낱말: 헷갈리는 낱말 묶음에서 그 소리만 다른 짝을 먼저, 모자라면 그 소리가 든 쉬운 낱말을 더한다
function weakSpeakWords() {
  const top = speakWeakTop(3); const words = new Set();
  for (const [c] of top) for (const g of WORD_SETS[3]) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    if (contrasts(g[i], g[j]).includes(c)) { words.add(g[i]); words.add(g[j]); }
  }
  for (const [c] of top) {
    if (words.size >= 12) break;
    const [pos, pair] = c.split(' '); const k = POS3.indexOf(pos); const js = pair.split('↔').filter((j) => j !== '없음');
    for (const w of [...WORD_SETS[1], ...WORD_SETS[2]].flat()) if ([...w].some((ch) => js.includes(decompose(ch)?.[k]))) words.add(w);
  }
  return [...words];
}

/* ---------- 말하기 연습 화면 ---------- */

const speakRuns = (mode, d = data) => (d.speakLog || []).filter((x) => x.mode === mode);
function renderSpeakHome() {
  setNav('learn');
  const card = (k) => {
    const m = SPEAK_MODES[k]; const runs = speakRuns(k); const last = runs[runs.length - 1];
    const sub = !runs.length ? `${SPEAK_N}개, 2~3분`
      : k === 'aah' ? `${runs.length}번 했어요 · 가장 길게 ${Math.max(...runs.map((r) => r.best || 0))}초`
      : `${runs.length}번 했어요 · 최근 ${last.good}/${last.n}`;
    return `
      <button class="report-link focus-cat" data-go="#speak/${k}">
        <span class="cat-ico" aria-hidden="true">${m.icon}</span>
        <span><b>${m.name}</b><small>${m.about}</small><small>${sub}</small></span>
      </button>`;
  };
  const sayModes = ['word', 'pair', 'sentence', ...(speakWeakTop(1).length ? ['weak'] : []), 'order'];
  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow">말하기 연습</p>
      <h1>듣기만큼 말하기도 연습해요</h1>
      <p class="lead">발음은 음성 인식으로 음절과 자모 하나하나까지 견주고, 목소리 크기·길이와 말끝 높낮이는 마이크 소리로 바로 재요.</p>
    </header>
    <h2 class="section-title">발음 <span>따라 말하기</span></h2>
    ${Recognition ? '' : `<p class="note warn">${canMic() ? '이 브라우저는 음성 인식이 없어 녹음해서 정답과 견줘 들어요. 크롬이나 사파리에서는 발음을 자동으로 확인해 드려요.' : '이 화면에서는 마이크를 쓸 수 없어요. 크롬이나 사파리에서 앱 주소를 열어 주세요.'}</p>`}
    <div class="focus-cats">${sayModes.map(card).join('')}</div>
    <h2 class="section-title">목소리 <span>크기와 길이</span></h2>
    <div class="focus-cats">${card('aah')}</div>
    <h2 class="section-title">억양 <span>말끝 높낮이</span></h2>
    <div class="focus-cats">${card('tune')}</div>
    ${canMic() ? '' : '<p class="note warn">이 화면에서는 마이크를 쓸 수 없어 목소리와 억양은 연습할 수 없어요.</p>'}
    ${speakPanel(false)}
    <p class="note center">지도의 말하기 칸(1-5, 2-5, 3-5, 4-5, 5-5)도 같은 방식으로 확인해요. 음성 인식과 마이크 측정은 참고용이에요.</p>
    <button class="btn ghost block" data-go="#learn">지도로</button>`;
}

// cellId: 지도의 말하기 칸으로 들어왔으면 그 칸의 방식으로 하고 칸 통과에 센다. modeKey: 말하기 연습 화면에서 고른 것
async function renderSpeak(cellId, modeKey) {
  setNav('play');
  const token = ++playToken;
  const alive = () => token === playToken;
  const cell = cellId ? CELL[cellId] : null;
  let mode = cell ? cell.mode : SPEAK_MODES[modeKey] ? modeKey : 'word';
  if (mode === 'weak' && weakSpeakWords().length < 3) mode = 'pair';
  const m = SPEAK_MODES[mode];
  const inRun = !!todayRun && todayRun.queue[todayRun.i] === current;
  const back = inRun ? '#learn' : cell ? `#ch/${cell.ch}` : '#speak';
  const canRec = !!(navigator.mediaDevices && window.MediaRecorder);
  const useAsr = m.kind === 'say' && !!Recognition;
  const ready = m.kind === 'say' ? useAsr || canRec : canMic();
  const intro = {
    say: ['들은 말을 따라 말해 보세요', useAsr ? '말한 것을 음성 인식으로 받아 적어 음절과 자모 하나하나까지 견줘 드려요.' : '녹음해서 정답과 내 목소리를 나란히 들어 볼 수 있어요.'],
    voice: ['"아—" 소리를 길게 내 보세요', `숨을 크게 들이쉬고 편한 높이로 ${AAH_SEC}초 넘게, 고른 크기로 내요. 휴대폰은 입에서 한 뼘쯤 떨어뜨려요.`],
    tune: ['말끝을 올리고 내려 보세요', '같은 말도 끝을 올리면 묻는 말, 내리면 대답하는 말이 돼요. 목소리 높낮이를 그래프로 보여 드려요.'],
  }[m.kind];
  const hint = m.noise ? `${intro[1]} 카페 소음 속에서 듣고, 소음이 깔린 채로 말해요.` : intro[1];
  const notes = m.kind === 'say'
    ? (useAsr ? '<p class="note center">처음 한 번은 마이크 사용을 허락해 주세요. 음성 인식 결과라 참고용이에요.</p>'
      : canRec ? '<p class="note warn center">이 브라우저는 음성 인식이 없어 녹음해서 비교하는 방식으로 연습해요. 크롬이나 사파리에서는 발음을 자동으로 확인해 드려요.</p>' : '')
    : '<p class="note center">처음 한 번은 마이크 사용을 허락해 주세요. 목소리는 이 기기 안에서만 재고 저장하지 않아요.</p>';
  view.innerHTML = playShell(back, cell ? `${cell.id} · ${cell.name}` : `${SPEAK_KIND[m.kind]} · ${m.name}`, intro[0], hint,
    ready ? `${cell ? `<p class="note center">${passHint(cell)}.</p>` : ''}${startBox(inRun, notes)}`
      : `<p class="note warn center">이 화면에서는 마이크를 쓸 수 없어요. 크롬이나 사파리에서 앱 주소를 열어 주세요.</p><button class="btn block" data-go="${back}">돌아가기</button>`);
  const $ = (q) => view.querySelector(q);
  $('#orb').innerHTML = ICON.mic2;
  $('#pnum').textContent = `${SPEAK_N}개`;
  $('#compare').hidden = false;
  if (!ready) return;
  await waitStart(inRun, alive);
  if (!alive()) return;
  const startedAt = Date.now();

  const orb = $('#orb');
  const setOrb = (s) => { orb.className = `orb ${s}`; };
  let busy = false;
  const playing = async (p) => { busy = true; setOrb('playing'); try { return await p; } finally { busy = false; if (alive()) setOrb('idle'); } };
  const step = (i) => { $('#pnum').textContent = `${i + 1}번째 / ${SPEAK_N}개`; $('#pbar').style.width = `${(100 * i) / SPEAK_N}%`; };
  const micErr = (e) => toast(e === 'not-allowed' || e === 'service-not-allowed' || e?.name === 'NotAllowedError' ? '마이크를 쓸 수 없어요. 브라우저 설정에서 마이크를 허용해 주세요.'
    : e === 'network' ? '음성 인식은 인터넷이 연결돼 있어야 해요.' : '다시 한 번 눌러 말해 주세요.');
  // 결과 시트: 다시 하기면 true. extra: [[이름, 들려주기]] 비교 버튼
  const sheet = (ok, title, text, extra) => new Promise((res) => {
    const sh = $('#sheet');
    sh.className = `sheet ${ok ? 'good' : 'bad'}`;
    sh.querySelector('.sheet-icon').innerHTML = ok ? ICON.check : ICON.mic2;
    $('#sheet-title').textContent = title;
    $('#sheet-text').innerHTML = text;
    $('#compare').innerHTML = `${extra.map(([label], k) => `<button class="pill" data-k="${k}">${ICON.speaker}${esc(label)}</button>`).join('')}<button class="pill" data-k="a">${ICON.mic2}다시 하기</button>`;
    sh.hidden = false;
    const end = (again) => { sh.hidden = true; res(again); };
    $('#compare').querySelectorAll('[data-k]').forEach((b) => {
      b.onclick = () => { if (b.dataset.k === 'a') end(true); else if (!busy) playing(extra[+b.dataset.k][1]()); };
    });
    $('#next').textContent = '다음';
    $('#next').onclick = () => end(false);
  });

  const out = m.kind === 'voice' ? await aahRound() : m.kind === 'tune' ? await tuneRound() : await sayRound();
  if (!out || !alive()) return;
  const { results, extra, conf = {} } = out;
  const good = results.filter((r) => r.ok).length;
  const avg = Math.round(results.reduce((a, r) => a + r.score, 0) / results.length);
  const wasDone = cell && cellState(cell) === 'done';
  data.speakLog.push({ date: today(), at: Date.now(), mode, n: results.length, score: avg, good, asr: useAsr, ...(m.kind === 'say' ? {} : { auto: true }),
    sec: Math.round((Date.now() - startedAt) / 1000), ...(cell ? { cell: cell.id } : {}), ...extra });
  for (const [k, v] of Object.entries(conf)) data.speakConf[k] = (data.speakConf[k] || 0) + v;
  persist();
  const judged = m.kind !== 'say' || useAsr;
  const status = !cell || !judged ? '' : !wasDone && cellState(cell) === 'done' ? `${cell.id} 칸을 통과했어요.` : wasDone ? '' : passHint(cell) + '.';
  const head = {
    say: useAsr ? `${SPEAK_N}개 중 ${good}개를 또렷하게 말했어요` : `${SPEAK_N}개를 녹음해 견줘 봤어요`,
    voice: `${SPEAK_N}번 중 ${good}번을 ${AAH_SEC}초 넘게 고르게 냈어요`,
    tune: `${SPEAK_N}개 중 ${good}개를 말끝까지 맞게 말했어요`,
  }[m.kind];
  const lead = m.kind === 'say' ? (useAsr ? `음성 인식이 알아들은 정도는 평균 ${avg}%예요.` : '')
    : m.kind === 'voice' ? `가장 길게 ${extra.best}초 냈어요.${extra.hz ? ` 목소리 높이는 ${extra.hz}Hz쯤이에요.` : ''}`
    : `묻는 말 ${extra.q[1]}개 중 ${extra.q[0]}개는 끝을 올렸고, 대답하는 말 ${extra.s[1]}개 중 ${extra.s[0]}개는 끝을 내렸어요.`;
  const acts = roundActions(back);
  const tips = Object.keys(conf).map((c) => [c, tipOfKey(c)]).filter(([, t]) => t);
  view.innerHTML = `
    <div class="play result">
      <p class="eyebrow center">${cell ? `${cell.id} · ${cell.name}` : `${SPEAK_KIND[m.kind]} · ${m.name}`}</p>
      <h1 class="q">${head}</h1>
      ${lead || status ? `<p class="lead center">${lead}${status ? ` ${status}` : ''}</p>` : ''}
      ${acts.ended ? `<p class="lead center">오늘의 연습 ${TODAY_N}판을 마쳤어요.</p>` : ''}
      <section class="panel"><ul class="speak-list">${results.map((r, i) => `<li><span>${esc(r.label)}</span><b class="${r.ok ? 'ok' : ''}">${esc(r.value)}</b>${r.play ? `<button class="icon-btn" data-r="${i}" aria-label="${esc(r.label)} 다시 듣기">${ICON.speaker}</button>` : ''}</li>`).join('')}</ul>
      ${tips.length ? `<div class="say-tips"><p class="note">다르게 들린 소리와 발음 요령</p>${tips.map(([c, t]) => `<p class="say-tip"><b>${esc(friendly(c))}</b> ${esc(t)}</p>`).join('')}</div>` : ''}</section>
      <div class="actions">${acts.html}</div>
    </div>`;
  acts.bind();
  view.querySelectorAll('[data-r]').forEach((b) => { b.onclick = () => results[+b.dataset.r].play(); });

  // 따라 말하기: 들려주고, 마이크 버튼을 누르면 듣고 견준다. 다시 하기를 누르면 같은 말로 다시
  async function sayRound() {
    const pool = m.items();
    const picks = [];
    for (let tries = 0; picks.length < SPEAK_N && tries < 300; tries++) {
      let w = pickHeard(pool); let focus = null;
      if (mode === 'pair') { const t = pickTailored(WORD_SETS[3], (x) => x); if (t.focus) { focus = t.focus; w = pickHeard(t.focus.pair); } }
      if (!picks.some((p) => p.w === w) || tries > 200) picks.push({ w, focus });
    }
    const listen = (w) => (m.noise ? withNoise(m.noise.id, m.noise.snr, () => playWord(w)) : playWord(w));
    const results = []; const conf = {};
    for (let i = 0; i < SPEAK_N && alive(); i++) {
      step(i);
      const { w, focus } = picks[i];
      let best = null;
      for (;;) {
        const r = await attempt(w, focus);
        if (!alive()) return null;
        if (r && (r.score == null || !best || r.score > best.score)) best = r; // 녹음 비교는 마지막 녹음을 쓴다
        if (!(await review(r, w))) break;
        if (!alive()) return null;
      }
      const score = (best && best.score) || 0;
      results.push({ label: w, score, ok: score >= 70, value: useAsr ? `${score}%` : score >= 70 ? '비슷해요' : '다시 연습', play: () => playWord(w) });
      if (best && best.diffs) for (const c of best.diffs) conf[c] = (conf[c] || 0) + 1;
    }
    return alive() ? { results, conf, extra: {} } : null;

    async function attempt(w, focus) {
      $('#sheet').hidden = true;
      $('#q').textContent = m.noise ? '소음 속에서 잘 듣고 따라 말해요' : '들은 말을 따라 말해 보세요';
      $('#hint').innerHTML = (focus ? `<span class="focus-tag">${ICON.target}맞춤 문제 · ${esc(friendly(focus.c))}</span>` : '') + `<button class="pill" id="replay">${ICON.speaker}다시 듣기</button>`;
      $('#replay').onclick = () => { if (!busy) playing(listen(w)); };
      const micLabel = useAsr ? '누르고 말하기' : '누르고 녹음하기';
      $('#answers').innerHTML = `<button class="btn primary block mic-btn" id="mic" disabled>${ICON.mic2}<span>잘 들어 보세요</span></button>
        <button class="btn ghost block" id="peek">글자 보기</button>`;
      $('#peek').onclick = () => { $('#q').textContent = w; $('#peek').hidden = true; };
      await playing(listen(w)); // 다 듣고 나서 말하게 한다
      if (!alive()) return null;
      $('#mic').disabled = false; $('#mic').lastChild.textContent = micLabel;
      for (;;) {
        await new Promise((r) => { $('#mic').onclick = r; });
        if (!alive()) return null;
        const mic = $('#mic'); mic.disabled = true; mic.classList.add('listening');
        setOrb('listening');
        let quiet = null; // 소음 속에서 주문하기는 말하는 동안에도 소음을 깐다
        if (m.noise) { const p = new Promise((r) => { quiet = r; }); withNoise(m.noise.id, m.noise.snr, () => p); }
        try {
          if (useAsr) {
            mic.lastChild.textContent = '듣고 있어요…';
            const alts = await listenOnce();
            if (!alts.length) { toast('목소리를 못 들었어요. 마이크 가까이에서 다시 말해 주세요.'); continue; }
            return alts.map((h) => judge(w, h)).sort((a, b) => b.score - a.score)[0];
          }
          mic.lastChild.textContent = '녹음 중…';
          const blob = await recordClip(w.length > 4 ? 5000 : 3000);
          if (!blob) continue;
          return { blob, score: null };
        } catch (e) {
          micErr(e);
        } finally {
          if (quiet) quiet();
          if (alive()) { setOrb('idle'); mic.disabled = false; mic.classList.remove('listening'); mic.lastChild.textContent = micLabel; }
        }
      }
    }

    // 결과: 목표 말을 음절 칸으로 보여 주고, 다르게 들린 소리의 발음 요령을 하나 알려 준다
    async function review(r, w) {
      if (r.score == null) {
        $('#q').textContent = w;
        const url = URL.createObjectURL(r.blob);
        const again = await sheet(true, '두 소리를 견줘 들어 보세요', '비슷하게 들리면 다음으로, 다르면 다시 녹음해 보세요.', [['정답 듣기', () => playWord(w)], ['내 목소리', () => playUrl(url)]]);
        URL.revokeObjectURL(url);
        if (!again) r.score = 100;
        return again;
      }
      $('#q').innerHTML = sylGrid(w, r.syl);
      const ok = r.score >= 70;
      const title = r.score >= 90 ? `정확해요 ${r.score}%` : ok ? `거의 맞았어요 ${r.score}%` : `다시 해 볼까요 ${r.score}%`;
      const dir = r.score >= 50 && r.syl.flatMap((s) => (s.st === 'near' ? s.dirs : []))[0];
      const tip = dir && sayTip(dir);
      const text = `들린 말: “${esc(r.heard)}”${r.diffs.length ? ` <span class="why">${r.diffs.map((c) => esc(friendly(c))).join(', ')}</span>` : ''}`
        + (tip ? `<span class="say-tip">${ICON.bulb}${esc(tip)}</span>` : '');
      return sheet(ok, title, text, [['정답 듣기', () => listen(w)]]);
    }
  }

  // 목소리: '아—'를 내는 동안 크기와 길이를 막대로 보여 주고, 끝나면 길이·고르기·크기를 알려 준다
  async function aahRound() {
    const results = []; let best = null;
    for (let i = 0; i < SPEAK_N && alive(); i++) {
      step(i);
      for (;;) {
        $('#sheet').hidden = true;
        $('#q').textContent = '"아—" 소리를 길게 내 보세요';
        $('#hint').innerHTML = `<button class="pill" id="model">${ICON.speaker}본보기 듣기</button>`;
        $('#model').onclick = () => { if (!busy) playing(playAahModel()); };
        $('#answers').innerHTML = `${meterHtml()}<button class="btn primary block mic-btn" id="mic">${ICON.mic2}<span>누르고 "아—"</span></button>`;
        if (i === 0 && !best) { await modelFirst(playAahModel); if (!alive()) return null; }
        const rec = await capture({ max: 10000, quiet: 500 });
        if (!alive()) return null;
        if (!rec) continue;
        const r = analyzeAah(rec);
        if (!r) { toast('목소리를 잘 못 들었어요. 마이크 가까이에서 "아—" 하고 길게 내 주세요.'); continue; }
        if (!best || r.score > best.score) best = r;
        const c = r.checks;
        const title = r.ok ? `잘했어요 ${r.dur}초` : !c.long ? `조금 더 길게 ${r.dur}초` : !c.size ? (r.loud ? '조금 작게 내 볼까요' : '조금 더 크게 내 볼까요') : `고르게 내 볼까요 ${r.dur}초`;
        const line = (ok, text) => `<li class="${ok ? 'ok' : 'bad'}">${ok ? ICON.check : ICON.x}${text}</li>`;
        const text = `<ul class="vchecks">
          ${line(c.long, `길이 ${r.dur}초${c.long ? '' : ` (${AAH_SEC}초 넘게)`}`)}
          ${line(c.even, c.even ? '크기가 고르게 이어졌어요' : '크기가 들쭉날쭉해요')}
          ${line(c.steady, r.sdSt == null ? '높이를 재지 못했어요' : c.steady ? '높이가 흔들리지 않았어요' : '높이가 흔들렸어요')}
          ${line(c.size, r.loud ? '너무 커서 소리가 찢어져요' : r.soft ? '소리가 작아요. 방 소음과 잘 구별되지 않아요' : '크기가 알맞아요')}
        </ul>${aahSvg(rec, r)}`;
        const again = await sheet(r.ok, title, text, [['본보기 듣기', playAahModel]]);
        if (!alive()) return null;
        if (again) continue;
        results.push({ label: `${i + 1}번째`, dur: r.dur, score: r.score, ok: r.ok, value: `${r.dur}초${r.ok ? '' : ` · ${!c.long ? '짧아요' : !c.size ? (r.loud ? '커요' : '작아요') : '들쭉날쭉'}`}` });
        break;
      }
    }
    if (!alive()) return null;
    return { results, extra: { best: Math.max(...results.map((r) => r.dur)), ...(best && best.hz ? { hz: best.hz } : {}) } };
  }

  // 억양: 묻는 말 3개, 대답하는 말 2개. 말끝 높낮이를 그래프로 보여 준다
  async function tuneRound() {
    const lines = shuffle(TUNE_LINES).slice(0, SPEAK_N); const ups = shuffle([true, true, true, false, false]);
    const results = []; const tally = { q: [0, 0], s: [0, 0] };
    for (let i = 0; i < SPEAK_N && alive(); i++) {
      step(i);
      const s = lines[i]; const up = ups[i];
      let first = true;
      for (;;) {
        $('#sheet').hidden = true;
        $('#q').textContent = `${s}${up ? '?' : '.'}`;
        $('#hint').innerHTML = `<span class="tune-tag ${up ? 'up' : 'down'}">${up ? ICON.up : ICON.down}${up ? '묻는 말 · 끝을 올려요' : '대답하는 말 · 끝을 내려요'}</span><button class="pill" id="model">${ICON.speaker}높낮이 듣기</button>`;
        $('#model').onclick = () => { if (!busy) playing(playTuneModel(s, up)); };
        $('#answers').innerHTML = `<button class="btn primary block mic-btn" id="mic">${ICON.mic2}<span>누르고 말하기</span></button>`;
        if (first) { first = false; await modelFirst(() => playTuneModel(s, up)); if (!alive()) return null; }
        const rec = await capture({ max: 5000, quiet: 700 });
        if (!alive()) return null;
        if (!rec) continue;
        const r = analyzeTune(rec);
        if (!r) { toast('목소리 높낮이를 잘 못 들었어요. 조금 더 크고 길게 말해 주세요.'); continue; }
        const ok = up ? r.delta >= TUNE_UP : r.delta <= TUNE_FLAT;
        const amt = `반음 ${Math.abs(r.delta).toFixed(1)}개만큼 ${r.delta >= 0 ? '올라갔어요' : '내려갔어요'}`;
        const title = ok ? (up ? '끝이 올라갔어요' : '끝이 내려갔어요') : up ? '끝을 조금 더 올려 볼까요' : '끝을 내려 볼까요';
        const text = `말끝이 앞부분보다 ${amt}.${ok ? '' : up ? ' 마지막 글자에서 목소리를 쭉 올려요.' : ' 마지막 글자에서 목소리를 편하게 내려요.'}${tuneSvg(r, up)}`;
        const again = await sheet(ok, title, text, [['본보기 높낮이', () => playTuneModel(s, up)]]);
        if (!alive()) return null;
        if (again) continue;
        const score = ok ? 100 : Math.round(65 * clamp01(up ? (r.delta + 2) / (TUNE_UP + 2) : (5 - r.delta) / (5 - TUNE_FLAT)));
        const t = tally[up ? 'q' : 's']; t[1]++; if (ok) t[0]++;
        results.push({ label: `${s}${up ? '?' : '.'}`, score, ok, value: `${r.delta >= 0 ? '↗' : '↘'} ${r.delta >= 0 ? '+' : ''}${r.delta}`, play: () => playTuneModel(s, up) });
        break;
      }
    }
    return alive() ? { results, extra: tally } : null;
  }

  // 본보기를 먼저 들려준다. 다 들을 때까지 마이크 버튼은 잠가 둔다
  async function modelFirst(play) {
    const btn = $('#mic'); const label = btn.lastChild.textContent;
    btn.disabled = true; btn.lastChild.textContent = '잘 들어 보세요';
    await playing(play());
    if (alive()) { btn.disabled = false; btn.lastChild.textContent = label; }
  }

  // 마이크를 켜고 목소리를 한 번 잰다. 버튼을 다시 누르면 멈춘다. 못 들었거나 마이크를 못 쓰면 null
  async function capture(opt) {
    await new Promise((r) => { $('#mic').onclick = r; });
    if (!alive()) return null;
    const btn = $('#mic'); const label = btn.lastChild.textContent;
    btn.classList.add('listening'); btn.lastChild.textContent = '마이크 켜는 중…';
    let mic;
    try { mic = await openMic(); } catch (e) { micErr(e); btn.classList.remove('listening'); btn.lastChild.textContent = label; return null; }
    if (!alive()) { mic.close(); return null; }
    setOrb('listening'); btn.lastChild.textContent = '듣고 있어요 · 누르면 멈춰요';
    const lv = $('#vm-lv'); const len = $('#vm-len'); const sec = $('#vm-sec');
    let segStart = null; let lastV = 0;
    const cap = captureVoice(mic, { ...opt, onFrame: (f, room) => {
      if (lv) { lv.style.width = `${Math.round(100 * clamp01((f.db - room) / 45))}%`; lv.classList.toggle('low', f.v && f.db - room < AAH_SOFT); lv.classList.toggle('hot', f.pk >= 0.98); }
      if (f.v) { if (segStart == null || f.t - lastV > 0.15) segStart = f.t; lastV = f.t; }
      if (len && segStart != null) { const d = lastV - segStart; len.style.width = `${Math.round(100 * clamp01(d / (AAH_SEC * 1.5)))}%`; len.classList.toggle('done', d >= AAH_SEC); sec.textContent = `${d.toFixed(1)}초`; }
    } });
    btn.onclick = () => cap.stop();
    const rec = await cap.done;
    mic.close();
    if (alive()) { setOrb('idle'); btn.classList.remove('listening'); btn.lastChild.textContent = label; }
    if (!rec.heard) { if (alive()) toast('목소리를 못 들었어요. 마이크 가까이에서 다시 해 주세요.'); return null; }
    return rec;
  }
}

// '아—'를 내는 동안 보여 줄 크기와 길이 막대. 크기 막대의 밝은 칸이 알맞은 크기(방 소음보다 18dB 넘게, 막대의 40%부터)
const meterHtml = () => `
  <div class="vmeter" aria-hidden="true">
    <div class="vm-row"><span>크기</span><span class="vm-bar"><em class="vm-zone"></em><i id="vm-lv"></i></span></div>
    <div class="vm-row"><span>길이</span><span class="vm-bar"><em class="vm-goal"></em><i id="vm-len"></i></span><b id="vm-sec">0.0초</b></div>
  </div>`;

// '아—' 한 번의 크기(위)와 높이(아래) 그래프. 점선은 2초
function aahSvg(rec, r) {
  const W = 300; const H = 96; const P = 6;
  const fs = rec.frames.filter((f) => f.t >= r.seg.start - 0.2 && f.t <= r.seg.end + 0.2);
  if (fs.length < 4) return '';
  const t0 = fs[0].t; const span = Math.max(AAH_SEC + 0.5, fs[fs.length - 1].t - t0);
  const x = (t) => (P + ((t - t0) / span) * (W - 2 * P)).toFixed(1);
  const lvY = (db) => (P + (1 - clamp01((db - rec.room) / 45)) * (H / 2 - P)).toFixed(1);
  const hzs = fs.filter((f) => f.hz && f.v);
  const hy = (hz) => (H / 2 + P + (1 - clamp01((12 * Math.log2(hz / (r.hz || hz)) + 3) / 6)) * (H / 2 - 2 * P)).toFixed(1);
  const xg = x(r.seg.start + AAH_SEC);
  return `<svg class="vtrace" viewBox="0 0 ${W} ${H}" role="img" aria-label="소리 크기와 높이 그래프">
    <line x1="${xg}" x2="${xg}" y1="0" y2="${H}" class="goal"/>
    <polyline class="lv" points="${fs.map((f) => `${x(f.t)},${lvY(f.db)}`).join(' ')}"/>
    ${hzs.length > 1 ? `<polyline class="hz" points="${hzs.map((f) => `${x(f.t)},${hy(f.hz)}`).join(' ')}"/>` : ''}
    <text x="${W - P}" y="12" text-anchor="end" class="axis">크기</text><text x="${W - P}" y="${H / 2 + 14}" text-anchor="end" class="axis">높이</text>
  </svg>`;
}
// 말끝 높낮이 그래프: 끝 음절(마지막 0.25초)은 진하게, 점선은 앞부분의 가운데 높이
function tuneSvg(r, up) {
  const W = 300; const H = 110; const P = 10;
  const t0 = r.pts[0].t; const span = Math.max(0.4, r.pts[r.pts.length - 1].t - t0);
  const sts = r.pts.map((p) => p.st); const lo = Math.min(-4, ...sts) - 1; const hi = Math.max(4, ...sts) + 1;
  const x = (t) => (P + ((t - t0) / span) * (W - 2 * P)).toFixed(1);
  const y = (st) => (P + ((hi - st) / (hi - lo)) * (H - 2 * P)).toFixed(1);
  const path = (ps) => ps.map((p, i) => `${i && p.t - ps[i - 1].t < 0.12 ? 'L' : 'M'}${x(p.t)},${y(p.st)}`).join(''); // 소리가 끊긴 곳(자음)은 잇지 않는다
  return `<svg class="tune-svg ${up ? 'up' : 'down'}" viewBox="0 0 ${W} ${H}" role="img" aria-label="목소리 높낮이 그래프, 말끝이 ${r.delta >= 0 ? '올라감' : '내려감'}">
    <rect x="${x(r.endFrom)}" y="0" width="${(W - P - x(r.endFrom)).toFixed(1)}" height="${H}" class="end-zone"/>
    <line x1="${P}" x2="${W - P}" y1="${y(r.base)}" y2="${y(r.base)}" class="base"/>
    <path class="body" d="${path(r.pts.filter((p) => p.t < r.endFrom))}"/>
    <path class="end" d="${path(r.pts.filter((p) => p.t >= r.endFrom - 0.03))}"/>
    <text x="${W - P - 2}" y="14" text-anchor="end" class="axis">말끝</text>
  </svg>`;
}

/* ---------- 기록과 리포트 ---------- */

const avgOf = (l) => Math.round(l.reduce((a, x) => a + x, 0) / l.length);
// 처음과 최근(앞뒤 최대 3판). 판이 하나면 [null, 그 값]
function firstLast(list, f, digits = 0) {
  if (!list.length) return null;
  const r = (v) => (digits ? Math.round(v * 10) / 10 : Math.round(v));
  const k = Math.min(3, Math.floor(list.length / 2));
  const m = (l) => r(l.reduce((a, x) => a + f(x), 0) / l.length);
  return k ? [m(list.slice(0, k)), m(list.slice(-k))] : [null, m(list)];
}
function speakStats(d = data) {
  const L = d.speakLog || [];
  const say = L.filter((x) => x.asr && (!SPEAK_MODES[x.mode] || SPEAK_MODES[x.mode].kind === 'say'));
  const aah = L.filter((x) => x.mode === 'aah' && x.best != null);
  const tune = L.filter((x) => x.mode === 'tune' && x.q && x.s);
  const sum = (k) => tune.reduce((a, x) => [a[0] + x[k][0], a[1] + x[k][1]], [0, 0]);
  return {
    n: L.length,
    say: say.length ? { n: say.length, fl: firstLast(say, (x) => x.score) } : null,
    aah: aah.length ? { n: aah.length, best: Math.max(...aah.map((x) => x.best)), fl: firstLast(aah, (x) => x.best, 1) } : null,
    tune: tune.length ? { n: tune.length, q: sum('q'), s: sum('s'), fl: firstLast(tune, (x) => (100 * x.good) / x.n) } : null,
    weak: speakWeakTop(3, d),
  };
}
const flText = (fl, unit) => (fl[0] == null ? `<b>${fl[1]}${unit}</b>` : `${fl[0]}${unit} → <b>${fl[1]}${unit}</b>`);
// 기록 화면과 말하기 연습 화면의 '말하기' 칸. withBtn: 말하기 연습으로 가는 버튼
function speakPanel(withBtn = true) {
  const st = speakStats();
  if (!st.n && !withBtn) return '';
  const row = (k, v) => `<li><span class="say-k">${k}</span><span>${v}</span></li>`;
  const none = '<span class="note">아직 안 했어요</span>';
  return `
    <section class="panel speak-panel">
      <h2 class="panel-title">말하기 <span>발음·목소리·억양</span></h2>
      ${st.n ? `<ul class="say-stats">
        ${row('발음', st.say ? `따라 말하기 ${st.say.n}판 · 음성 인식 일치도 ${flText(st.say.fl, '%')}` : none)}
        ${row('목소리', st.aah ? `'아—' 가장 길게 <b>${st.aah.best}초</b> · ${st.aah.n}판` : none)}
        ${row('억양', st.tune ? `묻는 말 끝 올리기 <b>${st.tune.q[0]}/${st.tune.q[1]}</b> · 대답 끝 내리기 <b>${st.tune.s[0]}/${st.tune.s[1]}</b>` : none)}
      </ul>
      ${st.weak.length ? `<div class="say-tips"><p class="note">말할 때 자주 다르게 들린 소리</p>${st.weak.map(([c, n]) => `<p class="say-tip"><b>${esc(friendly(c))} · ${n}회</b> ${esc(tipOfKey(c) || '')}</p>`).join('')}</div>` : ''}`
        : `<p class="note">따라 말하기로 발음을, '아—' 길게 내기로 목소리 크기와 길이를, 말끝 올리기로 억양을 확인해요. 듣기만 하는 앱과 달리 말하기까지 기록이 쌓여요.</p>`}
      ${withBtn ? `<button class="btn block" data-go="#speak">${ICON.mic2}말하기 연습</button>` : ''}
    </section>`;
}
// 리포트 '한눈에 보기'의 말하기 한 줄
function speakReportLine() {
  const st = speakStats();
  const parts = [];
  if (st.say) { const [a, b] = st.say.fl; parts.push(`따라 말하기 음성 인식 일치도 ${a == null ? `<b>${b}%</b>` : `${a}%에서 <b>${b}%</b>${b > a ? '로 올랐어요' : b < a ? '로 내려갔어요' : '로 같아요'}`}`); }
  if (st.aah) parts.push(`'아—'는 가장 길게 <b>${st.aah.best}초</b>`);
  if (st.tune) parts.push(`묻는 말 끝 올리기 <b>${st.tune.q[0]}/${st.tune.q[1]}</b>`);
  if (!parts.length) return '';
  return `말하기를 <b>${st.n}판</b> 했어요. ${parts.join(', ')}.${st.weak.length ? ` 말할 때는 ${esc(friendly(st.weak[0][0]))} 소리가 자주 다르게 들렸어요.` : ''}`;
}
// 리포트의 말하기 표: 처음과 최근
function speakReportPanel() {
  const st = speakStats();
  if (!st.say && !st.aah && !st.tune) return '';
  const cell = (fl, unit) => (fl[0] == null ? '–' : fl[0] + unit);
  const rows = [
    st.say && ['발음', '따라 말하기 일치도', st.say, '%'],
    st.aah && ['목소리', "'아—' 이어 낸 길이", st.aah, '초'],
    st.tune && ['억양', '말끝을 맞게 말한 비율', st.tune, '%'],
  ].filter(Boolean);
  return `
      <section class="panel p-speak">
        <h2 class="panel-title">말하기 <span>발음·목소리·억양</span></h2>
        <table class="rtable">
          <thead><tr><th>영역</th><th>판 수</th><th>처음</th><th>최근</th></tr></thead>
          <tbody>${rows.map(([k, about, s, unit]) => {
            const diff = s.fl[0] == null ? null : Math.round((s.fl[1] - s.fl[0]) * 10) / 10;
            return `<tr><th scope="row">${k} <small>${about}</small></th><td>${s.n}</td><td>${cell(s.fl, unit)}</td>
              <td class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}"><b>${s.fl[1]}${unit}</b>${diff ? ` ${diff > 0 ? '▲' : '▼'}${Math.abs(diff)}` : ''}</td></tr>`;
          }).join('')}</tbody>
        </table>
        ${st.weak.length ? `<p class="note">말할 때 자주 다르게 들린 소리: ${st.weak.map(([c, n]) => `${esc(friendly(c))}(${n}회)`).join(', ')}</p>` : ''}
        <p class="note">처음과 최근은 앞뒤 최대 3판의 평균이에요. 발음은 음성 인식, 목소리와 억양은 마이크 소리로 잰 참고값이에요.</p>
      </section>`;
}
