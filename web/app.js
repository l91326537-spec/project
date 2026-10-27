'use strict';
/*
 * 소리길: 게임형 청능훈련 시제품
 * - 생활 장소 7곳(우리 집 → 동네 → 시장·마트 → 병원·약국 → 카페 → 식당·모임 → 전화·TV)을 장으로 삼아 차례로 오른다.
 *   장마다 칸 5개(끝자리 5는 말하기 칸)와, 그 장소를 그대로 옮긴 관문이 하나 있다.
 * - 칸: 10문제 중 8개 이상 맞힌 판이 서로 다른 날 2번(1·2장은 1번)이면 통과. 연 칸과 장은 닫히지 않는다.
 *   같은 칸에서 2판 연속 5개 미만이면 다음 판은 한 칸 아래 문제로 낸다.
 * - 관문: 칸에서 나온 적 없는 문항 15개(말로 대답하기 포함), 80% 이상이면 통과, 하루 3번까지.
 *   아무 장 관문에나 먼저 도전할 수 있고, 넘으면 그 장의 칸을 모두 통과로 친다.
 * - 소리는 합성(순음, 생활 소리, 장소 소음)과 미리 만든 AI 음성·가족 녹음·기기 음성으로 낸다.
 * - 자주 헷갈린 소리는 낱말과 문장 칸에서 더 자주 낸다(맞춤 출제).
 * - 따라 말하기: 들은 말을 소리 내어 따라 하면 음성 인식 결과를 자모 단위로 비교한다.
 * 모든 기록은 이 기기(localStorage, IndexedDB)에만 저장된다.
 */

const TRIALS = 10;
const PASS = 8;          // 한 판에 이만큼 맞히면 칸 통과에 한 번 친다
const LOW = 5;           // 2판 연속 이보다 적게 맞히면 다음 판은 한 칸 아래 문제
const GATE_PASS = 0.8;   // 관문 통과
const GATE_STUCK = 0.7;  // 2주 넘게 넘지 못한 관문은 그 뒤 이만큼만 넘어도 다음 장을 연다
const STUCK_DAYS = 14;
const GATE_TRIES = 3;    // 관문은 하루 세 번까지
const TODAY_N = 3;       // 오늘의 연습 판 수
const NREC_SEC = 60;     // 소음 기록 재기: 1분 동안
const NREC_START = 12;   // 말소리가 소음보다 12dB 큰 데서 시작해
const NREC_STEP = 2;     // 3번 연달아 맞히면 소음을 2dB 키우고, 틀리면 2dB 줄인다
const RETEST_AGO = 14;   // 2주 전에 틀린 문제를 다시 낸다
const RETEST_N = 10;
const view = document.getElementById('view');

/* ---------- 저장 ---------- */

const store = {
  key: 'sorigil.v1',
  load() {
    try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; }
  },
  save(d) {
    try { localStorage.setItem(this.key, JSON.stringify(d)); } catch {}
  },
};
const fresh = () => ({
  sessions: [],          // 칸 한 판: {date, cell, for?, correct, total, at, sec}. for: 한 칸 아래로 내려 푼 판이면 원래 칸
  gates: [],             // 관문 도전: {ch, date, at, correct, total, pass, sec}
  misses: [],            // 틀린 문제(나중에 다시 내려고 남긴다): {date, at, cell, kind, answer, chose, options, say, scene?, snr?, re?: {date, ok, chose}}
  noiseRecs: [],         // 1분 소음 기록: {date, at, snr, n, correct}. snr이 낮을수록 더 시끄러운 곳에서 알아들은 것
  retests: [],           // 그때 틀린 문제 다시 듣기: {date, at, n, correct}
  minDb: null,           // 소리 알아차리기에서 들린 가장 작은 소리(dB, 기준 대비)
  toneByFreq: {},        // 높낮이별로 들린 가장 작은 소리
  bigText: false,
  confusions: {},        // '초성 ㅅ↔ㅆ': 횟수
  focusLog: {},          // 맞춤 문제 결과 '초성 ㅅ↔ㅆ': {n, ok}
  speakLog: [],          // 따라 말하기 한 판: {date, at, mode, n, score, good, asr, cell?}
  speakConf: {},         // 따라 말하기에서 다르게 들린 소리 '초성 ㅅ↔ㅆ': 횟수
  preferFamily: true,
  reportName: '',
  reportMemo: '',
  plan: null,            // 선생님이 보낸 숙제 {by, cells, kind, amount, days, memo, at}. cells의 'g5'는 5장 관문
  checks: [],            // 월간 듣기 점검 {date, at, score, parts: {word: [맞힘, 문제 수], ...}, miss: [문제 번호]}
  focusRuns: [],         // 집중 연습 도전: {cat: 'word'|'sound'|'sent', lv, date, at, correct, total, noise, sec}
  itemStats: {},         // 문제로 나온 말마다 [나온 횟수, 맞힌 횟수]
  focusNoise: { on: false, scene: 'cafe' }, // 집중 연습·단어장 소음 모드
  who: null,             // 사용자 유형(fit.js의 WHO): 'ha' 보청기, 'ci' 인공와우 성인, 'kid' 인공와우 아이, 'ear2' 두 번째 귀, 'none' 고르지 않음
  ear: 'both',           // 듣는 귀: 'both', 'L', 'R'
  talkSpeed: null,       // 말 빠르기(없으면 유형에 따라)
  lings: [],             // 링 6소리 점검: {date, at, ear, src, ok, heard, miss: [소리], res: {소리: 고른 소리|'none'}}
  supraRuns: [],         // 소리 구별: {mode, date, at, correct, total, sec}
  maps: [],              // 기기 조절 일지: {date, at, kind, ear, memo}
});
// 단계·레벨로 적던 옛 기록을 칸으로 옮긴다(옛 숙제 링크의 단계 번호도 같은 표로 읽는다)
const STAGE_CELL = { 1: ['1-1', '1-1', '1-1'], 2: ['1-2', '2-1', '2-1'], 3: ['1-3', '2-2', '3-1'], 5: ['4-1', '4-2', '4-3'], 6: ['5-1', '5-3', '6-1'] };
const PLAN_STAGE = { 1: '1-1', 2: '2-1', 3: '3-1', 5: '4-1', 6: '5-1' };
function migrate(d) {
  d.sessions = (Array.isArray(d.sessions) ? d.sessions : []).map((s) => {
    if (s.cell) return s;
    const cell = (STAGE_CELL[s.stage] || [])[(s.level || 1) - 1];
    if (!cell) return null;
    const { stage, level, score, ...rest } = s;
    return { ...rest, cell };
  }).filter(Boolean);
  for (const k of ['gates', 'misses', 'speakLog', 'checks', 'noiseRecs', 'retests', 'focusRuns', 'lings', 'supraRuns', 'maps']) if (!Array.isArray(d[k])) d[k] = [];
  if (!['both', 'L', 'R'].includes(d.ear)) d.ear = 'both';
  if (!SPEEDS.some(([v]) => v === d.talkSpeed)) d.talkSpeed = null;
  if (!d.itemStats || typeof d.itemStats !== 'object') d.itemStats = {};
  if (d.plan && !Array.isArray(d.plan.cells)) d.plan.cells = [...new Set((d.plan.stages || []).map((n) => PLAN_STAGE[n]).filter(Boolean))];
  if (d.plan && !d.plan.cells.length) d.plan = null;
  delete d.levels; delete d.tip; delete d.goal;
  return d;
}
let data = migrate(Object.assign(fresh(), store.load()));
const persist = () => store.save(data);
const applyTextSize = () => document.documentElement.classList.toggle('big', !!data.bigText);
applyTextSize();

// 가족 녹음은 용량이 커서 IndexedDB에 둔다.
const voiceDb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('sorigil-voices', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('v');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('v', mode);
      const req = fn(t.objectStore('v'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: (w) => tx('readonly', (s) => s.get(w)).catch(() => null),
    put: (w, blob) => tx('readwrite', (s) => s.put(blob, w)),
    del: (w) => tx('readwrite', (s) => s.delete(w)),
    keys: () => tx('readonly', (s) => s.getAllKeys()).catch(() => []),
  };
})();

/* ---------- 소리 ---------- */

let ctx;
function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
// 사용자 터치 안에서 바로 불러야 한다. 휴대폰 브라우저는 터치 밖에서 시작한 소리를 막는다.
function unlockAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {} // 아이폰 무음 스위치가 켜져 있어도 들리게
  const c = audio();
  const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0);
  if (window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance('')); // iOS 사파리는 터치 안에서 한 번 말해야 이후 음성이 나온다
  setTimeout(() => { if (c.state !== 'running') toast('소리가 막혀 있어요. 휴대폰 음량과 무음 모드를 확인하고 화면을 한 번 더 눌러 주세요.'); }, 600);
}
// 듣는 귀: 한쪽만 고르면 모든 소리를 하나로 모아 그쪽 채널로만 보낸다(이어폰이나 기기 블루투스로 들을 때).
let earNode = null; let earNodeSide = null;
function earOut(c = audio()) {
  const side = earSide();
  if (!side) return c.destination;
  if (!earNode || earNodeSide !== side) {
    if (earNode) earNode.disconnect();
    const mono = c.createGain();
    mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
    const m = c.createChannelMerger(2);
    mono.connect(m, 0, side === 'L' ? 0 : 1); m.connect(c.destination);
    earNode = mono; earNodeSide = side;
  }
  return earNode;
}
const dbToGain = (db) => Math.pow(10, db / 20);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function envGain(c, dest, t0, dur, peak, attack = 0.02, release = 0.08) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.setValueAtTime(peak, t0 + Math.max(attack, dur - release));
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  g.connect(dest);
  return g;
}
function osc(c, dest, type, freq, t0, dur, peak) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.connect(envGain(c, dest, t0, dur, peak));
  o.start(t0); o.stop(t0 + dur + 0.05);
  return o;
}
let noiseBuf;
function noise(c, dest, t0, dur, peak, filterType, freq, q = 1) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource();
  s.buffer = noiseBuf; s.loop = true;
  const f = c.createBiquadFilter();
  f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  s.connect(f); f.connect(envGain(c, dest, t0, dur, peak, 0.005, Math.min(0.08, dur / 2)));
  s.start(t0); s.stop(t0 + dur + 0.05);
  return f;
}

// 소리 알아차리기(1-1): 순음. db는 기준 대비 dB(0이 가장 큼).
function playTone(freq, db, dur = 0.8) {
  const c = audio();
  osc(c, earOut(c), 'sine', freq, c.currentTime + 0.05, dur, 0.5 * dbToGain(db));
  return wait(dur * 1000 + 100);
}

// 생활 소리(1-2, 2-1, 1장 관문)를 녹음 파일 없이 합성한다.
const ENV_SOUNDS = {
  doorbell: { name: '초인종', icon: '🔔', dur: 1.3, make(c, d, t) {
    osc(c, d, 'sine', 659, t, 0.6, 0.4); osc(c, d, 'sine', 1318, t, 0.6, 0.08);
    osc(c, d, 'sine', 523, t + 0.6, 0.7, 0.4); osc(c, d, 'sine', 1046, t + 0.6, 0.7, 0.08);
  } },
  phone: { name: '전화벨', icon: '📞', dur: 1.6, make(c, d, t) {
    for (let k = 0; k < 2; k++) for (let i = 0; i < 12; i++) {
      const s = t + k * 0.9 + i * 0.05;
      osc(c, d, 'square', i % 2 ? 1400 : 1100, s, 0.045, 0.08);
    }
  } },
  horn: { name: '자동차 경적', icon: '🚗', dur: 1.0, make(c, d, t) {
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800; f.connect(d);
    osc(c, f, 'sawtooth', 415, t, 0.9, 0.2); osc(c, f, 'sawtooth', 523, t, 0.9, 0.2);
  } },
  clock: { name: '시계 똑딱', icon: '⏰', dur: 2.0, make(c, d, t) {
    for (let i = 0; i < 4; i++) noise(c, d, t + i * 0.5, 0.025, 0.9, 'bandpass', i % 2 ? 2500 : 3500, 8);
  } },
  water: { name: '물 흐르는 소리', icon: '🚰', dur: 2.0, make(c, d, t) {
    const f = noise(c, d, t, 2.0, 0.6, 'bandpass', 900, 0.8);
    const lfo = c.createOscillator(); const lg = c.createGain();
    lfo.frequency.value = 7; lg.gain.value = 400; lfo.connect(lg); lg.connect(f.frequency);
    lfo.start(t); lfo.stop(t + 2.05);
  } },
  siren: { name: '구급차 사이렌', icon: '🚑', dur: 2.0, make(c, d, t) {
    const o = c.createOscillator(); o.type = 'triangle';
    for (let i = 0; i < 4; i++) o.frequency.setValueAtTime(i % 2 ? 700 : 960, t + i * 0.5);
    o.connect(envGain(c, d, t, 2.0, 0.35)); o.start(t); o.stop(t + 2.05);
  } },
  kettle: { name: '주전자 휘파람', icon: '🫖', dur: 1.6, make(c, d, t) {
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1800, t); o.frequency.linearRampToValueAtTime(2600, t + 1.2);
    const v = c.createOscillator(); const vg = c.createGain();
    v.frequency.value = 6; vg.gain.value = 40; v.connect(vg); vg.connect(o.frequency);
    o.connect(envGain(c, d, t, 1.6, 0.18, 0.4)); o.start(t); o.stop(t + 1.65); v.start(t); v.stop(t + 1.65);
    noise(c, d, t, 1.6, 0.08, 'highpass', 4000);
  } },
  knock: { name: '노크 소리', icon: '🚪', dur: 1.2, make(c, d, t) {
    for (let i = 0; i < 3; i++) {
      const s = t + i * 0.28;
      const o = c.createOscillator(); o.frequency.setValueAtTime(180, s); o.frequency.exponentialRampToValueAtTime(70, s + 0.12);
      const g = c.createGain(); g.gain.setValueAtTime(0.9, s); g.gain.exponentialRampToValueAtTime(0.001, s + 0.15);
      o.connect(g); g.connect(d); o.start(s); o.stop(s + 0.16);
      noise(c, d, s, 0.03, 0.4, 'lowpass', 1500);
    }
  } },
};
function playEnv(id) {
  const c = audio(); const s = ENV_SOUNDS[id];
  const master = c.createGain(); master.gain.value = 0.9; master.connect(earOut(c));
  s.make(c, master, c.currentTime + 0.05);
  return wait(s.dur * 1000 + 200);
}

// 장소 소음. 여러 사람이 떠드는 소리(babble)와 그곳의 소리를 미리 합성해 반복 재생한다.
// 소음 RMS는 0.1, AI 음성 말소리 RMS는 약 0.14다. 말소리가 소음보다 snr dB 크도록 소음 크기를 정한다(+12dB → 0.35배).
const noiseGain = (snr) => 1.4 * Math.pow(10, -snr / 20);
const snrText = (snr) => `${snr > 0 ? '+' : ''}${snr}dB`;
const SCENE_NAME = { restaurant: '🍽️ 식당', cafe: '☕ 카페', bus: '🚌 버스', clinic: '🏥 병원 대기실', market: '🛒 시장' };
const noiseCache = {};
function sceneBuffer(c, id) {
  if (noiseCache[id]) return noiseCache[id];
  const sr = 22050; const len = sr * 8; const fade = Math.round(sr / 4);
  const out = new Float32Array(len + fade);
  let seed = [...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 2147483647, 7);
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; // 장소마다 늘 같은 소리
  // RBJ 대역통과 필터 계수
  const bp = (f, q) => { const w = 2 * Math.PI * f / sr; const al = Math.sin(w) / (2 * q); const a0 = 1 + al; return [al / a0, 0, -al / a0, -2 * Math.cos(w) / a0, (1 - al) / a0]; };
  const VOWELS = [[800, 1200], [300, 2300], [350, 800], [500, 1900], [500, 900]]; // 아 이 우 에 오
  function talker(gain) {
    const buf = new Float32Array(out.length);
    let t = Math.floor(rnd() * sr * 0.5); let phase = 0; const f0 = 100 + rnd() * 130;
    const st = [[0, 0, 0, 0], [0, 0, 0, 0]];
    while (t < buf.length) {
      if (rnd() < 0.18) { t += Math.floor(sr * (0.2 + rnd() * 0.5)); continue; } // 숨 쉬는 틈
      const n = Math.floor(sr * (0.12 + rnd() * 0.18));
      const v = VOWELS[Math.floor(rnd() * VOWELS.length)];
      const fs = [bp(v[0], 5), bp(v[1], 8)];
      const fric = rnd() < 0.3; // 'ㅅ' 같은 마찰음으로 시작
      const pitch = f0 * (0.9 + rnd() * 0.25);
      for (let i = 0; i < n && t + i < buf.length; i++) {
        const p = i / n;
        phase += pitch / sr; if (phase >= 1) phase -= 1;
        const src = (1 - 2 * phase) * 0.6 + (Math.random() * 2 - 1) * 0.05;
        let y = 0;
        for (let k = 0; k < 2; k++) {
          const [b0, , b2, a1, a2] = fs[k]; const z = st[k];
          const o = b0 * src + b2 * z[1] - a1 * z[2] - a2 * z[3];
          z[1] = z[0]; z[0] = src; z[3] = z[2]; z[2] = o;
          y += o * (k ? 0.6 : 1);
        }
        const env = Math.pow(Math.sin(Math.PI * p), 0.6);
        if (fric && p < 0.25) y += (Math.random() * 2 - 1) * 0.25 * (1 - p * 4);
        buf[t + i] = y * env * gain;
      }
      t += n + Math.floor(sr * 0.02);
    }
    return buf;
  }
  const add = (b) => { for (let i = 0; i < out.length; i++) out[i] += b[i]; };
  const babble = (count, gain) => { for (let k = 0; k < count; k++) add(talker(gain * (0.5 + rnd() * 0.7))); };
  const ping = (at, f, decay, amp) => { // 그릇·컵 부딪히는 소리, 안내 종소리
    const s0 = Math.floor(at * sr); const n = Math.floor(decay * 5 * sr);
    for (let i = 0; i < n && s0 + i < out.length; i++) out[s0 + i] += Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-i / (decay * sr)) * amp;
  };
  const hiss = (at, dur, amp) => { // 커피 머신 스팀
    const s0 = Math.floor(at * sr); const n = Math.floor(dur * sr); let prev = 0;
    for (let i = 0; i < n && s0 + i < out.length; i++) {
      const w = Math.random() * 2 - 1; const hp = w - prev; prev = w;
      out[s0 + i] += hp * amp * Math.min(1, i / (sr * 0.3), (n - i) / (sr * 0.3));
    }
  };
  const beep = (at, dur, f, amp) => { // 계산대 바코드 소리
    const s0 = Math.floor(at * sr); const n = Math.floor(dur * sr);
    for (let i = 0; i < n && s0 + i < out.length; i++) out[s0 + i] += Math.sign(Math.sin(2 * Math.PI * f * i / sr)) * amp * Math.min(1, i / 60, (n - i) / 60);
  };
  const rumble = (amp) => { // 엔진과 바퀴 소리
    let a = 0; let b = 0;
    for (let i = 0; i < out.length; i++) {
      a += 0.02 * ((Math.random() * 2 - 1) - a); b += 0.05 * (a - b);
      out[i] += (b * 9 + Math.sin(2 * Math.PI * 70 * i / sr) * 0.15 * (1 + 0.3 * Math.sin(i / sr))) * amp;
    }
  };
  if (id === 'restaurant') {
    babble(8, 1);
    for (let k = 0; k < 9; k++) { const at = rnd() * 8; ping(at, 2500 + rnd() * 3000, 0.05 + rnd() * 0.08, 0.25); ping(at + 0.01, 4000 + rnd() * 2500, 0.04, 0.15); }
  } else if (id === 'cafe') {
    babble(6, 1);
    hiss(1 + rnd() * 2, 2.5, 0.12);
    for (let k = 0; k < 4; k++) ping(rnd() * 8, 3000 + rnd() * 2500, 0.08, 0.15);
  } else if (id === 'bus') {
    rumble(1);
    babble(2, 0.5);
  } else if (id === 'market') {
    babble(7, 0.9);
    babble(1, 1.7); // 가까이서 손님을 부르는 목소리
    for (let k = 0; k < 7; k++) beep(rnd() * 8, 0.09, 2900, 0.12);
    rumble(0.08);
  } else {
    babble(4, 0.8);
    ping(3, 660, 0.5, 0.18); ping(3.6, 523, 0.6, 0.18); // 딩동
    rumble(0.15);
  }
  // 끝과 처음을 겹쳐 이어 붙여 반복할 때 틱 소리가 나지 않게 한다
  for (let i = 0; i < fade; i++) { const k = i / fade; out[i] = out[i] * k + out[len + i] * (1 - k); }
  let sum = 0; for (let i = 0; i < len; i++) sum += out[i] * out[i];
  const scale = 0.1 / Math.sqrt(sum / len || 1);
  const ab = c.createBuffer(1, len, sr); const d = ab.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.max(-1, Math.min(1, out[i] * scale));
  return (noiseCache[id] = ab);
}
// 소음을 깔고 fn()을 들려준다. 소음이 먼저 시작하고 말이 끝난 뒤 잦아든다.
let stopNoise = null; // 다른 화면으로 가면 바로 끈다
async function withNoise(id, snr, fn) {
  const c = audio();
  const buf = sceneBuffer(c, id);
  const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
  const g = c.createGain(); g.gain.value = 0;
  src.connect(g); g.connect(earOut(c));
  if (stopNoise) stopNoise();
  stopNoise = () => { try { src.stop(); } catch {} stopNoise = null; };
  const t = c.currentTime;
  src.start(t, Math.random() * buf.duration);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(noiseGain(snr), t + 0.6);
  try {
    await wait(1300);
    return await fn();
  } finally {
    await wait(500);
    const t2 = c.currentTime;
    g.gain.cancelScheduledValues(t2); g.gain.setValueAtTime(g.gain.value, t2); g.gain.linearRampToValueAtTime(0, t2 + 0.5);
    try { src.stop(t2 + 0.6); } catch {}
  }
}

// 말소리: 가족 녹음이 있으면 그것을, 없으면 미리 만든 AI 음성을, 그것도 없으면 기기 음성(TTS)을 쓴다.
let koVoice = null;
function pickVoice() {
  const vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  koVoice = vs.find((v) => /^ko/i.test(v.lang)) || null;
}
if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

// 미리 만든 음성 파일(voice/index.json: { 글자: 파일 경로 }). 없으면 빈 묶음으로 둔다.
// 파일 수 제한이 있는 곳에서는 여러 음성을 이어 붙인 묶음 파일을 쓴다: { 글자: { s: 묶음 경로, t: 시작 초, d: 길이 초 } }
let voicePack = {};
const voicePackReady = fetch('voice/index.json').then((r) => (r.ok ? r.json() : {})).then((j) => { voicePack = j || {}; }).catch(() => {});
const canSpeak = () => !!window.speechSynthesis || Object.keys(voicePack).length > 0;

// 관문의 여러 사람 대화: 같은 음성을 낮거나 높게 바꿔 다른 사람처럼 들려준다(빠르기도 함께 바뀐다).
// man·woman은 소리 구별의 남자·여자 목소리(AI 음성이 여자 목소리라 남자는 더 낮춘다)
const VOICE_RATE = { low: 0.86, high: 1.1, man: 0.76, woman: 1.04 };
const TTS_PITCH = { low: 0.6, high: 1.4, man: 0.5, woman: 1.3 };
// speed: 높낮이는 그대로 두고 빠르기만 바꾼다(집중 연습 뒤 단계 문장, 말 빠르기)
function playUrl(url, rate = 1, speed = 1) {
  const a = new Audio(url);
  if (earSide()) try { const c = audio(); c.createMediaElementSource(a).connect(earOut(c)); } catch {} // 한쪽 귀로 보내려면 웹 오디오를 거친다
  if (rate !== 1) { a.preservesPitch = a.webkitPreservesPitch = a.mozPreservesPitch = false; a.defaultPlaybackRate = a.playbackRate = rate; }
  if (speed !== 1) a.defaultPlaybackRate = a.playbackRate = rate * speed;
  return new Promise((res) => { a.onended = a.onerror = res; a.play().catch(res); setTimeout(res, 8000); }).then(() => a.pause()); // 재생이 멈춰도 넘어간다
}

const spriteCache = {};
function loadSprite(url) {
  return spriteCache[url] || (spriteCache[url] = fetch(url).then((r) => r.arrayBuffer())
    .then((b) => new Promise((res, rej) => audio().decodeAudioData(b, res, rej))) // 옛 사파리는 콜백 방식만 된다
    .catch((e) => { delete spriteCache[url]; throw e; }));
}
async function playSprite({ s, t, d }, rate = 1) {
  const buf = await loadSprite(s);
  const c = audio(); const src = c.createBufferSource();
  src.buffer = buf; src.playbackRate.value = rate; src.connect(earOut(c)); src.start(0, t, d);
  await new Promise((res) => { src.onended = res; setTimeout(res, (d / rate) * 1000 + 500); });
}

// v: 다른 사람 목소리('low', 'high', 'man', 'woman'). 가족 녹음은 그 사람 목소리 그대로 둔다
// asIs: 말 빠르기 설정을 따르지 않는다(월간 점검·소음 기록은 늘 같은 조건으로 견준다)
async function playWord(word, v, speed = 1, asIs = false) {
  const rate = VOICE_RATE[v] || 1;
  if (!asIs) speed *= talkRate();
  if (data.preferFamily && !v) {
    const blob = await voiceDb.get(word);
    if (blob) {
      const url = URL.createObjectURL(blob);
      await playUrl(url, 1, speed);
      URL.revokeObjectURL(url);
      return 'family';
    }
  }
  await voicePackReady;
  const p = voicePack[word];
  if (p) {
    try { await (typeof p === 'string' ? playUrl(p, rate, speed) : playSprite(p, rate * speed)); return 'pack'; } catch {} // 묶음을 못 읽으면 기기 음성으로
  }
  if (!window.speechSynthesis) return 'none';
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = 'ko-KR'; u.rate = 0.85 * rate * speed; u.pitch = TTS_PITCH[v] || 1;
  if (koVoice) u.voice = koVoice;
  await new Promise((res) => { u.onend = u.onerror = res; speechSynthesis.speak(u); setTimeout(res, (3000 + word.length * 250) / Math.min(1, speed)); }); // 문장은 길어서 기다리는 시간을 늘린다
  return !koVoice ? 'tts-nokorean' : earSide() ? 'tts-both' : 'tts'; // 기기 음성은 한쪽 귀로 보낼 수 없다
}

/* ---------- 한글 자모 분석 (취약음) ---------- */

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
function decompose(ch) {
  const c = ch.charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return null;
  return [CHO[Math.floor(c / 588)], JUNG[Math.floor((c % 588) / 28)], JONG[c % 28]];
}
// 같은 글자 수의 두 단어에서 다른 자모를 '초성 ㅅ↔ㅆ' 꼴로 돌려준다.
function contrasts(target, chosen) {
  if (target.length !== chosen.length) return ['단어 길이'];
  const out = [];
  const pos = ['초성', '중성', '종성'];
  for (let i = 0; i < target.length; i++) {
    const a = decompose(target[i]); const b = decompose(chosen[i]);
    if (!a || !b) continue;
    for (let k = 0; k < 3; k++) {
      if (a[k] !== b[k]) {
        const pair = [a[k] || '없음', b[k] || '없음'].sort().join('↔');
        out.push(`${pos[k]} ${pair}`);
      }
    }
  }
  return out;
}
const POS_NAME = { 초성: '첫소리', 중성: '모음', 종성: '받침' };
const friendly = (c) => { const [pos, pair] = c.split(' '); return `${POS_NAME[pos] || pos} ${pair}`; };

// 맞춤 출제: 자주 헷갈린 소리일수록 무겁다. 맞춤 문제를 맞힐 때마다 조금씩 가벼워진다.
const weakWeight = (c) => Math.max(0, (data.confusions[c] || 0) - 0.5 * ((data.focusLog || {})[c]?.ok || 0));
// 보기들 가운데 한두 소리만 다른 짝 중 가장 약한 소리가 든 짝을 찾는다.
function weakPair(words) {
  let best = null;
  for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) {
    const cs = contrasts(words[i], words[j]);
    if (!cs.length || cs.length > 2 || cs.includes('단어 길이')) continue;
    const w = cs.reduce((a, c) => a + weakWeight(c), 0);
    if (w > 0 && (!best || w > best.w)) best = { w, pair: [words[i], words[j]], c: cs.reduce((a, c) => (weakWeight(c) > weakWeight(a) ? c : a)) };
  }
  return best;
}
// 약한 소리가 있으면 10문제 중 6문제쯤(rate)은 그 소리가 든 묶음을 무게에 비례해 고른다.
function pickTailored(items, wordsOf, rate = 0.6) {
  const scored = items.map((it) => ({ it, wp: weakPair(wordsOf(it)) })).filter((x) => x.wp);
  if (scored.length && Math.random() < rate) {
    let r = Math.random() * scored.reduce((a, x) => a + x.wp.w, 0);
    for (const x of scored) { r -= x.wp.w; if (r <= 0) return { item: x.it, focus: x.wp }; }
    const last = scored[scored.length - 1]; return { item: last.it, focus: last.wp };
  }
  return { item: pick(items), focus: null };
}
const weakTop = (n) => Object.entries(data.confusions).filter(([k]) => k !== '단어 길이').sort((a, b) => b[1] - a[1]).slice(0, n);

/* ---------- 문항 ---------- */

const ALL_WORDS = [...new Set([...Object.values(WORD_SETS).flat(2), ...CALL_SETS.flat()])];

const NOISE_SENTENCES = [...new Set(Object.values(NOISE_SCENES).flatMap((sc) => [...sc.easy, ...sc.hard].flat()))];
const ALL_SENTENCES = [...new Set([...SENTENCE_SETS[1], ...SENTENCE_SETS[2]].flat().concat(NOISE_SENTENCES))];
const hasBatchim = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c <= 11171 && c % 28 !== 0; };
const ida = (w) => w + (hasBatchim(w) ? '이에요' : '예요');
const josa = (w, a, b) => w + (hasBatchim(w) ? a : b);
const fillFrame = (frame, w) => frame.replace('_{을}', w + (hasBatchim(w) ? '을' : '를')).replace('_{이}', w + (hasBatchim(w) ? '이' : '가'));
const TONES = [500, 1000, 2000, 4000];
const HOME_SOUNDS = ['doorbell', 'phone', 'knock', 'kettle', 'water', 'clock'];
// 3장 낱말을 첫소리만 다른 묶음(3-1)과 받침이나 모음이 다른 묶음(3-2)으로 나눈다
let split3 = null;
const wordSets3 = () => split3 || (split3 = (() => {
  const onlyFirst = (g) => g.every((a) => g.every((b) => a === b || contrasts(a, b).every((c) => c.startsWith('초성'))));
  return { first: WORD_SETS[3].filter(onlyFirst), rest: WORD_SETS[3].filter((g) => !onlyFirst(g)) };
})());

// 칸: 장마다 5개, 끝자리 5는 말하기 칸. kind가 없는 칸은 아직 만들지 않아 '곧 열려요'로 둔다.
// 한 칸에서는 손잡이(보기 수, 소리 닮은 정도, 말의 길이, 소음 크기) 하나만 돌린다.
const CELLS = [
  { id: '1-1', name: '소리 알아차리기', desc: '낮은 소리부터 아주 높은 소리까지', kind: 'tone' },
  { id: '1-2', name: '집 안 소리 고르기', desc: '초인종, 전화벨 같은 소리 두 개 중에서', kind: 'env', n: 2, pool: HOME_SOUNDS },
  { id: '1-3', name: '길이가 다른 낱말', desc: '물, 우산, 바나나처럼 글자 수가 다른 말', kind: 'word', sets: () => WORD_SETS[1] },
  { id: '1-4', name: '부르는 말', desc: '여보, 할머니, 저기요', kind: 'word', sets: () => CALL_SETS },
  { id: '1-5', name: '"아" 소리 내기', desc: '알맞은 크기로 2초' },
  { id: '2-1', name: '생활 소리 고르기', desc: '경적, 사이렌까지 네 개 중에서', kind: 'env', n: 4 },
  { id: '2-2', name: '길이가 같은 낱말', desc: '사과, 우유, 모자처럼 글자 수가 같은 말', kind: 'word', sets: () => WORD_SETS[2] },
  { id: '2-3', name: '소리 높낮이', desc: '말끝이 올라가는지 내려가는지', kind: 'supra', mode: 'tune', labels: ['올라가요', '내려가요'] },
  { id: '2-4', name: '숫자 듣기', desc: '버스 번호, 층수' },
  { id: '2-5', name: '쉬운 낱말 따라 말하기', desc: '듣고 소리 내어 말해요', kind: 'speak', mode: 'word' },
  { id: '3-1', name: '첫소리만 다른 낱말', desc: '불, 풀, 뿔', kind: 'word', sets: () => wordSets3().first },
  { id: '3-2', name: '받침·모음이 다른 낱말', desc: '밥과 밤, 오리와 우리', kind: 'word', sets: () => wordSets3().rest },
  { id: '3-3', name: '같은 소리, 다른 소리', desc: '두 소리가 같은지 가리기' },
  { id: '3-4', name: '값 듣기', desc: '삼천오백 원이에요' },
  { id: '3-5', name: '헷갈리는 낱말 말하기', desc: '살과 쌀을 또렷하게', kind: 'speak', mode: 'pair' },
  { id: '4-1', name: '생활 문장', desc: '서로 다른 문장 고르기', kind: 'sent', level: 1 },
  { id: '4-2', name: '한 낱말만 다른 문장', desc: '물 좀 주세요, 밥 좀 주세요', kind: 'sent', level: 2 },
  { id: '4-3', name: '문장 속 헷갈리는 낱말', desc: '시장에서 쌀을 샀어요', kind: 'sent', level: 3 },
  { id: '4-4', name: '묻고 답하기', desc: '질문에 알맞은 대답 고르기' },
  { id: '4-5', name: '묻는 말 억양', desc: '묻는 말은 끝을 올려요' },
  { id: '5-1', name: '카페 소음 +12dB', desc: '소음이 작게 깔려요', kind: 'noise', scene: 'cafe', snr: 12 },
  { id: '5-2', name: '카페 소음 +9dB', desc: '소음이 조금 커져요', kind: 'noise', scene: 'cafe', snr: 9 },
  { id: '5-3', name: '카페 소음 +6dB', desc: '소음이 꽤 커요', kind: 'noise', scene: 'cafe', snr: 6 },
  { id: '5-4', name: '여러 목소리', desc: '남자, 여자, 어르신, 아이' },
  { id: '5-5', name: '소음 속에서 주문하기', desc: '소음을 틀어 놓고 또박또박' },
  { id: '6-1', name: '식당 소음 +2dB', desc: '소음이 말만큼 커요', kind: 'noise', scene: 'restaurant', snr: 2 },
  { id: '6-2', name: '식당 소음 0dB', desc: '말과 소음이 같은 크기예요', kind: 'noise', scene: 'restaurant', snr: 0 },
  { id: '6-3', name: '두 사람이 함께 말할 때', desc: '한 사람 말만 골라 듣기' },
  { id: '6-4', name: '빠른 말', desc: '보통의 1.2배 빠르기' },
  { id: '6-5', name: '빠르기와 쉼', desc: '알맞게 끊어 읽기' },
  { id: '7-1', name: '전화 음질 낱말', desc: '전화로 듣는 낱말' },
  { id: '7-2', name: '전화 음질 문장', desc: '전화로 듣는 문장' },
  { id: '7-3', name: '보기 없이 듣기', desc: '들은 말을 그대로 말하기' },
  { id: '7-4', name: '뉴스 듣기', desc: '길고 빠른 말의 내용 고르기' },
  { id: '7-5', name: '스스로 대답하기', desc: '질문에 내 말로 대답하기' },
].map((c) => ({ ...c, ch: +c.id[0] }));
// 약한 소리 연습: 오늘의 연습에 끼우는 판(칸 통과에는 세지 않는다)
const WEAK_CELL = { id: 'weak', ch: 3, name: '약한 소리 연습', desc: '자주 헷갈린 소리가 든 낱말', kind: 'word', sets: () => WORD_SETS[3], weak: true };
const CELL = Object.fromEntries([...CELLS, WEAK_CELL].map((c) => [c.id, c]));
const cellsOf = (n) => CELLS.filter((c) => c.ch === n);
const chapterOf = (n) => CHAPTERS[n - 1];
const listenCell = (c) => !!c.kind && c.kind !== 'speak' && !c.weak;

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
// 기기 음성이 없는 곳(예: Claude 앱 화면)에서는 미리 만든 음성 파일이 있는 것 중에서 고른다
const pickHeard = (a, say = (x) => x) => {
  if (window.speechSynthesis) return pick(a);
  const has = a.filter((x) => voicePack[say(x)]);
  return pick(has.length ? has : a);
};
const today = () => new Date().toLocaleDateString('sv-SE');
const addDays = (date, n) => { const t = new Date(`${date}T12:00:00`); t.setDate(t.getDate() + n); return t.toLocaleDateString('sv-SE'); };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 사다리 규칙 ---------- */

// 칸 통과에 필요한 서로 다른 날 수: 1·2장은 하루, 3장부터 이틀(아이는 이틀, 사흘로 천천히)
const needDays = (c, d = data) => whoOf(d).days[c.ch <= 2 ? 0 : 1];
const gatesOf = (n, d = data) => (d.gates || []).filter((g) => g.ch === n);
const gatePassed = (n, d = data) => gatesOf(n, d).some((g) => g.pass);
const gateNeed = (total, rate) => Math.ceil(rate * total - 1e-9);
const gateTriesToday = (n, d = data) => gatesOf(n, d).filter((g) => g.date === today()).length;
// 칸을 넘은 날들: 8개 이상 맞힌 판(말하기 칸은 5개 중 4개를 또렷하게 말한 판)이 있는 날
function goodDates(c, d = data) {
  const list = c.kind === 'speak'
    ? (d.speakLog || []).filter((x) => x.cell === c.id && x.asr && x.good >= 4)
    : (d.sessions || []).filter((s) => s.cell === c.id && s.correct >= PASS);
  return new Set(list.map((x) => x.date));
}
// soon: 아직 없는 칸, done: 통과, skip: 이 기기에서 확인할 수 없는 말하기 칸(관문을 여는 데 세지 않는다), open: 연습할 칸
function cellState(c, d = data) {
  if (!c.kind) return 'soon';
  if (gatePassed(c.ch, d) || goodDates(c, d).size >= needDays(c, d)) return 'done';
  if (c.kind === 'speak' && !Recognition) return 'skip';
  return 'open';
}
const cellsLeft = (n, d = data) => cellsOf(n).filter((c) => cellState(c, d) === 'open');
const cellsCounted = (n, d = data) => cellsOf(n).filter((c) => c.kind && cellState(c, d) !== 'skip');
// 2주 넘게 넘지 못한 관문은 그 뒤 70%만 넘어도 다음 장을 연다(관문은 언제든 다시 할 수 있다)
function stuckOpened(n, d = data) {
  const g = gatesOf(n, d);
  if (!g.length) return false;
  const from = addDays(g[0].date, STUCK_DAYS);
  return g.some((x) => x.date >= from && x.correct >= gateNeed(x.total, GATE_STUCK));
}
// 사용자 유형에 따라 시작하는 장까지는 처음부터 열어 둔다(보청기는 3장부터)
function chapterOpen(n, d = data) {
  if (n <= whoOf(d).ch) return true;
  return (d.gates || []).some((g) => g.pass && g.ch >= n - 1) || stuckOpened(n - 1, d);
}
// 지금 오르는 장: 열린 장 중 가장 높은 곳(7장은 아직 칸이 없어 6장까지)
function currentChapter(d = data) {
  let cur = 1;
  for (let n = 2; n <= 6; n++) if (chapterOpen(n, d)) cur = n;
  return cur;
}
// 다음에 할 일: 지금 장에서 아직 넘지 못한 첫 칸, 다 넘었으면 관문, 관문도 넘었으면 복습
function nextStep(d = data) {
  const ch = currentChapter(d);
  const c = cellsLeft(ch, d)[0];
  if (c) return { ch, cell: c.id };
  if (GATES[ch] && !gatePassed(ch, d)) return { ch, gate: ch };
  return { ch, review: true };
}
// 같은 칸에서 2판 연속 5개 미만이면 다음 판은 바로 앞 듣기 칸 문제로 낸다. 그 판을 하고 나면 다시 원래 칸이다.
function playCellFor(id, d = data) {
  const c = CELL[id];
  if (!c || !listenCell(c)) return id;
  const mine = (d.sessions || []).filter((s) => (s.cell === id && !s.for) || s.for === id);
  const last = mine[mine.length - 1];
  if (!last || last.for === id) return id;
  const own = mine.filter((s) => !s.for).slice(-2);
  if (own.length < 2 || own.some((s) => s.correct >= LOW)) return id;
  const below = CELLS.slice(0, CELLS.indexOf(c)).reverse().find((x) => listenCell(x) && x.kind !== 'supra'); // 소리 높낮이는 낱말을 다지는 데 맞지 않아 건너뛴다
  return below ? below.id : id;
}
// 복습할 칸: 넘은 듣기 칸 중 가장 오래전에 한 칸
function reviewCell(d = data) {
  const lastAt = (id) => Math.max(0, ...(d.sessions || []).filter((s) => s.cell === id).map((s) => s.at || 0));
  const done = CELLS.filter((c) => listenCell(c) && goodDates(c, d).size >= needDays(c, d));
  return done.sort((a, b) => lastAt(a.id) - lastAt(b.id))[0]?.id || null;
}
const roundsOn = (date, d = data) => (d.sessions || []).filter((s) => s.date === date).length
  + (d.speakLog || []).filter((s) => s.date === date).length + (d.gates || []).filter((g) => g.date === date).length;
const practiceDates = (d = data) => new Set([...(d.sessions || []), ...(d.speakLog || []), ...(d.gates || []), ...(d.noiseRecs || []), ...(d.retests || []), ...(d.supraRuns || [])].map((s) => s.date));
// 그때 틀린 문제 다시 듣기: 2주 넘게 지났고 아직 다시 풀지 않은 문제. 같은 문제는 한 번만, 오래된 것부터.
const missKey = (m) => `${m.kind}|${m.say || m.answer}`;
function retestPool(d = data) {
  const seen = new Set();
  return (d.misses || []).filter((m) => {
    if (m.re || !m.options || daysSince(m.date) < RETEST_AGO || seen.has(missKey(m))) return false;
    seen.add(missKey(m)); return true;
  });
}
// 소음 기록을 관문 소음과 같은 잣대의 생활 장면으로 읽는다
function snrScene(snr) {
  if (snr > 12) return '버스·병원 대기실(+12dB)보다 조용한 곳';
  if (snr === 12) return '버스·병원 대기실(+12dB)만큼 시끄러운 곳';
  if (snr > 5) return '버스·병원 대기실(+12dB)과 카페(+5dB) 사이';
  if (snr === 5) return '카페(+5dB)만큼 시끄러운 곳';
  if (snr > 0) return '카페(+5dB)와 식당 모임(0dB) 사이';
  if (snr === 0) return '식당 모임(0dB)만큼 시끄러운 곳';
  return '식당 모임(0dB)보다 시끄러운 곳';
}
const snrSay = (snr) => (snr > 0 ? `말소리가 소음보다 ${snr}dB 클 때까지` : snr === 0 ? '말소리와 소음이 같은 크기일 때까지' : `말소리가 소음보다 ${-snr}dB 작을 때까지`);
// 처음과 지금 소음 기록의 차이. 낮아질수록 더 시끄러운 곳에서 알아들은 것
function snrChange(a, b) {
  const d = a - b;
  return d > 0 ? { cls: 'up', text: `소음 ${d}dB 더 큰 곳까지` } : d < 0 ? { cls: 'down', text: `${-d}dB 조용한 곳까지` } : { cls: '', text: '처음과 같아요' };
}
// 통과까지 남은 것을 한 줄로
function passHint(c) {
  const st = cellState(c);
  if (st === 'done') return gatePassed(c.ch) && goodDates(c).size < needDays(c) ? '관문을 넘어 통과' : '통과';
  if (st === 'soon') return '곧 열려요';
  if (st === 'skip') return '이 기기에서는 말하기를 확인할 수 없어요';
  const bar = c.kind === 'speak' ? '5개 중 4개를 또렷하게 말하면' : '10문제 중 8개 이상 맞히면';
  const got = goodDates(c); const need = needDays(c);
  const times = (k) => `${['', '한', '두', '세', '네'][k] || k} 번`;
  if (need === 1) return `${bar} 통과`;
  if (!got.size) return need === 2 ? `${bar} 한 번, 다른 날 한 번 더 하면 통과` : `${bar.slice(0, -1)}는 날이 ${times(need)}이면 통과`; // 맞히면 → 맞히는 날이
  const more = `다른 날 ${times(need - got.size)} 더 넘으면 통과`;
  return got.has(today()) ? `오늘 넘었어요. ${more}` : more;
}
const routeName = (r) => {
  const m = r.match(/^#(cell|gate)\/(.+)$/);
  if (r === '#weak') return WEAK_CELL.name;
  if (!m) return '';
  return m[1] === 'gate' ? `${m[2]}장 관문 '${GATES[m[2]].title}'` : `${m[2]} ${CELL[m[2]].name}`;
};
const planRoute = (x) => (x[0] === 'g' ? `#gate/${x.slice(1)}` : `#cell/${x}`);
const planHas = (id) => !!data.plan && data.plan.cells.includes(id);

/* ---------- 아이콘 ---------- */

const ICON = {
  path: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c3 0 3-4 7-4s4-4 7-4M5 19a2 2 0 1 0 0 .01M19 11a2 2 0 1 0 0 .01M12 5a2 2 0 1 0 0 .01"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  ear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-5.5 1.6"/><path d="M10 9.5a2 2 0 0 1 4 0c0 1.2-1 1.5-1.4 2.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12h.01"/></svg>',
  doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>',
  mic2: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg>',
  print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3h10v6M7 17H4v-7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v7h-3"/><rect x="7" y="14" width="10" height="7"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h12l-2.5 4.5L17 13H5"/></svg>',
  redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/></svg>',
  wave: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/></svg>',
  walk: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6-2.5-2.5L11 8l3 3h3M9.5 12.5L7 14M14 15l2 6"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15h7l9-9M13 6h6v6"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h7l9 9M19 12v6h-6"/></svg>',
  dial: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
  shape: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15c2.5 0 2.5-6 5-6s2.5 8 5 8 2.5-10 5-10c1.5 0 2 2 3 2"/></svg>',
};

/* ---------- 화면 ---------- */

// 오늘의 연습: 버튼 하나로 판 3개(지금 칸이나 관문, 말하기나 약한 소리, 복습). 숙제가 있으면 숙제 칸을 차례로.
let todayRun = null; // { queue: [주소], i }
function todayQueue() {
  const doneToday = new Set([
    ...data.sessions.filter((s) => s.date === today()).map((s) => `#cell/${s.for || s.cell}`),
    ...data.speakLog.filter((s) => s.date === today() && s.cell).map((s) => `#cell/${s.cell}`),
    ...data.gates.filter((g) => g.date === today()).map((g) => `#gate/${g.ch}`),
  ]);
  let q;
  if (data.plan) {
    const items = data.plan.cells.map(planRoute);
    const k = Math.max(0, items.findIndex((r) => !doneToday.has(r)));
    q = [...items.slice(k), ...items.slice(0, k)];
  } else {
    const step = nextStep();
    const review = reviewCell();
    const lastCell = [...cellsOf(step.ch)].reverse().find(listenCell);
    const first = step.cell ? `#cell/${step.cell}`
      : step.gate && gateTriesToday(step.gate) < GATE_TRIES ? `#gate/${step.gate}`
      : `#cell/${review || lastCell.id}`;
    const sp = Recognition ? [...CELLS].reverse().find((c) => c.kind === 'speak' && c.ch <= Math.max(2, step.ch)) : null;
    const second = sp && `#cell/${sp.id}` !== first ? `#cell/${sp.id}` : weakTop(1).length ? '#weak' : null;
    q = [first, second, review && `#cell/${review}` !== first ? `#cell/${review}` : null].filter(Boolean);
    // 며칠 쉬었다 왔으면 넘었던 칸 복습부터
    const last = [...practiceDates()].sort().pop();
    if (review && last && daysSince(last) >= 3) q = [`#cell/${review}`, ...q.filter((r) => r !== `#cell/${review}`)];
  }
  while (q.length < TODAY_N) q.push(q[q.length % Math.max(1, q.length)] || '#cell/1-1');
  return q.slice(0, TODAY_N);
}
function startToday() {
  unlockAudio(); // 누른 김에 소리를 열어 두어 판마다 '시작'을 다시 누르지 않게 한다
  const queue = todayQueue();
  todayRun = { queue, i: 0 };
  go(queue[0]);
}
// 판이 끝난 뒤 버튼: 오늘의 연습 중이면 다음 판으로 잇고, 아니면 한 판 더와 돌아가기
function roundActions(back, again = true, againLabel = '한 판 더') {
  const run = todayRun;
  const next = run && run.i + 1 < run.queue.length ? run.queue[run.i + 1] : null;
  if (run && !next) todayRun = null;
  return {
    ended: !!run && !next,
    html: next ? `
        <button class="btn primary run-next" id="run-next">이어서 ${esc(routeName(next))}</button>
        <button class="btn" data-go="#home">오늘은 그만</button>` : `
        ${again ? `<button class="btn primary" data-go="${current}">${againLabel}</button>` : ''}
        <button class="btn${again ? '' : ' primary'}" data-go="${run ? '#home' : back}">${run ? '지도로' : '돌아가기'}</button>`,
    bind() {
      const b = view.querySelector('#run-next');
      if (b) b.onclick = () => { unlockAudio(); todayRun = { queue: run.queue, i: run.i + 1 }; go(next); };
    },
  };
}

function setNav(name) {
  document.body.classList.toggle('in-play', name === 'play');
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === name;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

const sceneOf = (g) => (g.noise ? `${SCENE_NAME[g.noise.id]} 소음 ${snrText(g.noise.snr)}` : '🏠 조용한 집');
const tipCard = (i) => {
  const t = LISTEN_TIPS[i];
  return `<section class="panel tip-card">
      <div class="focus-head"><span class="focus-ico">${ICON.bulb}</span><h2 class="panel-title">${t.t}</h2></div>
      <p class="tip-body">${t.b}</p>${t.say ? `<p class="tip-say">“${t.say}”</p>` : ''}
    </section>`;
};

function renderHome() {
  if (data.who == null) return renderWho(true); // 처음 열면 누가 연습하는지부터 고른다
  setNav('home');
  const step = nextStep();
  const ch = chapterOf(step.ch);
  const n = roundsOn(today());
  const hour = new Date().getHours();
  const hello = hour < 12 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후예요' : '편안한 저녁이에요';
  const now = step.cell ? `지금 칸은 <b>${step.cell} ${CELL[step.cell].name}</b>${hasBatchim(CELL[step.cell].name) ? '이에요' : '예요'}. ${passHint(CELL[step.cell])}.`
    : step.gate ? `칸을 다 넘었어요. 관문 <b>'${GATES[step.gate].title}'</b>에 도전할 차례예요.`
    : `${ch.n}장까지 모두 넘었어요. ${chapterOf(7).name} 장은 곧 열려요.`;
  const cur = currentChapter();
  const reN = data.retests.some((r) => r.date === today()) ? 0 : retestPool().length; // 하루 한 번만 권한다

  view.innerHTML = `
    <section class="hero">
      <div class="hero-text">
        <p class="eyebrow">${hello} · 지금 ${ch.n}장</p>
        <h1>${ch.icon} ${ch.name}</h1>
        <p class="lead">${now}</p>
      </div>
      <button class="btn primary block today-btn" id="today">${ICON.play}<span><b>${n >= TODAY_N ? '한 판 더 하기' : n ? '오늘의 연습 이어서' : '오늘의 연습 시작'}</b>
        <small>${data.plan ? '선생님 숙제 · ' : ''}판 ${TODAY_N}개, 8~10분 · 오늘 ${n < TODAY_N ? `${n}/${TODAY_N}판` : `${n}판 했어요`}</small></span></button>
    </section>
    ${data.plan ? (() => {
      const p = data.plan; const t = todayDone(data);
      return `
    <section class="panel plan-card">
      <div class="focus-head">
        <span class="focus-ico">${ICON.doc}</span>
        <div>
          <h2 class="panel-title">선생님 숙제${p.by ? ` <span>${esc(p.by)} 선생님</span>` : ''}</h2>
          <p class="note">하루 ${p.amount}${PLAN_UNIT[p.kind]} · 주 ${p.days}일</p>
        </div>
      </div>
      <div class="plan-bars">
        <div class="plan-bar">
          <span class="plan-lab">오늘 <b>${Math.min(p.amount, t[p.kind === 'm' ? 'min' : 'rounds'])}/${p.amount}${PLAN_UNIT[p.kind]}</b></span>
          <span class="acc-bar"><i style="width:${Math.min(100, Math.round((100 * t[p.kind === 'm' ? 'min' : 'rounds']) / p.amount))}%"></i></span>
        </div>
        <div class="plan-bar">
          <span class="plan-lab">이번 주 <b>${weekDays(data)}/${p.days}일</b></span>
          <span class="acc-bar"><i style="width:${Math.min(100, Math.round((100 * weekDays(data)) / p.days))}%"></i></span>
        </div>
      </div>
      <div class="chips">${p.cells.map((x) => `<span class="chip focus">${esc(planName(x))}</span>`).join('')}</div>
      ${p.memo ? `<p class="note">“${esc(p.memo)}”</p>` : ''}
      <p class="note">위의 '오늘의 연습'을 누르면 숙제를 차례로 이어서 해요.</p>
    </section>`;
    })() : ''}
    ${lingHome()}
    ${checkDue() ? `
    <button class="report-link check-link" data-go="#check">
      <span class="focus-ico">${ICON.ear}</span>
      <span><b>${data.checks.length ? '이달의 듣기 점검' : '첫 듣기 점검'}</b><small>${data.checks.length
        ? `지난 점검(${shortDate(data.checks[data.checks.length - 1].date)})에서 한 달이 지났어요. 같은 20문제로 얼마나 늘었는지 봐요`
        : '같은 20문제를 달마다 풀어 얼마나 늘었는지 봐요. 5분쯤 걸려요'}</small></span>
    </button>` : ''}
    ${reN >= 3 ? `
    <button class="report-link retest-link" data-go="#retest">
      <span class="focus-ico">${ICON.redo}</span>
      <span><b>그때 틀린 문제 다시 듣기</b><small>2주 넘게 지난 판에서 틀린 문제 ${Math.min(reN, RETEST_N)}개를 오늘 다시 들어 봐요</small></span>
    </button>` : ''}
    ${weakTop(3).length ? `
    <section class="panel focus-card">
      <div class="focus-head">
        <span class="focus-ico">${ICON.target}</span>
        <div><h2 class="panel-title">맞춤 연습 중인 소리</h2><p class="note">자주 헷갈린 소리예요. 낱말과 문장 칸에서 이 소리가 든 문제를 더 자주 내요.</p></div>
      </div>
      <div class="chips">${weakTop(3).map(([k]) => `<span class="chip focus">${esc(friendly(k))}</span>`).join('')}</div>
    </section>` : ''}
    ${fitCard()}

    <div class="home-links">
      <button class="report-link speak-link" data-go="#focus">
        <span class="focus-ico">${ICON.target}</span>
        <span><b>집중 연습</b><small>단어·낱소리·문장을 1~10단계로</small></span>
      </button>
      <button class="report-link speak-link" data-go="#vocab">
        <span class="focus-ico">${ICON.doc}</span>
        <span><b>단어장</b><small>장소별 낱말을 눌러 듣기</small></span>
      </button>
      <button class="report-link speak-link" data-go="#supra">
        <span class="focus-ico">${ICON.shape}</span>
        <span><b>소리 구별</b><small>길이·말끝·목소리 가려 듣기</small></span>
      </button>
      <button class="report-link speak-link" data-go="#ling">
        <span class="focus-ico">${ICON.ear}</span>
        <span><b>링 6소리</b><small>아·우·이·쉬·스·음 30초 점검</small></span>
      </button>
    </div>

    <h2 class="section-title">소리길 지도 <span>생활 장소 7곳</span></h2>
    <ol class="map">${CHAPTERS.map((c) => {
      const cells = cellsCounted(c.n);
      const done = cells.filter((x) => cellState(x) === 'done').length;
      const passed = gatePassed(c.n); const open = chapterOpen(c.n);
      const state = !cells.length && !GATES[c.n] ? 'soon' : passed ? 'done' : c.n === cur ? 'current' : open ? 'open' : 'ahead';
      const skipped = !passed && c.n < whoOf().ch; // 유형에 맞춰 건너뛴 장(몸풀기로 해도 된다)
      const sub = state === 'soon' ? '곧 열려요'
        : passed ? `관문 '${GATES[c.n].title}' 넘음`
        : `칸 ${done}/${cells.length}${skipped ? ' · 건너뛰어도 되는 곳' : open ? '' : ' · 관문부터 도전해도 돼요'}`;
      const pct = state === 'soon' ? 0 : passed ? 100 : Math.round((100 * done) / (cells.length + 1));
      return `
      <li class="ch-row ${state}">
        <button class="ch-btn" data-go="#ch/${c.n}" aria-label="${c.n}장 ${c.name}, ${sub}">
          <span class="ch-ico" aria-hidden="true">${c.icon}</span>
          <span class="ch-text"><b>${c.n}장 ${c.name}</b><small>${state === 'current' ? '지금 오르는 곳 · ' : ''}${sub}</small>
            <span class="ch-bar" aria-hidden="true"><i style="width:${pct}%"></i></span></span>
          ${passed ? `<span class="ch-done" aria-hidden="true">${ICON.check}</span>` : ''}
        </button>
      </li>${c.n === 5 ? `
      <li class="flag-row">${ICON.flag}<span><b>생활 깃발</b> 5장 관문을 넘으면 일상 대화 대부분을 해내요</span></li>` : ''}`;
    }).join('')}
    </ol>
    <button class="report-link speak-link" data-go="#speak">
      <span class="focus-ico">${ICON.mic2}</span>
      <span><b>따라 말하기</b><small>들은 말을 소리 내어 따라 하면 발음을 확인해 드려요</small></span>
    </button>
    <section class="panel settings">
      <label class="switch" for="big">
        <input type="checkbox" id="big" ${data.bigText ? 'checked' : ''}>
        <span class="switch-ui" aria-hidden="true"></span>
        글자 크게 보기
      </label>
      <button class="set-row" data-go="#who">
        <span><b>${whoOf().name || '사용자 유형 고르기'}</b><small>듣는 귀 ${EAR_NAME[data.ear]} · 말 빠르기 ${speedName()}</small></span>
        <span class="set-go">바꾸기</span>
      </button>
    </section>
    <p class="note center">훈련용 앱이며 청력 검사나 진단을 대신하지 않아요.</p>`;
  view.querySelector('#big').onchange = (e) => { data.bigText = e.target.checked; persist(); applyTextSize(); };
  view.querySelector('#today').onclick = startToday;
}

// 장 화면: 칸 5개, 관문, 생활 미션, 그 장소에서 써 볼 듣기 요령
function renderChapter(n) {
  setNav('home');
  const c = chapterOf(n); const g = GATES[n];
  const open = chapterOpen(n); const passed = gatePassed(n);
  const tries = gatesOf(n);
  const left = cellsLeft(n);
  const triesToday = gateTriesToday(n);
  let gateNote = '';
  if (g) {
    const total = g.items.reduce((a, it) => a + (it.t === 'talk' ? it.qs.length : 1), 0);
    const best = tries.reduce((a, x) => Math.max(a, x.correct), 0);
    const passDay = tries.find((x) => x.pass)?.date;
    const stuck = !passed && tries.length && daysSince(tries[0].date) >= STUCK_DAYS;
    gateNote = passed ? `${shortDate(passDay)}에 넘었어요. 이 장의 칸은 모두 통과로 쳐요.`
      : [tries.length ? `지금까지 ${tries.length}번 도전했고, 가장 많이 맞힌 것은 ${best}개예요.` : '',
        stuck && n < 6 && !chapterOpen(n + 1) ? `2주가 지났으니 ${gateNeed(total, GATE_STUCK)}개 이상이면 다음 장이 열려요.` : '',
        left.length ? '칸을 다 넘기 전에 먼저 도전해도 돼요. 넘으면 이 장의 칸을 모두 통과로 쳐요.' : '칸을 다 넘었어요. 이제 관문에 도전해 보세요.'].filter(Boolean).join(' ');
    if (triesToday >= GATE_TRIES) gateNote += ' 오늘은 세 번 다 도전했어요. 내일 다시 해요.';
  }
  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow">${n}장${n === currentChapter() && !passed ? ' · 지금 오르는 곳' : ''}</p>
      <h1>${c.icon} ${c.name}</h1>
      <p class="lead">${c.about}</p>
    </header>
    ${open ? '' : `<p class="note ahead-note">아직 앞에 있는 장이에요. 칸은 ${n - 1}장 관문을 넘으면 열리고, 이 장 관문에는 지금 먼저 도전할 수 있어요.</p>`}
    ${!passed && n < whoOf().ch ? `<p class="note ahead-note">${whoOf().name} 사용자는 대개 이 장이 쉬워서 ${whoOf().ch}장부터 시작해요. 몸풀기로 해도 좋아요.</p>` : ''}
    <ol class="cell-list">${cellsOf(n).map((x) => {
      const st = cellState(x);
      const can = x.kind && st !== 'skip' && (open || planHas(x.id));
      const hint = st === 'open' && !open && !planHas(x.id) ? `${n - 1}장 관문을 넘으면 열려요` : passHint(x);
      return `
      <li class="cell-row ${st}${can ? '' : ' off'}">
        <span class="cell-id">${x.id}</span>
        <span class="cell-text"><b>${x.name}${x.kind === 'speak' ? ' <i class="tag">말하기</i>' : ''}</b><small>${x.desc}</small><em>${hint}</em></span>
        ${can ? `<button class="icon-btn play-btn" data-go="#cell/${x.id}" aria-label="${x.id} ${x.name} 연습하기">${ICON.play}</button>` : ''}
      </li>`;
    }).join('')}
    </ol>
    ${g ? `
    <section class="panel gate-card${passed ? ' passed' : ''}">
      <div class="focus-head">
        <span class="focus-ico">${ICON.flag}</span>
        <div><p class="eyebrow">${n}장 관문</p><h2 class="panel-title">${g.title}</h2></div>
      </div>
      <p class="tip-body">${g.about}</p>
      <div class="chips"><span class="chip scene">${sceneOf(g)}</span><span class="chip">15문제 중 12개 이상</span><span class="chip">말로 대답 ${g.items.filter((it) => it.t === 'say').length}개</span></div>
      <p class="note">${gateNote}</p>
      <button class="btn${left.length && !passed ? '' : ' primary'} block" data-go="#gate/${n}" ${triesToday >= GATE_TRIES ? 'disabled' : ''}>${ICON.flag}${passed ? '다시 도전하기' : left.length ? '관문에 먼저 도전하기' : '관문 도전하기'}</button>
    </section>` : `
    <section class="panel gate-card soon">
      <div class="focus-head"><span class="focus-ico">${ICON.flag}</span><div><p class="eyebrow">${n}장 관문</p><h2 class="panel-title">예약 전화</h2></div></div>
      <p class="note">전화 음질로 날짜와 시간을 듣고 말로 확인하는 관문이에요. 곧 열려요.</p>
    </section>`}
    ${n === 5 || n === 6 ? (() => {
      const r = data.noiseRecs[data.noiseRecs.length - 1];
      return `<button class="report-link" data-go="#noise">
      <span class="focus-ico">${ICON.wave}</span>
      <span><b>1분 소음 기록 재기</b><small>${r ? `지난 기록 ${snrText(r.snr)}(${shortDate(r.date)}). ` : ''}카페 소음 속에서 어디까지 알아듣는지 1분 동안 재요</small></span>
    </button>`;
    })() : ''}
    <section class="panel mission">
      <div class="focus-head"><span class="focus-ico">${ICON.walk}</span><div><h2 class="panel-title">생활 미션</h2><p class="note">앱 밖에서 한 번 해 보세요. 확인하지 않아요.</p></div></div>
      <p class="tip-body">${c.mission}</p>
    </section>
    <h2 class="section-title">${c.name}에서 써 볼 요령</h2>
    ${c.tips.map(tipCard).join('')}
    <button class="btn ghost block" data-go="#home">지도로</button>`;
}

let openGroup = 0; // 녹음한 뒤 다시 그려도 보던 묶음을 펼쳐 둔다
async function renderVoices() {
  setNav('voices');
  const keys = await voiceDb.keys();
  const all = new Set([...ALL_WORDS, ...ALL_SENTENCES]);
  const have = new Set(keys.filter((k) => all.has(k)));
  const haveAny = new Set(keys);
  const canRec = !!(navigator.mediaDevices && window.MediaRecorder);
  const groups = [
    ['부르는 말', [...new Set(CALL_SETS.flat())]],
    ['쉬운 단어', [...new Set(WORD_SETS[1].flat())]],
    ['같은 길이 단어', [...new Set(WORD_SETS[2].flat())]],
    ['헷갈리는 단어', [...new Set(WORD_SETS[3].flat())]],
    ['생활 문장', [...new Set(SENTENCE_SETS[1].flat())]],
    ['한 낱말만 다른 문장', [...new Set(SENTENCE_SETS[2].flat())]],
    ['소음 속 문장', NOISE_SENTENCES],
    ['링 6소리 · 2초쯤 길게', LING.map(lingKey)], // 여섯 소리를 다 녹음하면 링 6소리 점검을 이 목소리로 한다
  ];
  const label = (w) => (w.startsWith('링:') ? `${w.slice(2)}~` : w);
  const total = all.size;
  const pct = Math.round((100 * have.size) / total);
  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow">가족 목소리</p>
      <h1>매일 듣는 목소리로<br>연습해요</h1>
      <p class="lead">가족이 단어와 문장을 읽어 녹음하면 문제를 그 목소리로 들려드려요. 1·2장은 가족 목소리로 시작하면 좋아요.</p>
    </header>
    <section class="panel">
      <div class="meter-row"><span>녹음한 단어</span><b>${have.size} / ${total}</b></div>
      <div class="meter"><i style="width:${pct}%"></i></div>
      <label class="switch" for="pref">
        <input type="checkbox" id="pref" ${data.preferFamily ? 'checked' : ''}>
        <span class="switch-ui" aria-hidden="true"></span>
        녹음이 있으면 가족 목소리로 듣기
      </label>
      ${canRec ? '<p class="note">녹음 버튼을 누르고 또박또박 읽어 주세요. 단어는 3초, 문장은 5초 뒤 저절로 멈춰요.</p>'
        : '<p class="note warn">이 화면에서는 녹음을 쓸 수 없어요. 최신 크롬이나 사파리에서 앱 주소를 직접 열어 주세요.</p>'}
    </section>
    ${groups.map(([title, words], gi) => `
      <details class="group" ${gi === openGroup ? 'open' : ''} data-g="${gi}">
      <summary class="section-title">${title} <span>${words.filter((w) => haveAny.has(w)).length} / ${words.length}</span></summary>
      <ul class="word-list">
        ${words.map((w) => `
          <li class="word-row ${haveAny.has(w) ? 'has' : ''}" data-w="${esc(w)}">
            <span class="word">${esc(label(w))}</span>
            <span class="word-state">${haveAny.has(w) ? `${ICON.check}녹음됨` : w.startsWith('링:') ? '합성 소리' : 'AI 음성'}</span>
            <button class="icon-btn" data-act="play" aria-label="${esc(label(w))} 들어 보기">${ICON.speaker}</button>
            <button class="icon-btn rec-btn" data-act="rec" ${canRec ? '' : 'disabled'} aria-label="${esc(label(w))} 녹음">${ICON.mic}</button>
            ${haveAny.has(w) ? `<button class="icon-btn" data-act="del" aria-label="${esc(label(w))} 녹음 지우기">${ICON.trash}</button>` : ''}
          </li>`).join('')}
      </ul>
      </details>`).join('')}`;
  view.querySelectorAll('details.group').forEach((d) => { d.ontoggle = () => { if (d.open) openGroup = +d.dataset.g; }; });
  view.querySelector('#pref').onchange = (e) => { data.preferFamily = e.target.checked; persist(); };
  view.querySelectorAll('.word-row button').forEach((b) => {
    b.onclick = async () => {
      const w = b.closest('.word-row').dataset.w;
      if (b.dataset.act === 'play') {
        b.classList.add('busy');
        const s = LING.find((x) => lingKey(x) === w);
        await (s ? playLing(s, haveAny.has(w)) : playWord(w));
        b.classList.remove('busy'); return;
      }
      if (b.dataset.act === 'del') { await voiceDb.del(w); return renderVoices(); }
      const ok = await recordWord(w, b);
      if (ok) renderVoices();
    };
  });
}

let recording = null;
async function recordWord(word, btn) {
  if (recording) { recording.stop(); return false; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { toast('마이크를 쓸 수 없어요. 브라우저 설정에서 마이크를 허용해 주세요.'); return false; }
  const rec = new MediaRecorder(stream); const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise((res) => { rec.onstop = res; });
  recording = rec;
  const limit = word.length > 4 ? 5000 : 3000; // 단어는 3초, 문장은 5초
  btn.style.setProperty('--dur', `${limit}ms`);
  btn.classList.add('recording'); btn.setAttribute('aria-label', '녹음 멈추기');
  document.querySelectorAll('.word-row button').forEach((x) => { if (x !== btn) x.disabled = true; });
  rec.start();
  const timer = setTimeout(() => rec.state === 'recording' && rec.stop(), limit);
  await done;
  clearTimeout(timer);
  stream.getTracks().forEach((t) => t.stop());
  recording = null;
  if (!chunks.length) return true;
  const blob = new Blob(chunks, { type: rec.mimeType });
  const peak = await peakLevel(blob);
  if (peak != null && peak < 0.02) { toast('목소리가 들리지 않았어요. 마이크 가까이에서 다시 녹음해 주세요.'); return true; }
  await voiceDb.put(word, blob);
  if (peak != null && peak < 0.12) toast('소리가 작게 녹음됐어요. 휴대폰에 조금 더 가까이 대고 다시 녹음하면 좋아요.');
  else if (peak != null && peak > 0.99) toast('소리가 너무 커서 찢어질 수 있어요. 조금 떨어져서 다시 녹음해 보세요.');
  return true;
}

// 녹음의 가장 큰 소리(0~1). 분석할 수 없으면 null
async function peakLevel(blob) {
  try {
    const buf = await audio().decodeAudioData(await blob.arrayBuffer());
    let peak = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
    }
    return peak;
  } catch { return null; }
}

function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}

function renderProgress() {
  setNav('progress');
  const ss = data.sessions;
  const has = practiceDates().size > 0;
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('sv-SE');
    days.push({ key, d, n: ss.filter((s) => s.date === key).reduce((a, s) => a + s.correct, 0) + data.gates.filter((g) => g.date === key).reduce((a, g) => a + g.correct, 0) });
  }
  const top = Math.max(30, Math.ceil(Math.max(...days.map((d) => d.n)) / 10) * 10);
  const weak = Object.entries(data.confusions).filter(([k]) => k !== '단어 길이').sort((a, b) => b[1] - a[1]).slice(0, 5);
  const weakMax = Math.max(1, ...weak.map(([, v]) => v));
  const passedGates = new Set(data.gates.filter((g) => g.pass).map((g) => g.ch)).size;

  // 막대그래프: 날마다 맞힌 문제 수(칸과 관문)
  const W = 320; const H = 150; const L = 30; const B = 22; const bw = (W - L) / 14;
  const y = (v) => (H - B) - ((H - B - 8) * v) / top;
  const chart = `
    <svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 14일 날마다 맞힌 문제 수">
      ${[0, top / 2, top].map((v) => `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}</text>`).join('')}
      ${days.map((d, i) => {
        const x = L + i * bw + bw * 0.18; const w = bw * 0.64; const isToday = i === 13;
        return `<rect x="${x}" y="${y(d.n)}" width="${w}" height="${Math.max(0, (H - B) - y(d.n))}" rx="3" class="${isToday ? 'bar today' : 'bar'}"><title>${d.key} ${d.n}개 맞힘</title></rect>
          ${i % 2 === 1 || isToday ? `<text x="${x + w / 2}" y="${H - 6}" class="axis${isToday ? ' strong' : ''}" text-anchor="middle">${isToday ? '오늘' : d.d.getDate()}</text>` : ''}`;
      }).join('')}
    </svg>`;

  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow">나의 기록</p>
      <h1>${has ? '지난날의 나와 견줘 봐요' : '첫 기록을 만들어 봐요'}</h1>
      ${data.demo ? '<span class="chip demo">시연용 예시 기록이에요</span>' : ''}
    </header>
    ${ss.length ? `<button class="report-link" data-go="#report">
      <span class="focus-ico">${ICON.doc}</span>
      <span><b>치료사·보호자용 리포트</b><small>칸, 관문, 약한 소리를 한 장으로 보고 인쇄해요</small></span>
    </button>` : ''}
    ${has ? '' : `
    <section class="panel empty">
      <div class="empty-orb" aria-hidden="true">${ICON.chart}</div>
      <h2 class="panel-title">아직 기록이 없어요</h2>
      <p class="lead">한 판을 마치면 맞힌 개수, 장별 진도, 헷갈린 소리가 여기에 쌓여요. 소리 알아차리기 칸을 하면 높낮이별로 얼마나 작은 소리까지 들리는지도 기록돼요.</p>
      <button class="btn primary block" data-go="#ch/1">${ICON.play}1장 우리 집부터 시작하기</button>
      <button class="btn ghost block" id="demo">시연용 예시 기록으로 둘러보기</button>
    </section>`}
    <section class="tiles"${has ? '' : ' hidden'}>
      <div class="tile"><b>${practiceDates().size}<small>일</small></b><span>연습한 날</span></div>
      <div class="tile"><b>${ss.length + data.speakLog.length + data.gates.length}<small>판</small></b><span>전체 판 수</span></div>
      <div class="tile"><b>${passedGates}<small>개</small></b><span>넘은 관문</span></div>
    </section>
    <section class="panel"${has ? '' : ' hidden'}>
      <h2 class="panel-title">장별 진도</h2>
      <ul class="acc-list ch-list">
        ${CHAPTERS.filter((c) => GATES[c.n]).map((c) => {
          const cells = cellsCounted(c.n);
          const done = cells.filter((x) => cellState(x) === 'done').length;
          const g = gatesOf(c.n); const best = g.reduce((a, x) => Math.max(a, x.correct), 0);
          return `<li><span class="acc-name"><b>${c.n}</b>${c.name}</span>
            <span class="acc-bar"><i style="width:${Math.round((100 * done) / cells.length)}%"></i></span>
            <span class="acc-val">${gatePassed(c.n) ? `${ICON.check}` : `${done}/${cells.length}`}</span></li>
            ${g.length && !gatePassed(c.n) ? `<li class="sub"><span class="note">관문 ${g.length}번 도전, 가장 많이 ${best}/15</span></li>` : ''}`;
        }).join('')}
      </ul>
      <p class="note">막대는 넘은 칸 수예요. 관문을 넘으면 ✓로 바뀌어요.</p>
    </section>
    <section class="panel"${has ? '' : ' hidden'}>
      <h2 class="panel-title">최근 14일 맞힌 문제</h2>
      ${chart}
    </section>
    <section class="panel"${data.minDb == null ? ' hidden' : ''}>
      <h2 class="panel-title">높낮이별로 들린 가장 작은 소리 <span>1-1 칸</span></h2>
      <ul class="acc-list freq-list">
        ${TONES.map((f) => {
          const db = (data.toneByFreq || {})[f];
          return `<li><span class="acc-name">${FREQ_NAME[f]} <small>${f}Hz</small></span>
            <span class="acc-bar"><i style="width:${db == null ? 0 : Math.round((-db / 60) * 100)}%"></i></span>
            <span class="acc-val">${db == null ? '–' : `${db}dB`}</span></li>`;
        }).join('')}
      </ul>
      <p class="note">막대가 길수록 더 작은 소리까지 들은 거예요. 기준 음량보다 몇 dB 작게 들었는지 보여 줘요. 높은 소리 쪽이 짧다면 치료사 선생님께 알려 주세요.</p>
    </section>
    <section class="panel"${has ? '' : ' hidden'}>
      <h2 class="panel-title">자주 헷갈린 소리</h2>
      ${weak.length ? `<ul class="weak-list">${weak.map(([k, v]) => `
          <li><span class="weak-k">${esc(friendly(k))}</span><span class="weak-bar"><i style="width:${(100 * v) / weakMax}%"></i></span><b>${v}회</b></li>`).join('')}</ul>
        <p class="note">낱말과 문장 속 낱말에서 틀린 답을 자모 단위로 비교했어요. 이 소리가 든 문제를 더 자주 내요.</p>`
        : '<p class="note">낱말 칸을 하면 어떤 소리를 헷갈리는지 알려 드려요.</p>'}
    </section>
    <section class="panel check-panel">
      <h2 class="panel-title">월간 듣기 점검 <span>같은 20문제</span></h2>
      ${data.checks.length ? (() => {
        const cs = data.checks; const a = cs[0]; const b = cs[cs.length - 1];
        return `${cs.length > 1 ? `<div class="check-compare">
          <div><span>처음</span><b>${a.score}<small>점</small></b><em>${shortDate(a.date)}</em></div>
          <i aria-hidden="true">→</i>
          <div><span>최근</span><b>${b.score}<small>점</small></b><em>${shortDate(b.date)}</em></div>
          <strong class="${b.score > a.score ? 'up' : ''}">${b.score > a.score ? '▲' : b.score < a.score ? '▼' : ''}${Math.abs(b.score - a.score)}점</strong>
        </div>` : `<div class="check-compare one"><div><span>첫 점검</span><b>${b.score}<small>점</small></b><em>${shortDate(b.date)}</em></div></div>`}
        <p class="note">${cs.length > 1 ? `${cs.length}번 점검했어요. ` : '이 점수가 앞으로 견줄 기준이에요. '}${checkDue() ? '한 달이 지나 다시 점검할 때예요.' : `다음 점검은 ${shortDate(addDays(b.date, CHECK_EVERY))}쯤이에요.`}</p>`;
      })() : '<p class="note">아직 점검 기록이 없어요. 첫 점수가 앞으로 견줄 기준이 돼요.</p>'}
      <button class="btn block${checkDue() ? ' primary' : ''}" data-go="#check">${ICON.ear}${data.checks.length ? '지금 점검하기' : '첫 점검 하기'}</button>
    </section>
    <section class="panel check-panel nrec-panel">
      <h2 class="panel-title">1분 소음 기록 <span>카페 소음</span></h2>
      ${data.noiseRecs.length ? (() => {
        const rs = data.noiseRecs; const a = rs[0]; const b = rs[rs.length - 1]; const ch = snrChange(a.snr, b.snr);
        return `${rs.length > 1 ? `<div class="check-compare">
          <div><span>처음</span><b>${snrText(a.snr)}</b><em>${shortDate(a.date)}</em></div>
          <i aria-hidden="true">→</i>
          <div><span>최근</span><b>${snrText(b.snr)}</b><em>${shortDate(b.date)}</em></div>
          <strong class="${ch.cls}">${ch.text}</strong>
        </div>` : `<div class="check-compare one"><div><span>첫 기록</span><b>${snrText(b.snr)}</b><em>${shortDate(b.date)}</em></div></div>`}
        <p class="note">${ida(snrScene(b.snr))}. 숫자가 낮을수록 더 시끄러운 곳에서 알아들은 거예요.</p>`;
      })() : '<p class="note">카페 소음 속에서 1분 동안 문장을 들어요. 알아들으면 소음이 커지고 놓치면 작아져서, 끝났을 때의 소음 크기가 기록이 돼요. 문장 칸(4장)을 해 본 뒤에 재면 좋아요.</p>'}
      <button class="btn block" data-go="#noise">${ICON.wave}${data.noiseRecs.length ? '다시 재기' : '처음 재기'}</button>
    </section>
    ${lingPanel()}
    <button class="report-link" data-go="#maps">
      <span class="focus-ico">${ICON.dial}</span>
      <span><b>기기 조절 일지</b><small>${data.maps.length ? `${data.maps.length}번 적었어요 · ` : ''}매핑·보청기 조절 날짜와 그 전후 점수</small></span>
    </button>
    ${data.retests.length ? (() => {
      const n = data.retests.reduce((a, r) => a + r.n, 0); const k = data.retests.reduce((a, r) => a + r.correct, 0);
      return `<section class="panel">
      <h2 class="panel-title">그때 틀린 문제 다시 듣기</h2>
      <p class="lead">2주 넘게 지나 다시 푼 ${n}문제 중 <b>${k}개</b>를 맞혔어요(${data.retests.length}번).</p>
      <p class="note">못 맞힌 문제는 2주 뒤에 다시 나와요.</p>
    </section>`;
    })() : ''}
    <button class="report-link" data-go="#clinic">
      <span class="focus-ico">${ICON.target}</span>
      <span><b>선생님용 화면</b><small>숙제를 내고 여러 사람의 기록을 한 줄씩 모아 봐요</small></span>
    </button>
    <div class="actions">
      <button class="btn" id="export">기록 파일 받기</button>
      <button class="btn ghost" id="reset">기록 지우기</button>
    </div>
    ${has ? `<button class="btn ghost block" id="demo">${data.demo ? '예시 기록 끄고 내 기록으로' : '시연용 예시 기록 채우기'}</button>` : ''}`;
  view.querySelector('#demo').onclick = () => {
    if (data.demo) { clearDemo(); toast('예시 기록을 지웠어요.'); } else { loadDemo(); toast('5장 카페까지 온 사람의 기록을 채웠어요.'); }
    renderProgress();
  };
  view.querySelector('#export').onclick = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `소리길_기록_${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const reset = view.querySelector('#reset');
  reset.onclick = () => {
    if (reset.dataset.confirm) {
      data = Object.assign(fresh(), { preferFamily: data.preferFamily, bigText: data.bigText, who: data.who, ear: data.ear, talkSpeed: data.talkSpeed });
      persist(); renderProgress(); toast('기록을 지웠어요.');
    } else { reset.dataset.confirm = '1'; reset.textContent = '한 번 더 누르면 지워져요'; reset.classList.add('danger'); }
  };
}

/* ---------- 따라 말하기 ---------- */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SPEAK_N = 5;
const hasNumber = (t) => /(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|삼|사|오|육|칠|팔|구|십) ?(번|시|개|층|원|월|잔|분|살)/.test(t); // 음성 인식이 숫자로 적는 문장은 뺀다
const SPEAK_MODES = {
  word: { name: '쉬운 단어', items: () => [...new Set([...WORD_SETS[1], ...WORD_SETS[2]].flat())] },
  pair: { name: '헷갈리는 단어', items: () => [...new Set(WORD_SETS[3].flat())] },
  sentence: { name: '생활 문장', items: () => [...new Set(SENTENCE_SETS[1].flat())].filter((t) => !hasNumber(t)) },
};
const jamo = (t) => [...t].flatMap((ch) => decompose(ch)?.filter(Boolean) || [ch]);
const plain = (t) => t.replace(/[\s.,!?~'"“”‘’·]/g, '');
// 두 배열의 편집 거리와 정렬(같음/바뀜/빠짐/더함)
function align(a, b) {
  const m = a.length; const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const ops = []; let i = m; let j = n;
  while (i || j) {
    if (i && j && dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { ops.unshift([a[i - 1] === b[j - 1] ? 'same' : 'sub', a[i - 1], b[j - 1]]); i--; j--; }
    else if (i && dp[i][j] === dp[i - 1][j] + 1) { ops.unshift(['del', a[i - 1], '']); i--; }
    else { ops.unshift(['ins', '', b[j - 1]]); j--; }
  }
  return { dist: dp[m][n], ops };
}
// 목표 문장과 인식된 말을 비교한다. 점수는 자모가 얼마나 같은지(0~100)
function judge(target, heard) {
  const a = plain(target); const b = plain(heard);
  const { dist } = align(jamo(a), jamo(b));
  const score = Math.max(0, Math.round(100 * (1 - dist / Math.max(jamo(a).length, 1))));
  const { ops } = align([...a], [...b]);
  // 아예 다른 말로 들렸으면 소리 비교는 뜻이 없다. 한두 자모만 다른 글자만 센다
  const diffs = [];
  if (score >= 50) for (const [op, x, y] of ops) {
    const cs = op === 'sub' ? contrasts(x, y) : [];
    if (cs.length && cs.length <= 2) for (const c of cs) if (!diffs.includes(c)) diffs.push(c);
  }
  return { score, ops, diffs };
}
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

// cellId: 말하기 칸(2-5, 3-5)으로 들어왔으면 그 칸의 말로만 하고 칸 통과에 센다
async function renderSpeak(cellId) {
  setNav('play');
  const token = ++playToken;
  const alive = () => token === playToken;
  const cell = cellId ? CELL[cellId] : null;
  const canRec = !!(navigator.mediaDevices && window.MediaRecorder);
  const useAsr = !!Recognition;
  let mode = cell ? cell.mode : data.speakMode && SPEAK_MODES[data.speakMode] ? data.speakMode : 'word';
  const back = cell ? `#ch/${cell.ch}` : '#home';
  view.innerHTML = `
    <div class="play">
      <div class="play-top">
        <button class="quit" data-go="${todayRun ? '#home' : back}" aria-label="그만하고 나가기">${ICON.close}<span>그만</span></button>
        <div class="prog"><span id="pnum">${SPEAK_N}개</span><span class="prog-bar" aria-hidden="true"><i id="pbar"></i></span></div>
      </div>
      <p class="eyebrow center">${cell ? `${cell.id} · ${cell.name}` : `따라 말하기 · <span id="mode-name">${SPEAK_MODES[mode].name}</span>`}</p>
      <div class="stagebox">
        <div class="orb idle" id="orb">${ICON.mic2}</div>
        <h1 class="q" id="q">들은 말을 따라 말해 보세요</h1>
        <p class="lead center" id="hint">${useAsr ? '말한 것을 음성 인식으로 받아 적어 자모 하나하나까지 비교해 드려요.' : '녹음해서 정답과 내 목소리를 나란히 들어 볼 수 있어요.'}</p>
      </div>
      <div id="answers" class="start-box">
        ${cell ? `<p class="note center">${passHint(cell)}.</p>` : `<div class="seg" role="radiogroup" aria-label="연습할 말">
          ${Object.entries(SPEAK_MODES).map(([k, m]) => `<button class="seg-btn${k === mode ? ' on' : ''}" role="radio" aria-checked="${k === mode}" data-m="${k}">${m.name}</button>`).join('')}
        </div>`}
        <button class="btn primary block" id="start" ${useAsr || canRec ? '' : 'disabled'}>시작하기</button>
        ${useAsr ? '<p class="note center">처음 한 번은 마이크 사용을 허락해 주세요. 음성 인식 결과라 참고용이에요.</p>'
          : canRec ? '<p class="note warn center">이 브라우저는 음성 인식이 없어 녹음해서 비교하는 방식으로 연습해요. 크롬이나 사파리에서는 발음을 자동으로 확인해 드려요.</p>'
          : '<p class="note warn center">이 화면에서는 마이크를 쓸 수 없어요. 크롬이나 사파리에서 앱 주소를 열어 주세요.</p>'}
      </div>
    </div>
    <div class="sheet" id="sheet" hidden>
      <div class="sheet-msg"><span class="sheet-icon"></span><div><b id="sheet-title"></b><p id="sheet-text"></p></div></div>
      <div class="compare" id="compare"></div>
      <button class="btn block" id="next">다음</button>
    </div>`;
  const $ = (q) => view.querySelector(q);
  view.querySelectorAll('.seg-btn').forEach((b) => {
    b.onclick = () => {
      mode = b.dataset.m; data.speakMode = mode; persist();
      view.querySelectorAll('.seg-btn').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
      $('#mode-name').textContent = SPEAK_MODES[mode].name;
    };
  });
  await new Promise((r) => { $('#start').onclick = () => { unlockAudio(); r(); }; });
  if (!alive()) return;

  const orb = $('#orb');
  const setOrb = (m) => { orb.className = `orb ${m}`; };
  let busy = false;
  const playing = async (p) => { busy = true; setOrb('playing'); try { return await p; } finally { busy = false; if (alive()) setOrb('idle'); } };
  const pool = SPEAK_MODES[mode].items();
  const picks = [];
  while (picks.length < SPEAK_N) {
    let w = pickHeard(pool); let focus = null;
    if (mode === 'pair') { const t = pickTailored(WORD_SETS[3], (x) => x); if (t.focus) { focus = t.focus; w = pickHeard(t.focus.pair); } }
    if (!picks.some((p) => p.w === w)) picks.push({ w, focus });
  }
  const results = []; const conf = {};
  for (let i = 0; i < SPEAK_N && alive(); i++) {
    $('#pnum').textContent = `${i + 1}번째 / ${SPEAK_N}개`;
    $('#pbar').style.width = `${(100 * i) / SPEAK_N}%`;
    const { w, focus } = picks[i];
    let best = null;
    for (;;) { // 다시 말하기를 누르면 같은 말로 다시
      const r = await attempt(w, focus);
      if (!alive()) return;
      if (r && (r.score == null || !best || r.score > best.score)) best = r; // 녹음 비교는 마지막 녹음을 쓴다
      const again = await sheetChoice(r, w);
      if (!alive()) return;
      if (!again) break;
    }
    const score = (best && best.score) || 0;
    results.push({ w, score });
    if (best && best.diffs) for (const c of best.diffs) conf[c] = (conf[c] || 0) + 1;
  }
  if (!alive()) return;
  const avg = Math.round(results.reduce((a, r) => a + r.score, 0) / results.length);
  const good = results.filter((r) => r.score >= 70).length;
  const wasDone = cell && cellState(cell) === 'done';
  data.speakLog.push({ date: today(), at: Date.now(), mode, n: results.length, score: avg, good, asr: useAsr, ...(cell ? { cell: cell.id } : {}) });
  for (const [k, v] of Object.entries(conf)) data.speakConf[k] = (data.speakConf[k] || 0) + v;
  persist();
  const status = !cell || !useAsr ? '' : !wasDone && cellState(cell) === 'done' ? `${cell.id} 칸을 통과했어요.` : wasDone ? '' : passHint(cell) + '.';
  const acts = roundActions(back);
  view.innerHTML = `
    <div class="play result">
      <p class="eyebrow center">${cell ? `${cell.id} · ${cell.name}` : `따라 말하기 · ${SPEAK_MODES[mode].name}`}</p>
      <h1 class="q">${useAsr ? `${SPEAK_N}개 중 ${good}개를 또렷하게 말했어요` : `${SPEAK_N}개를 녹음해 견줘 봤어요`}</h1>
      ${useAsr ? `<p class="lead center">음성 인식이 알아들은 정도는 평균 ${avg}%예요.${status ? ` ${status}` : ''}</p>` : ''}
      ${acts.ended ? `<p class="lead center">오늘의 연습 ${TODAY_N}판을 마쳤어요.</p>` : ''}
      <section class="panel"><ul class="speak-list">${results.map((r) => `<li><span>${esc(r.w)}</span>${useAsr ? `<b class="${r.score >= 70 ? 'ok' : ''}">${r.score}%</b>` : `<b class="${r.score >= 70 ? 'ok' : ''}">${r.score >= 70 ? '비슷해요' : '다시 연습'}</b>`}<button class="icon-btn" data-say="${esc(r.w)}" aria-label="${esc(r.w)} 다시 듣기">${ICON.speaker}</button></li>`).join('')}</ul>
      ${Object.keys(conf).length ? `<p class="note">다르게 들린 소리: ${Object.keys(conf).map((c) => esc(friendly(c))).join(', ')}</p>` : ''}</section>
      <div class="actions">${acts.html}</div>
    </div>`;
  acts.bind();
  view.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => playWord(b.dataset.say); });

  // 한 번 말하기: 들려주고, 마이크 버튼을 누르면 듣고 비교한다
  async function attempt(w, focus) {
    $('#sheet').hidden = true;
    $('#q').textContent = '들은 말을 따라 말해 보세요';
    $('#hint').innerHTML = (focus ? `<span class="focus-tag">${ICON.target}맞춤 문제 · ${esc(friendly(focus.c))}</span>` : '') + `<button class="pill" id="replay">${ICON.speaker}다시 듣기</button>`;
    $('#replay').onclick = () => { if (!busy) playing(playWord(w)); };
    const micLabel = useAsr ? '누르고 말하기' : '누르고 녹음하기';
    $('#answers').innerHTML = `<button class="btn primary block mic-btn" id="mic" disabled>${ICON.mic2}잘 들어 보세요</button>
      <button class="btn ghost block" id="peek">글자 보기</button>`;
    $('#peek').onclick = () => { $('#q').textContent = w; $('#peek').hidden = true; };
    await playing(playWord(w)); // 다 듣고 나서 말하게 한다
    if (!alive()) return null;
    $('#mic').disabled = false; $('#mic').lastChild.textContent = micLabel;
    for (;;) {
      await new Promise((r) => { $('#mic').onclick = r; });
      if (!alive()) return null;
      const mic = $('#mic'); mic.disabled = true; mic.classList.add('listening');
      setOrb('listening');
      try {
        if (useAsr) {
          mic.lastChild.textContent = '듣고 있어요…';
          const alts = await listenOnce();
          if (!alts.length) { toast('목소리를 못 들었어요. 마이크 가까이에서 다시 말해 주세요.'); continue; }
          const judged = alts.map((h) => ({ heard: h, ...judge(w, h) })).sort((a, b) => b.score - a.score)[0];
          return judged;
        }
        mic.lastChild.textContent = '녹음 중…';
        const blob = await recordClip(w.length > 4 ? 5000 : 3000);
        if (!blob) continue;
        return { blob, score: null };
      } catch (e) {
        toast(e === 'not-allowed' || e === 'service-not-allowed' ? '마이크를 쓸 수 없어요. 브라우저 설정에서 마이크를 허용해 주세요.'
          : e === 'network' ? '음성 인식은 인터넷이 연결돼 있어야 해요.' : '다시 한 번 눌러 말해 주세요.');
      } finally {
        if (alive()) { setOrb('idle'); mic.disabled = false; mic.classList.remove('listening'); mic.lastChild.textContent = micLabel; }
      }
    }
  }

  // 결과를 보여 주고 '다시 말하기'면 true
  function sheetChoice(r, w) {
    const sh = $('#sheet');
    $('#q').textContent = w;
    let ok; let title; let text;
    if (r.score != null) {
      ok = r.score >= 70;
      title = r.score >= 90 ? `정확해요 ${r.score}%` : ok ? `거의 맞았어요 ${r.score}%` : `다시 해 볼까요 ${r.score}%`;
      const heard = r.ops.map(([op, , y]) => (op === 'same' ? esc(y) : y ? `<mark>${esc(y)}</mark>` : '')).join('');
      text = `들린 말: "${heard || esc(r.heard)}"${r.diffs.length ? ` <span class="why">${r.diffs.map((c) => esc(friendly(c))).join(', ')}</span>` : ''}`;
    } else {
      ok = true; title = '두 소리를 비교해 들어 보세요'; text = '비슷하게 들리면 다음으로, 다르면 다시 녹음해 보세요.';
    }
    sh.className = `sheet ${ok ? 'good' : 'bad'}`;
    sh.querySelector('.sheet-icon').innerHTML = ok ? ICON.check : ICON.mic2;
    $('#sheet-title').textContent = title;
    $('#sheet-text').innerHTML = text;
    const url = r.blob ? URL.createObjectURL(r.blob) : null;
    $('#compare').innerHTML = `<button class="pill" data-k="t">${ICON.speaker}정답 듣기</button>${url ? `<button class="pill" data-k="m">${ICON.speaker}내 목소리</button>` : ''}<button class="pill" data-k="a">${ICON.mic2}다시 말하기</button>`;
    const btn = $('#next');
    btn.textContent = r.score == null ? '비슷해요, 다음' : '다음';
    sh.hidden = false;
    return new Promise((res) => {
      const end = (again) => { sh.hidden = true; if (url) URL.revokeObjectURL(url); res(again); };
      $('#compare').querySelector('[data-k="t"]').onclick = () => { if (!busy) playing(playWord(w)); };
      if (url) $('#compare').querySelector('[data-k="m"]').onclick = () => { if (!busy) playing(playUrl(url)); };
      $('#compare').querySelector('[data-k="a"]').onclick = () => end(true);
      btn.onclick = () => { if (r.score == null) r.score = 100; end(false); };
    });
  }
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

/* ---------- 치료사·보호자 리포트 ---------- */

const fmtMin = (sec) => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`; };
const accOf = (list) => (list.length ? Math.round((100 * list.reduce((a, s) => a + s.correct, 0)) / list.reduce((a, s) => a + s.total, 0)) : null);
const FREQ_NAME = { 500: '낮은 소리', 1000: '중간 소리', 2000: '높은 소리', 4000: '아주 높은 소리' };

function renderReport() {
  setNav('progress');
  const ss = data.sessions;
  if (!ss.length) { go('#progress'); return; }
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push({ key: d.toLocaleDateString('sv-SE'), d }); }
  const practiced = new Set(ss.map((s) => s.date));
  const n14 = days.filter((d) => practiced.has(d.key)).length;
  const totalSec = ss.reduce((a, s) => a + (s.sec || 180), 0); // 걸린 시간이 없는 옛 기록은 3분으로 친다

  // 칸별 처음과 최근 정답률(판이 적으면 반씩 나눠 비교). 한 장에 들어가게 최근에 연습한 칸 6개만
  const lastAt = (id) => Math.max(...ss.filter((x) => x.cell === id).map((x) => x.at || 0));
  const played = CELLS.filter((c) => listenCell(c) && ss.some((x) => x.cell === c.id));
  const recentCells = new Set(played.sort((a, b) => lastAt(b.id) - lastAt(a.id)).slice(0, 6).map((c) => c.id));
  const rows = CELLS.filter((c) => recentCells.has(c.id)).map((c) => {
    const l = ss.filter((x) => x.cell === c.id);
    const k = Math.min(5, Math.floor(l.length / 2));
    const first = k ? accOf(l.slice(0, k)) : null; const recent = k ? accOf(l.slice(-k)) : accOf(l);
    return { c, n: l.length, first, recent, done: cellState(c) === 'done' };
  });
  const step = nextStep(); const cur = chapterOf(step.ch);
  const curCells = cellsCounted(step.ch);
  const curTries = gatesOf(step.ch);
  const passedGates = CHAPTERS.filter((c) => gatePassed(c.n)).map((c) => ({ c, g: gatesOf(c.n).find((x) => x.pass) }));
  const weak = weakTop(5).map(([c, n]) => {
    const f = (data.focusLog || {})[c] || { n: 0, ok: 0 };
    const rate = f.n ? Math.round((100 * f.ok) / f.n) : null;
    return { c, n, f, rate, better: f.n >= 3 && rate >= 70 };
  });
  const tone = data.toneByFreq || {};

  // 한눈에 보기: 기록에서 바로 읽히는 사실만 문장으로 만든다
  const lines = [`최근 2주 동안 14일 중 <b>${n14}일</b> 연습했어요${n14 >= 10 ? '. 아주 꾸준해요' : n14 >= 5 ? '' : '. 하루 한 판부터 다시 시작해 보세요'}.`];
  lines.push(`지금 <b>${cur.n}장 ${cur.name}</b>에서 연습하고 있어요(칸 ${curCells.filter((c) => cellState(c) === 'done').length}/${curCells.length} 통과${curTries.length ? `, 관문 '${GATES[cur.n].title}' ${curTries.length}번 도전해 가장 많이 ${curTries.reduce((a, x) => Math.max(a, x.correct), 0)}/15` : ''}).`);
  if (passedGates.length) lines.push(`넘은 관문: ${passedGates.map(({ c, g }) => `${c.n}장 '${GATES[c.n].title}'${GATES[c.n].noise ? `(${SCENE_NAME[GATES[c.n].noise.id].split(' ')[1]} ${snrText(GATES[c.n].noise.snr)})` : ''} ${shortDate(g.date)}`).join(', ')}${gatePassed(5) ? '. 일상 대화 대부분을 해내는 생활 깃발(카페 +5dB)에 닿았어요' : ''}.`);
  const up = rows.filter((r) => r.first != null && r.n >= 4 && r.recent - r.first >= 10).sort((a, b) => (b.recent - b.first) - (a.recent - a.first))[0];
  if (up) lines.push(`${up.c.id} ${up.c.name} 정답률이 <b>${up.first}%에서 ${up.recent}%로</b> 올랐어요.`);
  if (weak.length) lines.push(`가장 자주 헷갈린 소리는 <b>${esc(friendly(weak[0].c))}</b>예요(${weak[0].n}회). 이 소리가 든 문제를 더 자주 내고 있어요${weak[0].rate != null ? `. 맞춤 문제 정답률은 ${weak[0].rate}%예요` : ''}.`);
  if (tone[500] != null && tone[4000] != null && tone[500] - tone[4000] <= -15) lines.push(`아주 높은 소리(4000Hz)는 낮은 소리(500Hz)보다 <b>${tone[4000] - tone[500]}dB 더 커야</b> 들렸어요. 상담 때 확인해 보세요.`);
  const sp = (data.speakLog || []).filter((x) => x.asr); // 녹음 비교(스스로 판단)는 점수에서 뺀다
  if (sp.length) {
    const avg = (l) => Math.round(l.reduce((a, x) => a + x.score, 0) / l.length);
    const k = Math.min(3, Math.floor(sp.length / 2));
    const topSp = Object.entries(data.speakConf || {}).sort((a, b) => b[1] - a[1])[0];
    const [a, b] = k ? [avg(sp.slice(0, k)), avg(sp.slice(-k))] : [null, avg(sp)];
    lines.push(`따라 말하기를 <b>${sp.length}판</b> 했어요. 음성 인식이 알아들은 정도는 ${a == null ? `<b>${b}%</b>예요` : `${a}%에서 <b>${b}%</b>${b > a ? '로 올랐어요' : b < a ? '로 내려갔어요' : '로 같아요'}`}${topSp ? `. 말할 때는 ${esc(friendly(topSp[0]))} 소리가 자주 다르게 들렸어요` : ''}.`);
  }
  const cs = data.checks || [];
  if (cs.length) {
    const a = cs[0]; const b = cs[cs.length - 1];
    lines.unshift(cs.length > 1
      ? `월간 듣기 점검(같은 20문제)은 <b>${a.score}점에서 ${b.score}점으로</b> ${b.score > a.score ? '올랐어요' : b.score < a.score ? '내려갔어요' : '같아요'}(${shortDate(a.date)} → ${shortDate(b.date)}, ${cs.length}회).`
      : `월간 듣기 점검(같은 20문제) 첫 점수는 <b>${b.score}점</b>이에요(${shortDate(b.date)}). 다음 점검과 견줘 볼게요.`);
  }
  const rs = data.noiseRecs || [];
  if (rs.length) {
    const a = rs[0]; const b = rs[rs.length - 1];
    lines.splice(cs.length ? 1 : 0, 0, rs.length > 1 && a.snr !== b.snr
      ? `1분 소음 기록(카페 소음)은 <b>${snrText(a.snr)}에서 ${snrText(b.snr)}로</b> ${a.snr > b.snr ? '낮아졌어요' : '높아졌어요'}(${shortDate(a.date)} → ${shortDate(b.date)}).${a.snr > b.snr ? ` 소음이 ${a.snr - b.snr}dB 더 커도 알아들어요.` : ''} 지금은 ${ida(snrScene(b.snr))}.`
      : `1분 소음 기록(카페 소음)은 <b>${snrText(b.snr)}</b>예요(${shortDate(b.date)}). ${ida(snrScene(b.snr))}.`);
  }
  const rt = data.retests || [];
  if (rt.length) lines.push(`2주 넘게 지나 다시 푼 틀린 문제 ${rt.reduce((a, r) => a + r.n, 0)}개 중 <b>${rt.reduce((a, r) => a + r.correct, 0)}개</b>를 맞혔어요.`);
  const ls = (data.lings || []).filter((x) => x.date >= days[0].key);
  if (ls.length) {
    const missN = {}; for (const x of ls) for (const id of x.miss) missN[id] = (missN[id] || 0) + 1;
    const top = Object.entries(missN).sort((a, b) => b[1] - a[1])[0];
    const drop = lingDrop();
    lines.push(`링 6소리 점검을 최근 2주에 <b>${ls.length}번</b> 했고 평균 <b>${lingAvg(ls)}개</b>를 알아들었어요${top ? `. 가장 자주 놓친 소리는 '${LING_BY[top[0]].say}'(${top[1]}번)예요` : ''}${drop && daysSince(drop.date) <= 7 ? `. ${shortDate(drop.date)}에 갑자기 떨어졌어요(${drop.why.replace(/요\.$/, '요')}). 기기 점검이나 매핑이 필요한지 확인해 보세요` : ''}.`);
  }
  const maps = [...(data.maps || [])].sort((a, b) => a.date.localeCompare(b.date));
  const lastMap = maps[maps.length - 1];
  if (lastMap) {
    const e = mapEffect(lastMap);
    const has = (w) => w.acc != null || w.ling != null;
    lines.push(`${shortDate(lastMap.date)}에 ${lastMap.ear !== 'both' ? `${EAR_NAME[lastMap.ear]} ` : ''}${MAP_DID[lastMap.kind] || MAP_DID.etc}.${has(e.before) && has(e.after) ? ` 전 7일 ${effText(e.before)} → 뒤 7일 <b>${effText(e.after)}</b>.` : ' 전후를 견줄 기록이 아직 모자라요.'}`);
  }

  // 날마다 정답률 꺾은선(한 계열)
  const W = 340; const H = 170; const L = 38; const R = 34; const T = 14; const B = 24;
  const x = (i) => L + (i * (W - L - R)) / 13;
  const y = (v) => T + ((H - T - B) * (100 - v)) / 100;
  const pts = days.map((d, i) => ({ i, d, a: accOf(ss.filter((s) => s.date === d.key)) })).filter((p) => p.a != null);
  const last = pts[pts.length - 1];
  const chart = `
    <svg class="bars line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 14일 하루 정답률">
      ${[0, 50, 100].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}%</text>`).join('')}
      ${days.map((d, i) => (i % 3 === 1 || i === 13 ? `<text x="${x(i)}" y="${H - 6}" class="axis${i === 13 ? ' strong' : ''}" text-anchor="middle">${i === 13 ? '오늘' : d.d.getDate()}</text>` : '')).join('')}
      ${pts.length > 1 ? `<polyline class="line" points="${pts.map((p) => `${x(p.i)},${y(p.a)}`).join(' ')}"/>` : ''}
      ${pts.map((p) => `<g class="pt"><circle cx="${x(p.i)}" cy="${y(p.a)}" r="12" class="hit"/><circle cx="${x(p.i)}" cy="${y(p.a)}" r="4.5" class="dot"/><title>${p.d.key} 정답률 ${p.a}%</title></g>`).join('')}
      ${last ? `<text x="${x(last.i) + 9}" y="${y(last.a) + 4}" class="axis strong">${last.a}%</text>` : ''}
    </svg>`;

  view.innerHTML = `
    <article class="report">
      <header class="report-head">
        <div>
          <p class="eyebrow">소리길 청능훈련 리포트</p>
          <h1><span id="rname-view">${esc(data.reportName || '')}</span>${data.reportName ? ' 님의' : ''} 훈련 기록</h1>
          <p class="note">기간 ${ss[0].date} ~ ${today()} · 만든 날 ${today()}${whoOf().name ? ` · ${whoOf().name}` : ''}${earSide() ? ` · ${EAR_NAME[data.ear]}로 연습` : ''}${data.demo ? ' · 시연용 예시 기록' : ''}</p>
        </div>
        <span class="report-logo" aria-hidden="true">${ICON.path}</span>
      </header>
      <label class="field no-print">이름 <input id="rname" value="${esc(data.reportName || '')}" placeholder="이름을 적으면 리포트에 나와요" autocomplete="off"></label>

      <section class="kpis">
        <div class="tile"><b>${n14}<small>/14일</small></b><span>최근 2주 연습</span></div>
        <div class="tile"><b>${ss.length}<small>판</small></b><span>전체 판 수</span></div>
        <div class="tile"><b class="small-num">${fmtMin(totalSec)}</b><span>전체 연습 시간</span></div>
        <div class="tile"><b>${passedGates.length}<small>/6</small></b><span>넘은 관문</span></div>
      </section>
      <div class="att" aria-label="최근 14일 연습한 날">${days.map((d) => `<i class="${practiced.has(d.key) ? 'on' : ''}" title="${d.key}${practiced.has(d.key) ? ' 연습함' : ''}"></i>`).join('')}</div>

      <section class="panel p-sum">
        <h2 class="panel-title">한눈에 보기</h2>
        <ul class="summary">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
      </section>

      <section class="panel p-chart">
        <h2 class="panel-title">하루 정답률 <span>최근 14일, 모든 칸</span></h2>
        ${chart}
      </section>

      <section class="panel p-stages">
        <h2 class="panel-title">칸별 변화 <span>최근 연습한 칸</span></h2>
        <table class="rtable">
          <thead><tr><th>칸</th><th>판 수</th><th>처음</th><th>최근</th><th>변화</th><th>통과</th></tr></thead>
          <tbody>${rows.map((r) => {
            const diff = r.first != null && r.recent != null ? r.recent - r.first : null;
            return `<tr><th scope="row"><b class="n cid">${r.c.id}</b>${r.c.name}</th><td>${r.n}</td>
              <td>${r.first == null ? '–' : r.first + '%'}</td><td>${r.recent == null ? '–' : r.recent + '%'}</td>
              <td class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff == null ? '–' : `${diff > 0 ? '▲' : diff < 0 ? '▼' : ''}${Math.abs(diff)}`}</td>
              <td class="${r.done ? 'up' : ''}">${r.done ? '통과' : '–'}</td></tr>`;
          }).join('')}</tbody>
        </table>
        <p class="note">처음과 최근은 각각 앞뒤 최대 5판의 정답률이에요. 칸은 10문제 중 8개 이상인 날이 ${needDays({ ch: 3 })}번(1·2장은 ${needDays({ ch: 1 })}번)이면 통과해요.</p>
      </section>

      <section class="panel p-weak"${weak.length ? '' : ' hidden'}>
        <h2 class="panel-title">자주 헷갈린 소리 <span>맞춤 출제 대상</span></h2>
        <table class="rtable">
          <thead><tr><th>소리</th><th>틀림</th><th>맞춤 문제 정답</th><th>상태</th></tr></thead>
          <tbody>${weak.map((w) => `<tr><th scope="row">${esc(friendly(w.c))}</th><td>${w.n}회</td>
            <td>${w.f.n ? `${w.rate}% <small>${w.f.ok}/${w.f.n}</small>` : '–'}</td>
            <td><span class="status ${w.better ? 'good' : 'warn'}">${w.better ? `${ICON.check}좋아짐` : `${ICON.target}집중`}</span></td></tr>`).join('')}</tbody>
        </table>
        <p class="note">맞춤 문제 정답률이 70% 넘게 3번 이상 나오면 '좋아짐'으로 바뀌고, 그 소리는 조금씩 덜 나와요.</p>
      </section>

      <section class="panel p-freq"${Object.keys(tone).length ? '' : ' hidden'}>
        <h2 class="panel-title">높낮이별로 들린 가장 작은 소리 <span>1-1 칸</span></h2>
        <ul class="acc-list freq-list">${TONES.map((f) => `<li><span class="acc-name">${FREQ_NAME[f]} <small>${f}Hz</small></span>
          <span class="acc-bar"><i style="width:${tone[f] == null ? 0 : Math.round((-tone[f] / 60) * 100)}%"></i></span>
          <span class="acc-val">${tone[f] == null ? '–' : `${tone[f]}dB`}</span></li>`).join('')}</ul>
        <p class="note">기기 음량 기준으로 몇 dB 작게까지 들었는지예요. 기기마다 달라서 청력 검사 결과와 같지 않아요.</p>
      </section>

      <section class="panel p-maps"${maps.length ? '' : ' hidden'}>
        <h2 class="panel-title">기기 조절 전후 <span>전 7일 → 뒤 7일</span></h2>
        <table class="rtable">
          <thead><tr><th>날짜</th><th>정답률</th><th>링 6소리</th></tr></thead>
          <tbody>${maps.slice(-4).reverse().map((m) => {
            const e = mapEffect(m);
            const cell = (a, b, unit) => (a == null && b == null ? '–' : `${a == null ? '–' : a + unit} → ${b == null ? '–' : `<b>${b}${unit}</b>`}`);
            return `<tr><th scope="row">${shortDate(m.date)} <small>${esc(MAP_KIND[m.kind] || '')}${m.ear !== 'both' ? ` · ${EAR_NAME[m.ear]}` : ''}</small></th>
              <td>${cell(e.before.acc, e.after.acc, '%')}</td><td>${cell(e.before.ling, e.after.ling, '개')}</td></tr>`;
          }).join('')}</tbody>
        </table>
        <p class="note">정답률은 그동안 한 칸 판을 모두 모은 것이라, 연습한 칸이 바뀌면 함께 달라질 수 있어요.</p>
      </section>

      <section class="panel p-memo">
        <h2 class="panel-title">치료사·보호자 메모</h2>
        <textarea id="memo" rows="4" placeholder="상담 내용, 다음 목표 등을 적어 두세요.">${esc(data.reportMemo || '')}</textarea>
      </section>
      <p class="note center p-foot">소리길은 훈련용 앱이며 청력 검사나 진단을 대신하지 않아요.${Object.keys(tone).length ? ' 높낮이별 dB는 기기 음량 기준이라 청력 검사 결과와 같지 않아요.' : ''}</p>
    </article>
    <div class="actions no-print">
      <button class="btn primary" id="print">${ICON.print}인쇄·PDF</button>
      <button class="btn" data-go="#progress">기록으로</button>
    </div>
    <p class="note center no-print">인쇄 창에서 'PDF로 저장'을 고르면 파일로 보낼 수 있어요.</p>`;
  const $ = (q) => view.querySelector(q);
  $('#rname').oninput = (e) => {
    data.reportName = e.target.value.trim(); persist();
    $('#rname-view').parentElement.innerHTML = `<span id="rname-view">${esc(data.reportName)}</span>${data.reportName ? ' 님의' : ''} 훈련 기록`;
  };
  $('#memo').oninput = (e) => { data.reportMemo = e.target.value; persist(); };
  $('#print').onclick = () => { try { window.print(); } catch { toast('이 화면에서는 인쇄할 수 없어요. 크롬에서 열어 주세요.'); } };
}

/* ---------- 선생님 숙제 ---------- */

// 숙제는 서버 없이 링크 하나에 담는다(선생님이 링크나 QR을 보내면 그 사람 기기에만 저장된다).
const b64u = {
  enc: (s) => btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))),
};
const PLAN_UNIT = { m: '분', r: '판' };
// 숙제에 넣을 수 있는 것: 만든 칸과 관문('g5'는 5장 관문)
const planOk = (x) => (x[0] === 'g' ? !!GATES[x.slice(1)] : !!CELL[x] && !!CELL[x].kind && !CELL[x].weak);
const planName = (x) => (x[0] === 'g' ? `${x.slice(1)}장 관문` : `${x} ${CELL[x].name}`);
const planLink = (p) => `${location.href.split('#')[0]}#plan/${b64u.enc(JSON.stringify({ v: 2, by: p.by, c: p.cells, k: p.kind, a: p.amount, d: p.days, m: p.memo }))}`;

// 링크로 받은 값은 남이 고칠 수 있으니 범위를 다시 확인한다.
function planUnpack(code) {
  try {
    const j = JSON.parse(b64u.dec(code));
    const raw = Array.isArray(j.c) ? j.c.map(String) : Array.isArray(j.st) ? j.st.map((n) => PLAN_STAGE[n]) : []; // st: 단계로 적던 옛 링크
    const cells = [...new Set(raw.filter((x) => x && planOk(x)))].slice(0, 12);
    if (!cells.length) return null;
    const kind = j.k === 'r' ? 'r' : 'm';
    const num = (v, d, max) => Math.min(max, Math.max(1, Math.round(Number(v) || d)));
    return {
      by: String(j.by || '').slice(0, 20), cells, kind,
      amount: num(j.a, kind === 'm' ? 10 : 3, kind === 'm' ? 120 : 20),
      days: num(j.d, 5, 7), memo: String(j.m || '').slice(0, 200), at: Date.now(),
    };
  } catch { return null; }
}

const weekStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toLocaleDateString('sv-SE'); }; // 월요일부터
const weekDays = (d) => { const w = weekStart(); return [...practiceDates(d)].filter((x) => x >= w).length; };
const todayDone = (d) => {
  const t = [...(d.sessions || []), ...(d.gates || [])].filter((s) => s.date === today());
  const sp = (d.speakLog || []).filter((s) => s.date === today());
  return { rounds: t.length + sp.length, min: Math.round((t.reduce((a, s) => a + (s.sec || 180), 0) + sp.length * 120) / 60) };
};

function renderPlanInvite(code) {
  setNav('home');
  const p = planUnpack(code);
  if (!p) {
    view.innerHTML = `<section class="panel empty">
      <div class="empty-orb" aria-hidden="true">${ICON.doc}</div>
      <h2 class="panel-title">숙제 링크를 읽을 수 없어요</h2>
      <p class="lead">링크가 잘린 것 같아요. 선생님께 링크를 다시 받아 주세요.</p>
      <button class="btn primary block" data-go="#home">처음으로</button></section>`;
    return;
  }
  const unit = PLAN_UNIT[p.kind];
  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow">선생님이 보낸 숙제</p>
      <h1>${p.by ? `${esc(p.by)} 선생님이<br>` : ''}연습할 거리를 보냈어요</h1>
    </header>
    <section class="panel focus-card">
      <div class="focus-head">
        <span class="focus-ico">${ICON.target}</span>
        <div>
          <h2 class="panel-title">하루 ${p.amount}${unit}, 주 ${p.days}일</h2>
          <p class="note">숙제에 든 칸과 관문이에요. 받으면 집 화면에 오늘과 이번 주 진도가 같이 나와요.</p>
        </div>
      </div>
      <div class="chips">${p.cells.map((x) => `<span class="chip focus">${esc(planName(x))}</span>`).join('')}</div>
      ${p.memo ? `<p class="lead">“${esc(p.memo)}”</p>` : ''}
    </section>
    <div class="actions">
      <button class="btn primary" id="take">${ICON.check}숙제 받기</button>
      <button class="btn ghost" data-go="#home">나중에</button>
    </div>
    <p class="note center">숙제는 이 기기에만 저장돼요. 기록이 선생님께 저절로 가지는 않아요.</p>`;
  view.querySelector('#take').onclick = () => {
    data.plan = p; persist();
    go('#home'); toast('숙제를 받았어요. 집 화면에서 진도를 볼 수 있어요.');
  };
}

// 기록 파일(기록 > 기록 파일 받기)에서 환자 한 명의 요약을 만든다
function patientRow(raw, name) {
  const d = migrate(Object.assign(fresh(), JSON.parse(JSON.stringify(raw))));
  const ss = d.sessions;
  const checks = d.checks;
  const step = nextStep(d);
  const last = [...practiceDates(d)].sort().pop() || null;
  return {
    name: name || '이름 없음', who: WHO[d.who]?.name || '',
    last, week: weekDays(d), planDays: d.plan?.days || null, rounds: ss.length,
    ch: step.ch, now: step.cell || (step.gate ? '관문' : '복습'),
    gates: new Set(d.gates.filter((g) => g.pass).map((g) => g.ch)).size,
    acc: ss.length ? accOf(ss.slice(-5)) : null,
    weak: Object.entries(d.confusions || {}).filter(([k]) => k !== '단어 길이').sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => friendly(k)),
    check: checks.length ? { first: checks[0].score, last: checks[checks.length - 1].score, n: checks.length } : null,
    nrec: d.noiseRecs.length ? { first: d.noiseRecs[0].snr, last: d.noiseRecs[d.noiseRecs.length - 1].snr, n: d.noiseRecs.length } : null,
  };
}

let clinicRows = null; // 불러온 환자 요약(예시를 지우면 빈 배열)
function renderClinic() {
  setNav('progress');
  if (!clinicRows) clinicRows = demoPatients().map((d) => Object.assign(patientRow(d, d.reportName), { demo: true }));
  const form = Object.assign({ by: '', cells: ['3-1', '4-1'], kind: 'm', amount: 10, days: 5, memo: '' }, clinicForm);
  const unit = PLAN_UNIT[form.kind];
  const dayName = (s) => (s ? `${s.slice(5, 7)}/${s.slice(8, 10)}` : '–');
  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow">선생님용 화면</p>
      <h1>숙제를 내고<br>기록을 모아 봐요</h1>
      <p class="note">치료사·선생님용 화면이에요. 보호자에게는 숙제 링크나 QR만 보내면 돼요.</p>
    </header>

    <section class="panel">
      <h2 class="panel-title">숙제 만들기</h2>
      <label class="field">선생님 이름 <input id="by" value="${esc(form.by)}" placeholder="예: 김민정" autocomplete="off" maxlength="20"></label>
      <p class="field-label">연습할 칸과 관문</p>
      <div class="cell-pick">${CHAPTERS.filter((c) => GATES[c.n]).map((c) => `
        <div class="pick-row"><span class="pick-ch">${c.n}장 ${c.name}</span><div class="stage-pick">${[...cellsOf(c.n).filter((x) => x.kind).map((x) => x.id), `g${c.n}`].map((x) => `
          <button type="button" data-cell="${x}" class="${form.cells.includes(x) ? 'on' : ''}" aria-pressed="${form.cells.includes(x)}" title="${esc(planName(x))}">${x[0] === 'g' ? '관문' : x}</button>`).join('')}</div></div>`).join('')}</div>
      <div class="two-col">
        <label class="field">하루 분량
          <span class="amount">
            <input id="amount" type="number" min="1" max="${form.kind === 'm' ? 120 : 20}" value="${form.amount}" inputmode="numeric">
            <select id="kind"><option value="m"${form.kind === 'm' ? ' selected' : ''}>분</option><option value="r"${form.kind === 'r' ? ' selected' : ''}>판</option></select>
          </span>
        </label>
        <label class="field">주 며칠 <input id="days" type="number" min="1" max="7" value="${form.days}" inputmode="numeric"></label>
      </div>
      <label class="field">보호자에게 전할 말 <textarea id="memo" rows="2" maxlength="200" placeholder="예: 받침 소리를 천천히 들려주세요.">${esc(form.memo)}</textarea></label>
      <div id="out"></div>
    </section>

    <section class="panel">
      <h2 class="panel-title">환자 기록 모아 보기 <span>기록 파일을 여러 개 골라요</span></h2>
      <p class="note">보호자가 '기록 &gt; 기록 파일 받기'로 보낸 파일을 한 번에 열어 한 줄씩 봅니다. 파일은 이 기기 안에서만 읽어요.</p>
      <div class="actions no-print">
        <label class="btn">기록 파일 열기<input id="files" type="file" accept=".json,application/json" multiple hidden></label>
        <button class="btn ghost" id="clear">목록 비우기</button>
      </div>
      <div class="scroll-x">
        <table class="rtable patients">
          <thead><tr><th>이름</th><th>마지막</th><th>이번 주</th><th>지금</th><th>넘은 관문</th><th>최근 정답</th><th>약한 소리</th><th>월 점검</th><th>소음 기록</th></tr></thead>
          <tbody>${clinicRows.length ? clinicRows.map((r) => `
            <tr><th scope="row">${esc(r.name)}${r.demo ? '<span class="chip demo sm">예시</span>' : ''}${r.who ? `<small class="who-sm">${esc(r.who)}</small>` : ''}</th>
              <td>${dayName(r.last)}</td>
              <td class="${r.planDays && r.week >= r.planDays ? 'up' : ''}">${r.week}${r.planDays ? `/${r.planDays}일` : '일'}</td>
              <td>${r.ch}장 <small>${esc(r.now)}</small></td><td>${r.gates}개</td><td>${r.acc == null ? '–' : `${r.acc}%`}</td>
              <td class="weak-cell">${r.weak.length ? r.weak.map((w) => esc(w)).join(', ') : '–'}</td>
              <td class="${r.check && r.check.last > r.check.first ? 'up' : r.check && r.check.last < r.check.first ? 'down' : ''}">${r.check ? (r.check.n > 1 ? `${r.check.first}→${r.check.last}` : `${r.check.last}`) : '–'}</td>
              <td class="${r.nrec && r.nrec.last < r.nrec.first ? 'up' : r.nrec && r.nrec.last > r.nrec.first ? 'down' : ''}">${r.nrec ? (r.nrec.n > 1 ? `${snrText(r.nrec.first)}→${snrText(r.nrec.last)}` : snrText(r.nrec.last)) : '–'}</td></tr>`).join('')
            : '<tr><td colspan="9" class="center note">목록이 비어 있어요. 기록 파일을 열어 주세요.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="note">'지금'은 오르는 장과 연습 중인 칸, '최근 정답'은 최근 5판 정답률이에요. '이번 주'는 이번 주(월요일부터) 연습한 날수이고, 숙제가 있으면 계획 일수와 함께 보여 줘요. '소음 기록'은 1분 소음 기록의 처음→최근이고 낮을수록 더 시끄러운 곳에서 알아들은 거예요.</p>
    </section>
    <button class="btn ghost block" data-go="#progress">기록으로 돌아가기</button>`;

  const $ = (q) => view.querySelector(q);
  const out = $('#out');
  const paint = () => {
    clinicForm = form;
    if (!form.cells.length) { out.innerHTML = '<p class="note">칸이나 관문을 하나 이상 골라 주세요.</p>'; return; }
    const link = planLink({ by: form.by.trim(), cells: form.cells, kind: form.kind, amount: form.amount, days: form.days, memo: form.memo.trim() });
    let qr = '';
    try { qr = QR.svg(link); } catch { qr = '<p class="note">전할 말이 너무 길어 QR을 만들지 못했어요. 조금 줄여 주세요.</p>'; }
    out.innerHTML = `
      <div class="plan-out">
        <div class="qr-box">${qr}</div>
        <div class="plan-sum">
          <p><b>하루 ${form.amount}${PLAN_UNIT[form.kind]}</b> · 주 ${form.days}일 · ${form.cells.map((x) => esc(planName(x))).join(', ')}</p>
          <p class="note">보호자가 QR을 찍거나 링크를 열면 숙제가 그 기기에 저장돼요.</p>
          <div class="actions no-print">
            <button class="btn primary" id="copy">링크 복사</button>
            <button class="btn" id="open">열어 보기</button>
          </div>
          <input class="link-box" id="link" value="${esc(link)}" readonly aria-label="숙제 링크">
        </div>
      </div>`;
    out.querySelector('#copy').onclick = async () => {
      try { await navigator.clipboard.writeText(link); toast('링크를 복사했어요.'); }
      catch { const i = out.querySelector('#link'); i.select(); toast('링크를 길게 눌러 복사해 주세요.'); }
    };
    out.querySelector('#open').onclick = () => go(`#plan/${link.split('#plan/')[1]}`);
  };
  paint();
  $('#by').oninput = (e) => { form.by = e.target.value; paint(); };
  $('#memo').oninput = (e) => { form.memo = e.target.value; paint(); };
  $('#amount').onchange = (e) => { form.amount = Math.min(form.kind === 'm' ? 120 : 20, Math.max(1, Math.round(+e.target.value || 1))); e.target.value = form.amount; paint(); };
  $('#days').onchange = (e) => { form.days = Math.min(7, Math.max(1, Math.round(+e.target.value || 1))); e.target.value = form.days; paint(); };
  $('#kind').onchange = (e) => {
    form.kind = e.target.value === 'r' ? 'r' : 'm';
    form.amount = form.kind === 'm' ? 10 : 3;
    renderClinic();
  };
  const order = (x) => (x[0] === 'g' ? +x.slice(1) * 10 + 9 : +x[0] * 10 + +x[2]); // 칸 다음에 그 장 관문
  view.querySelectorAll('[data-cell]').forEach((b) => {
    b.onclick = () => {
      const x = b.dataset.cell;
      form.cells = form.cells.includes(x) ? form.cells.filter((y) => y !== x) : [...form.cells, x].sort((a, c) => order(a) - order(c));
      b.classList.toggle('on'); b.setAttribute('aria-pressed', form.cells.includes(x));
      paint();
    };
  });
  $('#clear').onclick = () => { clinicRows = []; renderClinic(); };
  $('#files').onchange = async (e) => {
    const files = [...e.target.files];
    const rows = clinicRows.filter((r) => !r.demo);
    let bad = 0;
    for (const f of files) {
      try {
        const d = JSON.parse(await f.text());
        if (!d || !Array.isArray(d.sessions)) throw new Error('기록이 아니에요');
        rows.push(patientRow(d, (d.reportName || '').trim() || f.name.replace(/\.json$/i, '')));
      } catch { bad++; }
    }
    clinicRows = rows;
    renderClinic();
    toast(bad ? `${files.length - bad}개를 열었고 ${bad}개는 읽지 못했어요.` : `${files.length}개를 열었어요.`);
  };
}
let clinicForm = null; // 화면을 다시 그려도 적던 값을 둔다

/* ---------- 월간 듣기 점검 ---------- */

const CHECK_EVERY = 30; // 며칠마다 권할지
const CHECK_KIND = { word: '단어', sent: '문장', noise: '소음 속 문장' };
const daysSince = (date) => Math.round((new Date(today()) - new Date(date)) / 86400000);
const checkDue = () => { const c = (data.checks || []).slice(-1)[0]; return !c || daysSince(c.date) >= CHECK_EVERY; };
const shortDate = (s) => `${+s.slice(5, 7)}월 ${+s.slice(8, 10)}일`;

async function renderCheck() {
  setNav('play');
  const token = ++playToken;
  const alive = () => token === playToken;
  const prev = (data.checks || []).slice(-1)[0];
  view.innerHTML = `
    <div class="play">
      <div class="play-top">
        <button class="quit" data-go="#home" aria-label="그만하고 나가기">${ICON.close}<span>그만</span></button>
        <div class="prog"><span id="count">20문제</span><span class="prog-bar" aria-hidden="true"><i id="bar"></i></span></div>
      </div>
      <p class="eyebrow center" id="part">이달의 듣기 점검</p>
      <div class="stagebox">
        <div class="orb idle" id="orb">${ICON.ear}</div>
        <h1 class="q" id="q">한 달 동안 얼마나 늘었는지 봐요</h1>
        <p class="lead center" id="hint">단어 8개, 문장 6개, 소음 속 문장 6개예요. 매번 같은 문제라 지난번과 그대로 견줄 수 있어요. 정답은 끝나고 알려 드려요.</p>
      </div>
      <div id="answers" class="start-box">
        <button class="btn block" id="soundcheck">${ICON.speaker}소리 확인하기</button>
        <button class="btn primary block" id="start">점검 시작 <small>5분쯤</small></button>
        <p class="note center">${prev ? `지난 점검: ${shortDate(prev.date)} ${prev.score}점` : '처음 점검한 점수가 앞으로 견줄 기준이 돼요.'} 다시 듣기는 문제마다 한 번씩 할 수 있어요.</p>
      </div>
    </div>`;
  const $ = (s) => view.querySelector(s);
  $('#soundcheck').onclick = () => { unlockAudio(); playEnv('doorbell'); setTimeout(() => playWord('안녕하세요'), 1400); };
  await new Promise((r) => { $('#start').onclick = () => { unlockAudio(); r(); }; });
  if (!alive()) return;
  const orb = $('#orb');
  const parts = { word: [0, 0], sent: [0, 0], noise: [0, 0] };
  const miss = [];

  for (let i = 0; i < CHECK_ITEMS.length && alive(); i++) {
    const it = CHECK_ITEMS[i];
    const sc = it.kind === 'noise' ? NOISE_SCENES[it.scene] : null;
    $('#bar').style.width = `${(100 * i) / CHECK_ITEMS.length}%`;
    $('#count').textContent = `${i + 1}번째 / ${CHECK_ITEMS.length}문제`;
    $('#part').textContent = `이달의 듣기 점검 · ${CHECK_KIND[it.kind]}`;
    $('#q').textContent = sc ? `${sc.name}에서 들린 말은?` : it.kind === 'word' ? '어떤 단어를 들었나요?' : '어떤 문장을 들었나요?';
    $('#hint').innerHTML = (sc ? `<span class="chip scene">${sc.icon} ${sc.name} · 소음 ${snrText(6)}</span>` : '') + `<button class="pill" id="replay">${ICON.speaker}한 번 더 듣기</button>`;
    $('#answers').className = '';
    $('#answers').innerHTML = '';
    const say = () => playWord(it.answer, undefined, 1, true); // 늘 같은 빠르기
    const listen = () => (sc ? withNoise(it.scene, 6, say) : say()); // 소음은 늘 +6dB
    let busy = true;
    const playing = async () => { busy = true; orb.className = 'orb playing'; try { await listen(); } finally { busy = false; if (alive()) orb.className = 'orb idle'; } };
    const replay = $('#replay');
    replay.disabled = true;
    replay.onclick = () => { if (busy) return; replay.disabled = true; replay.textContent = '다시 듣기를 썼어요'; playing(); };
    await playing();
    if (!alive()) return;
    replay.disabled = false;
    const box = $('#answers');
    box.innerHTML = `<div class="choices ${it.kind === 'word' ? 'words' : 'sentences'}">${it.options.map((o, k) =>
      `<button class="choice" data-k="${k}" style="--d:${k * 50}ms"><span class="label">${esc(o)}</span></button>`).join('')}</div>`;
    const k = await new Promise((res) => box.querySelectorAll('.choice').forEach((b) => { b.onclick = () => res(+b.dataset.k); }));
    if (!alive()) return;
    box.querySelectorAll('.choice').forEach((b) => { b.disabled = true; });
    box.querySelector(`[data-k="${k}"]`).classList.add('picked'); // 맞았는지는 끝에 알려 준다
    if (stopNoise) stopNoise();
    const ok = it.options[k] === it.answer;
    parts[it.kind][1]++;
    if (ok) parts[it.kind][0]++; else miss.push(i);
    await wait(450);
  }
  if (!alive()) return;

  const correct = parts.word[0] + parts.sent[0] + parts.noise[0];
  const score = Math.round((100 * correct) / CHECK_ITEMS.length);
  const first = (data.checks || [])[0];
  data.checks = [...(data.checks || []), { date: today(), at: Date.now(), score, parts, miss }];
  persist();
  const next = new Date(); next.setDate(next.getDate() + CHECK_EVERY);
  const diff = prev ? score - prev.score : null;
  view.innerHTML = `
    <div class="play result">
      <p class="eyebrow center">이달의 듣기 점검</p>
      <h1 class="q">${prev ? (diff > 0 ? `지난번보다 ${diff}점 올랐어요` : diff === 0 ? '지난번과 같은 점수예요' : '이번에는 조금 낮게 나왔어요') : '첫 점검을 마쳤어요'}</h1>
      <div class="score"><b id="score">0</b><span>점</span></div>
      <div class="result-chips">
        <span class="chip">20문제 중 <b>${correct}</b>개 정답</span>
        ${prev ? `<span class="chip">지난번 ${prev.score}점</span>` : ''}
        ${first && first !== prev ? `<span class="chip">처음 ${first.score}점</span>` : ''}
      </div>
      <section class="panel">
        <h2 class="panel-title">부분별 결과</h2>
        <ul class="acc-list">${Object.entries(parts).map(([kind, [c, n]]) => `<li><span class="acc-name">${CHECK_KIND[kind]}</span>
          <span class="acc-bar"><i style="width:${Math.round((100 * c) / n)}%"></i></span><span class="acc-val">${c}/${n}</span></li>`).join('')}</ul>
        ${prev ? `<p class="note">지난번 부분별: ${Object.entries(prev.parts || {}).map(([kind, [c, n]]) => `${CHECK_KIND[kind]} ${c}/${n}`).join(', ')}</p>` : ''}
      </section>
      ${miss.length ? `<section class="panel">
        <h2 class="panel-title">놓친 문제 다시 듣기 <span>조용할 때 소리</span></h2>
        <div class="miss-list">${miss.map((i) => `<button class="pill" data-say="${i}">${ICON.speaker}${esc(CHECK_ITEMS[i].answer)}</button>`).join('')}</div>
      </section>` : ''}
      <p class="lead center">${diff != null && diff < 0 ? '컨디션이나 주변 소리에 따라 점수가 오르내릴 수 있어요. ' : ''}다음 점검은 <b>${shortDate(next.toLocaleDateString('sv-SE'))}</b>쯤 권해 드릴게요.</p>
      <div class="actions">
        <button class="btn primary" data-go="#progress">기록 보기</button>
        <button class="btn" data-go="#home">지도로</button>
      </div>
    </div>`;
  countUp(view.querySelector('#score'), score);
  view.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => playWord(CHECK_ITEMS[+b.dataset.say].answer); });
}

/* ---------- 시연용 예시 기록 ---------- */

const BACKUP_KEY = 'sorigil.v1.backup';
// 하루 판 3개씩 꾸준히 연습해 목표한 장(기본 5장 카페)까지 온 사람처럼 기록을 만든다.
// 칸 통과와 관문은 앱과 같은 규칙 함수로 따지고, 다 만든 뒤 마지막 날이 오늘(idle이면 그만큼 전)이 되게 날짜를 옮긴다.
// opts로 사람마다 다르게 만들어 선생님 화면의 예시 환자로도 쓴다.
function demoData(opts = {}) {
  const { seed0 = 7, name = '김소리', boost = 0, to = 5, stay = 6, idle = 0, plan = null, who = 'ci' } = opts;
  let seed = seed0;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // 듣는 귀와 말 빠르기는 이 기기를 쓰는 사람 것을 그대로 둔다
  const d = Object.assign(fresh(), { preferFamily: data.preferFamily, bigText: data.bigText, ear: data.ear, talkSpeed: data.talkSpeed, demo: true, reportName: name, plan, who });
  const day0 = '2000-01-03';
  const START = { 1: 0.78, 2: 0.72, 3: 0.56, 4: 0.6, 5: 0.52, 6: 0.45 }; // 칸에 처음 들어섰을 때 정답률
  const GSTART = { 1: 0.86, 2: 0.78, 3: 0.72, 4: 0.68, 5: 0.66, 6: 0.6 };
  const played = {}; const tried = {};
  const at = (a) => a[Math.floor(rnd() * a.length)];
  const two = (a) => { const i = Math.floor(rnd() * a.length); const k = (i + 1 + Math.floor(rnd() * (a.length - 1))) % a.length; return [a[i], a[k]]; };
  const heard = (t) => !Object.keys(voicePack).length || !!voicePack[t]; // 음성 파일이 있는 문제만(기기 음성이 없는 곳에서도 다시 들을 수 있게)
  // 틀린 문제 한 개를 그 칸의 문항에서 만든다
  const fakeMiss = (c) => {
    if (c.kind === 'env') {
      const ids = (c.pool || Object.keys(ENV_SOUNDS)).map((x) => [rnd(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]).slice(0, c.n);
      const [a, b] = two(ids);
      return { kind: 'env', answer: a, chose: b, options: ids, label: ENV_SOUNDS[a].name, choseLabel: ENV_SOUNDS[b].name };
    }
    if (c.kind === 'word' || (c.kind === 'sent' && c.level < 3) || c.kind === 'noise') {
      const sc = c.kind === 'noise' && NOISE_SCENES[c.scene];
      const set = at(c.kind === 'word' ? c.sets() : sc ? [...sc.easy, ...sc.hard] : SENTENCE_SETS[c.level]);
      const [a, b] = two(set);
      if (!heard(a)) return null;
      return { kind: c.kind, answer: a, chose: b, options: set, say: a, ...(sc ? { scene: c.scene, snr: c.snr } : {}), label: a, choseLabel: b };
    }
    if (c.kind === 'sent') {
      const it = at(SENTENCE_SETS[3]); const [a, b] = two(it.words); const say = fillFrame(it.frame, a);
      return heard(say) ? { kind: 'frame', answer: a, chose: b, options: it.words, say, frame: it.frame, label: say, choseLabel: b } : null;
    }
    return null;
  };
  const listen = (id, date, j, forId) => {
    const c = CELL[id]; const k = played[id] = (played[id] || 0) + 1;
    const p = c.kind === 'tone' ? 0.92 : Math.min(0.97, START[c.ch] + boost + 0.06 * (k - 1) + (rnd() - 0.5) * 0.2);
    const correct = Math.max(2, Math.min(10, Math.round(p * 10)));
    d.sessions.push({ date, cell: id, ...(forId ? { for: forId } : {}), correct, total: TRIALS, j, sec: 140 + Math.floor(rnd() * 110) });
    for (let m = 0; m < Math.min(2, TRIALS - correct); m++) { const x = fakeMiss(c); if (x) d.misses.push({ date, j, cell: id, ...x }); }
  };
  const speak = (id, date, j) => {
    const k = played[id] = (played[id] || 0) + 1;
    const score = Math.round(Math.min(95, 58 + boost * 100 + k * 3 + rnd() * 8));
    const good = Math.max(1, Math.min(5, Math.round(score / 20 + (rnd() - 0.5))));
    d.speakLog.push({ date, j, mode: CELL[id].mode, n: SPEAK_N, score, good, asr: true, cell: id });
  };
  const gate = (n, date, j) => {
    const k = tried[n] = (tried[n] || 0) + 1;
    const p = Math.min(0.97, GSTART[n] + boost + 0.05 * (k - 1) + (rnd() - 0.5) * 0.12);
    const correct = Math.max(6, Math.min(15, Math.round(p * 15)));
    d.gates.push({ ch: n, date, j, correct, total: 15, pass: correct >= gateNeed(15, GATE_PASS), sec: 420 + Math.floor(rnd() * 200) });
  };
  let k = 0; let inTo = 0; let lastDay = day0;
  for (; k < 160 && inTo < stay; k++) {
    if (rnd() < 0.14) continue; // 쉰 날
    const date = addDays(day0, k); lastDay = date;
    let j = 0; let gatesToday = 0;
    const step = nextStep(d);
    if (step.cell) {
      const c = CELL[step.cell];
      if (c.kind === 'speak') speak(c.id, date, j++);
      else { const id = playCellFor(c.id, d); listen(id, date, j++, id !== c.id ? c.id : null); }
    } else if (step.gate) { gate(step.gate, date, j++); gatesToday++; }
    // 말하기 한 판(3장부터는 헷갈리는 낱말 말하기)
    const sp = step.ch >= 3 ? '3-5' : '2-5';
    if (step.ch >= 2) speak(sp, date, j++);
    else listen(step.cell || '1-3', date, j++);
    // 세 번째 판: 관문을 열었으면 한 번 더, 아니면 지금 칸
    const s2 = nextStep(d);
    if (s2.gate && gatesToday < GATE_TRIES) gate(s2.gate, date, j++);
    else if (s2.cell && CELL[s2.cell].kind !== 'speak') { const id = playCellFor(s2.cell, d); listen(id, date, j++, id !== s2.cell ? s2.cell : null); }
    else { const r = reviewCell(d); if (r) listen(r, date, j++); }
    if (currentChapter(d) >= to) inTo++;
  }
  // 날짜를 오늘 쪽으로 옮기고 시각을 붙인다
  const shift = Math.round((new Date(`${today()}T12:00:00`) - new Date(`${lastDay}T12:00:00`)) / 86400000) - idle;
  const hours = {};
  for (const x of [...d.sessions, ...d.speakLog, ...d.gates, ...d.misses]) {
    x.date = addDays(x.date, shift);
    const h = hours[x.date] ?? (hours[x.date] = 9 + Math.floor(rnd() * 10));
    x.at = new Date(`${x.date}T${String(h).padStart(2, '0')}:${String(Math.floor(rnd() * 20)).padStart(2, '0')}:00`).getTime() + x.j * 420000;
    delete x.j;
  }
  for (const l of [d.sessions, d.speakLog, d.gates, d.misses]) l.sort((a, b) => a.at - b.at);
  d.misses = d.misses.slice(-300);
  // 나이 들며 생기는 난청처럼 높은 소리일수록 덜 들리는 모양
  d.toneByFreq = { 500: -50, 1000: -45, 2000: -35, 4000: -20 }; d.minDb = -50;
  d.confusions = { '초성 ㅅ↔ㅆ': 9, '초성 ㄱ↔ㅋ': 6, '초성 ㄷ↔ㄸ': 5, '종성 ㄴ↔ㅁ': 4, '중성 ㅓ↔ㅗ': 3 };
  d.focusLog = { '초성 ㅅ↔ㅆ': { n: 8, ok: 4 }, '초성 ㄱ↔ㅋ': { n: 6, ok: 5 }, '초성 ㄷ↔ㄸ': { n: 4, ok: 2 }, '종성 ㄴ↔ㅁ': { n: 3, ok: 3 } };
  d.speakConf = { '초성 ㅅ↔ㅆ': 4, '종성 ㄹ↔없음': 2 };
  // 한 달 간격 점검. 점수가 조금씩 오른다.
  const first = d.sessions[0]?.date || today();
  const span = daysSince(first);
  d.checks = [span, Math.round(span / 2), 1].filter((ago, i, a) => a.indexOf(ago) === i && ago >= 1).map((ago, i) => {
    const w = Math.max(2, Math.min(8, Math.round(4 + i + boost * 10 + rnd())));
    const s2 = Math.max(1, Math.min(6, Math.round(3 + i + boost * 8)));
    const n = Math.max(0, Math.min(6, Math.round(2 + i * 1.2 + boost * 8 + rnd())));
    const date = addDays(today(), -ago);
    return { date, at: new Date(`${date}T20:00:00`).getTime(), score: Math.round((100 * (w + s2 + n)) / 20), parts: { word: [w, 8], sent: [s2, 6], noise: [n, 6] }, miss: [] };
  });
  // 4장 문장까지 온 사람만 1분 소음 기록을 쟀다. 2주쯤 간격으로 2dB씩 낮아진다.
  if (to >= 4) {
    const s0 = 18 - 2 * to - (boost > 0 ? 2 : 0);
    d.noiseRecs = [Math.round(span * 0.6), Math.round(span * 0.3), 2].filter((ago, i, a) => a.indexOf(ago) === i && ago >= 1).map((ago, i, a) => {
      const date = addDays(today(), -ago);
      return { date, at: new Date(`${date}T20:30:00`).getTime(), snr: s0 + 2 * (a.length - 1 - i), n: 11 + Math.floor(rnd() * 4), correct: 8 + Math.floor(rnd() * 3) };
    });
  }
  // 링 6소리를 거의 매일 했다(인공와우). 3주쯤 전 '스'·'쉬'를 놓치기 시작해 매핑을 받았고, 그 뒤 다시 올라갔다.
  if (WHO[who]?.ling) {
    const mapAgo = Math.min(18, Math.max(8, span - 4));
    for (let ago = Math.min(30, span); ago >= 1; ago--) {
      if (rnd() < 0.2) continue;
      const date = addDays(today(), -ago);
      const low = ago > mapAgo && ago <= mapAgo + 4; // 매핑 전 며칠은 높은 소리를 놓쳤다
      const miss = low ? ['s', 'sh'].slice(0, rnd() < 0.6 ? 2 : 1) : rnd() < 0.3 ? ['s'] : [];
      const wrong = { s: rnd() < 0.5 ? 'none' : 'sh', sh: 's' }; // '스'는 안 들리거나 '쉬'로, '쉬'는 '스'로 들렸다
      const res = Object.fromEntries(LING.map((s) => [s.id, miss.includes(s.id) ? wrong[s.id] : s.id]));
      d.lings.push({ date, at: new Date(`${date}T08:30:00`).getTime(), ear: d.ear, src: 'synth', ok: 6 - miss.length, heard: LING.filter((s) => res[s.id] !== 'none').length, miss, res });
    }
    const md = addDays(today(), -mapAgo);
    d.maps = [{ date: md, at: new Date(`${md}T15:00:00`).getTime(), kind: 'map', ear: 'both', memo: '높은 소리 쪽을 조금 키움' }];
    // 처음 몇 주는 소리 구별부터 했다
    const first0 = d.sessions[0]?.date || today();
    d.supraRuns = ['len', 'tune', 'len', 'voice', 'tune'].map((mode, i) => {
      const date = addDays(first0, i);
      return { mode, date, at: new Date(`${date}T19:30:00`).getTime(), correct: 6 + Math.min(4, i + Math.floor(rnd() * 2)), total: 10, sec: 140 };
    });
  }
  // 6일 전에 그때 틀린 문제를 한 번 다시 풀었다
  const pool = span >= 20 ? retestPool(d).filter((m) => daysSince(m.date) >= RETEST_AGO + 6).slice(0, RETEST_N) : [];
  if (pool.length === RETEST_N) {
    const date = addDays(today(), -6);
    pool.forEach((m, i) => { const ok = i % 3 !== 1; m.re = { date, ok, chose: ok ? m.answer : m.chose }; });
    d.retests = [{ date, at: new Date(`${date}T19:00:00`).getTime(), n: RETEST_N, correct: pool.filter((m) => m.re.ok).length, sec: 150 }];
  }
  return d;
}
// 선생님 화면에서 보여 줄 예시 환자들
function demoPatients() {
  const mk = (cells, kind, amount, days) => ({ by: '김민정', cells, kind, amount, days, memo: '', at: Date.now() });
  return [
    demoData({ seed0: 7, name: '김소리', plan: mk(['5-2', 'g5'], 'm', 10, 5) }),
    demoData({ seed0: 23, name: '이바다', boost: -0.08, to: 2, stay: 3, idle: 2, plan: mk(['2-1', '2-2'], 'r', 3, 3), who: 'ear2' }),
    demoData({ seed0: 101, name: '박하늘', boost: 0.06, to: 6, stay: 4, plan: mk(['6-1', 'g6'], 'm', 15, 6), who: 'ha' }),
    demoData({ seed0: 55, name: '최도윤', boost: -0.03, to: 3, stay: 5, idle: 1 }),
  ];
}

function loadDemo() {
  if (!data.demo) try { localStorage.setItem(BACKUP_KEY, JSON.stringify(data)); } catch {} // 내 기록과 설정은 따로 보관한다
  data = demoData(); persist();
}
function clearDemo() {
  let back = null;
  try { back = JSON.parse(localStorage.getItem(BACKUP_KEY)); localStorage.removeItem(BACKUP_KEY); } catch {}
  data = migrate(Object.assign(fresh(), back || { preferFamily: data.preferFamily, bigText: data.bigText, ear: data.ear, talkSpeed: data.talkSpeed }));
  persist();
}

/* ---------- 1분 소음 기록 ---------- */

// 카페 소음을 1분 동안 계속 틀어 두고 문장을 하나씩 들려준다. 처음에는 맞힐 때마다,
// 한 번 틀린 뒤로는 3번 연달아 맞혀야 소음을 2dB 키우고, 틀리면 2dB 줄인다(정답률 약 79%에 머무는 방식).
// 1분이 끝났을 때의 소음 크기가 기록이다.
async function renderNoiseRec() {
  setNav('play');
  const token = ++playToken;
  const alive = () => token === playToken;
  const rs = data.noiseRecs; const last = rs[rs.length - 1];
  const pool = Object.values(NOISE_SCENES).flatMap((sc) => [...sc.easy, ...sc.hard]);
  const extra = canSpeak() ? '' : '<p class="note warn center">이 화면에서는 AI 음성이 나오지 않아요. 크롬이나 삼성 인터넷 같은 브라우저에서 열어 주세요.</p>';
  view.innerHTML = playShell('#progress', '1분 소음 기록', '카페 소음 속에서 1분',
    `알아들으면 소음이 점점 커지고, 놓치면 작아져요. 1분이 끝났을 때의 소음 크기가 기록이에요.${last ? ` 지난 기록은 <b>${snrText(last.snr)}</b>(${shortDate(last.date)})예요.` : ''}`, startBox(false, extra));
  $('#pnum').textContent = `${NREC_SEC}초`;
  await waitStart(false, alive);
  if (!alive()) return;

  const c = audio(); const buf = sceneBuffer(c, 'cafe');
  const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
  const g = c.createGain(); g.gain.value = 0;
  src.connect(g); g.connect(earOut(c));
  if (stopNoise) stopNoise();
  stopNoise = () => { try { src.stop(); } catch {} stopNoise = null; };
  src.start(c.currentTime, Math.random() * buf.duration);
  const setLevel = (snr) => { const t = c.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(noiseGain(snr), t + 0.4); };

  let level = NREC_START; let run = 0; let missed = false; let n = 0; let correct = 0;
  const endAt = performance.now() + NREC_SEC * 1000;
  const tick = () => {
    const left = Math.max(0, Math.ceil((endAt - performance.now()) / 1000));
    $('#pnum').textContent = left ? `남은 시간 ${left}초` : '시간 끝 · 이 문제까지';
    $('#pbar').style.width = `${100 - (100 * left) / NREC_SEC}%`;
  };
  const timer = setInterval(() => { if (alive()) tick(); else clearInterval(timer); }, 250);
  tick();
  const orb = $('#orb');
  try {
    while (alive() && performance.now() < endAt) {
      const opts = shuffle(pick(pool)); const target = pickHeard(opts);
      $('#answers').innerHTML = '';
      $('#q').textContent = '들린 말은?';
      $('#hint').innerHTML = `<span class="chip scene">☕ 카페 소음 · ${snrText(level)}</span>`;
      setLevel(level);
      await wait(700);
      if (!alive()) return;
      orb.className = 'orb playing';
      await playWord(target, undefined, 1, true); // 늘 같은 빠르기
      if (!alive()) return;
      orb.className = 'orb idle';
      const ans = await ask(opts.map((w) => [w]), opts.indexOf(target), 'sentences');
      const ok = opts[ans] === target;
      n++; if (ok) correct++;
      if (ok) { run++; if (!missed || run >= 3) { level -= NREC_STEP; run = 0; } } else { missed = true; run = 0; level += NREC_STEP; }
      level = Math.max(-10, Math.min(20, level));
      await wait(700);
    }
  } finally {
    clearInterval(timer);
    const t = c.currentTime;
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.5);
    try { src.stop(t + 0.6); } catch {}
  }
  if (!alive()) return;

  const first = rs[0];
  data.noiseRecs.push({ date: today(), at: Date.now(), snr: level, n, correct });
  persist();
  const ch = first && snrChange(first.snr, level);
  const acts = roundActions('#progress', true, '다시 재기');
  view.innerHTML = `
    <div class="play result">
      <p class="eyebrow center">1분 소음 기록 · 카페 소음</p>
      <h1 class="q">내 소음 기록 ${snrText(level)}</h1>
      <p class="lead center">${snrSay(level)} 알아들었어요. ${ida(snrScene(level))}.</p>
      <section class="panel check-panel">
        ${first ? `<div class="check-compare">
          <div><span>처음</span><b>${snrText(first.snr)}</b><em>${shortDate(first.date)}</em></div>
          <i aria-hidden="true">→</i>
          <div><span>오늘</span><b>${snrText(level)}</b><em>${shortDate(today())}</em></div>
          <strong class="${ch.cls}">${ch.text}</strong>
        </div>` : '<p class="note">첫 기록이에요. 이 숫자가 앞으로 견줄 기준이 돼요.</p>'}
        <p class="note">1분 동안 ${n}문제 중 ${correct}개 맞혔어요. 숫자가 낮을수록 더 시끄러운 곳에서 알아들은 거예요.</p>
      </section>
      <div class="actions">${acts.html}</div>
    </div>`;
  acts.bind();
}

/* ---------- 그때 틀린 문제 다시 듣기 ---------- */

// 2주 넘게 지난 판에서 틀린 문제를 그때와 같은 보기, 같은 소음으로 다시 내고, 그때 고른 답과 오늘 고른 답을 나란히 보여 준다.
const missLabel = (m, x) => (m.kind === 'env' ? ENV_SOUNDS[x].name : x);
const missSay = (m, x) => (m.kind === 'frame' ? fillFrame(m.frame, x) : m.kind === 'sent' || m.kind === 'noise' || m.kind === 'word' ? x : null);
function missPlay(m, x = m.answer, noisy = true) {
  if (m.kind === 'env') return () => playEnv(x);
  const say = () => playWord(missSay(m, x));
  return m.kind === 'noise' && noisy ? () => withNoise(m.scene, m.snr, say) : say;
}
async function renderRetest() {
  setNav('play');
  const token = ++playToken;
  const alive = () => token === playToken;
  const items = retestPool().slice(0, RETEST_N);
  if (!items.length) {
    view.innerHTML = `
      <header class="page-head"><p class="eyebrow">그때 틀린 문제 다시 듣기</p><h1>다시 들을 문제가 아직 없어요</h1></header>
      <section class="panel"><p class="lead">판에서 틀린 문제는 2주가 지나면 여기서 다시 나와요. 그때 고른 답과 오늘 고른 답을 나란히 보여 드려요.</p>
      <button class="btn primary block" data-go="#home">지도로</button></section>`;
    return;
  }
  const extra = canSpeak() ? '' : '<p class="note warn center">이 화면에서는 AI 음성이 나오지 않아요. 크롬이나 삼성 인터넷 같은 브라우저에서 열어 주세요.</p>';
  view.innerHTML = playShell('#home', '그때 틀린 문제 다시 듣기', `${items.length}문제를 다시 들어요`,
    `${shortDate(items[0].date)}부터 2주 넘게 지난 판에서 틀린 문제예요. 그때와 같은 보기로 내고, 끝나면 그때 고른 답과 오늘 고른 답을 나란히 보여 드려요.`, startBox(false, extra));
  $('#pnum').textContent = `${items.length}문제`;
  await waitStart(false, alive);
  if (!alive()) return;
  const startedAt = Date.now();
  const orb = $('#orb');
  let busy = false;
  const playing = async (p) => { busy = true; orb.className = 'orb playing'; try { return await p; } finally { busy = false; if (alive()) orb.className = 'orb idle'; } };
  const out = [];
  for (let i = 0; i < items.length && alive(); i++) {
    const m = items[i];
    $('#pnum').textContent = `${i + 1}번째 / ${items.length}문제`;
    $('#pbar').style.width = `${(100 * i) / items.length}%`;
    $('#answers').innerHTML = '';
    $('#q').textContent = m.kind === 'env' ? '무슨 소리일까요?' : m.kind === 'frame' ? '문장에서 어떤 낱말이 들렸나요?' : '어떤 말을 들었나요?';
    $('#hint').innerHTML = (m.kind === 'noise' ? `<span class="chip scene">${SCENE_NAME[m.scene]} 소음 · ${snrText(m.snr)}</span>` : '') + replayBtn();
    const listen = missPlay(m);
    $('#replay').onclick = () => { if (!busy) playing(listen()); };
    await playing(listen());
    if (!alive()) return;
    const opts = shuffle(m.options);
    const layout = m.kind === 'env' ? (opts.length === 2 ? 'two' : '') : opts.some((w) => w.length > 5) ? 'sentences' : 'words';
    const ans = await ask(opts.map((x) => (m.kind === 'env' ? [ENV_SOUNDS[x].name, ENV_SOUNDS[x].icon] : [x])), opts.indexOf(m.answer), layout);
    out.push({ m, ok: opts[ans] === m.answer, chose: opts[ans] });
    await wait(900);
  }
  if (!alive()) return;

  const correct = out.filter((x) => x.ok).length;
  for (const { m, ok, chose } of out) {
    for (const x of data.misses) if (!x.re && missKey(x) === missKey(m)) x.re = { date: today(), ok, chose };
  }
  // 오늘도 놓친 문제는 2주 뒤에 다시 나오게 새로 남긴다
  const again = out.filter((x) => !x.ok).map(({ m, chose }) => {
    const { re, date, at, ...rest } = m;
    return { ...rest, date: today(), at: Date.now(), chose, choseLabel: missLabel(m, chose) };
  });
  data.misses = [...data.misses, ...again].slice(-300);
  data.retests.push({ date: today(), at: Date.now(), n: out.length, correct, sec: Math.round((Date.now() - startedAt) / 1000) });
  persist();

  const acts = roundActions('#home', false);
  view.innerHTML = `
    <div class="play result">
      <p class="eyebrow center">그때 틀린 문제 다시 듣기</p>
      <h1 class="q">그때 틀린 ${out.length}문제 중 오늘 ${correct}개 맞혔어요</h1>
      <p class="lead center">${correct < out.length ? '못 맞힌 문제는 2주 뒤에 다시 나와요.' : '이번에 다시 푼 문제는 모두 맞혔어요.'}</p>
      <section class="panel miss-panel">
        <h2 class="panel-title">그때와 오늘</h2>
        <ul class="miss-rows">${out.map(({ m, ok, chose }, i) => `
          <li><span class="miss-a">${esc(m.kind === 'frame' ? m.say : missLabel(m, m.answer))}</span>
            <span class="then-now">
              <span>${shortDate(m.date)}: <b>${esc(missLabel(m, m.chose))}</b> 고름</span>
              <span class="${ok ? 'ok' : ''}">오늘: ${ok ? `${ICON.check}맞힘` : `<b>${esc(missLabel(m, chose))}</b> 고름`}</span>
            </span>
            <span class="miss-btns">
              <button class="pill" data-m="${i}" data-k="0">${ICON.speaker}정답</button>
              ${m.kind === 'noise' ? `<button class="pill alt" data-m="${i}" data-k="1">${ICON.speaker}소음 속에서</button>` : ''}
            </span></li>`).join('')}
        </ul>
      </section>
      <div class="actions">${acts.html}</div>
    </div>`;
  acts.bind();
  let rbusy = false;
  view.querySelectorAll('[data-m]').forEach((b) => {
    b.onclick = async () => {
      if (rbusy) return; rbusy = true; b.classList.add('busy');
      const m = out[+b.dataset.m].m;
      try { await missPlay(m, m.answer, b.dataset.k === '1')(); } finally { rbusy = false; b.classList.remove('busy'); }
    };
  });
}

/* ---------- 칸 한 판 ---------- */

let playToken = 0; // 다른 화면으로 가면 진행 중인 판을 멈춘다
const SRC_LABEL = { family: '가족 목소리', pack: 'AI 음성', tts: 'AI 음성', 'tts-nokorean': '이 기기에는 한국어 음성이 없어 발음이 어색할 수 있어요', none: '이 화면에서는 AI 음성이 나오지 않아요' };

// 판 화면의 공통 틀: 그만 버튼, 진행 막대, 가운데 소리 공, 보기 자리, 아래에서 올라오는 확인 시트
function playShell(back, eyebrow, q, hint, start) {
  return `
    <div class="play">
      <div class="play-top">
        <button class="quit" data-go="${back}" aria-label="그만하고 나가기">${ICON.close}<span>그만</span></button>
        <div class="prog"><span id="pnum"></span><span class="prog-bar" aria-hidden="true"><i id="pbar"></i></span></div>
      </div>
      <p class="eyebrow center">${eyebrow}</p>
      <div class="stagebox">
        <div class="orb idle" id="orb">${ICON.speaker}</div>
        <h1 class="q" id="q">${q}</h1>
        <p class="lead center" id="hint">${hint}</p>
      </div>
      <div id="answers" class="start-box">${start}</div>
    </div>
    <div class="sheet" id="sheet" hidden>
      <div class="sheet-msg"><span class="sheet-icon"></span><div><b id="sheet-title"></b><p id="sheet-text"></p></div></div>
      <div class="compare" id="compare" hidden></div>
      <button class="btn block" id="next">다음</button>
    </div>`;
}
// 시작 전 상자: 소리 확인과 시작 버튼. 오늘의 연습 중이면 3초 뒤 저절로 시작한다(앞 화면의 터치로 소리가 이미 풀려 있다).
function startBox(inRun, extra = '') {
  return `
        ${inRun ? '<p class="run-tag center">오늘의 연습 · <b id="count">3</b>초 뒤 시작해요</p>' : ''}
        <button class="btn block" id="soundcheck">${ICON.speaker}소리 확인하기</button>
        <button class="btn primary block" id="start">${inRun ? '바로 시작' : '시작하기'}</button>
        <p class="note center">초인종 소리와 "안녕하세요"가 들리면 준비 끝이에요. 안 들리면 휴대폰 음량과 무음 모드를 확인해 주세요.</p>
        ${earSide() ? `<p class="note center ear-note">${ICON.ear}${EAR_NAME[data.ear]}로만 소리를 보내요. 이어폰이나 기기 블루투스로 들어 주세요.</p>` : ''}${extra}`;
}
function waitStart(inRun, alive) {
  const $ = (s) => view.querySelector(s);
  let countdown = null;
  const stopCount = () => { clearInterval(countdown); countdown = null; const t = $('.run-tag'); if (t) t.textContent = '오늘의 연습 · 준비되면 시작을 눌러 주세요'; $('#start').textContent = '시작하기'; };
  $('#soundcheck').onclick = () => { if (countdown) stopCount(); unlockAudio(); playEnv('doorbell'); setTimeout(() => playWord('안녕하세요'), 1400); };
  return new Promise((r) => {
    $('#start').onclick = () => { clearInterval(countdown); unlockAudio(); r(); };
    if (!inRun) return;
    let left = 3;
    countdown = setInterval(() => {
      if (!alive()) { clearInterval(countdown); return; }
      left -= 1;
      if (left > 0) { $('#count').textContent = left; return; }
      clearInterval(countdown); r();
    }, 1000);
  });
}

async function renderPlay(routeId) {
  setNav('play');
  const token = ++playToken;
  const alive = () => token === playToken;
  const id = playCellFor(routeId);
  const c = CELL[id];
  const below = id !== routeId; // 2판 연속 어려웠던 칸 대신 한 칸 아래 문제로 하는 판
  const inRun = !!todayRun && todayRun.queue[todayRun.i] === current;
  const back = inRun ? '#home' : c.weak ? '#home' : `#ch/${CELL[routeId].ch}`;
  const sc = c.kind === 'noise' ? NOISE_SCENES[c.scene] : null;
  const results = []; const misses = [];
  let toneDb = -10; // 소리 알아차리기: 들리면 5dB씩 작게, 놓치면 5dB 크게
  let quietest = null;
  const freqBest = {}; // 이번 판 높낮이별로 들린 가장 작은 소리
  const sessionConf = {};
  const intro = {
    tone: ['소리가 들리면 알려 주세요', '삐 소리가 날 수도, 안 날 수도 있어요. 조용한 곳에서 해 주세요.'],
    env: ['무슨 소리인지 맞혀 보세요', '생활 속 소리를 들려드려요. 몇 번이든 다시 들을 수 있어요.'],
    word: ['들은 말을 골라 주세요', c.weak ? '자주 헷갈린 소리가 든 낱말을 모아 냈어요.' : `${ida(c.desc)}.`],
    sent: c.level === 3 ? ['문장 속 낱말을 골라 주세요', '문장을 듣고, 그 속에 들린 낱말을 골라요.'] : ['들은 문장을 골라 주세요', '생활 속 문장을 들려드려요.'],
    noise: sc && [`${sc.name}에서 들어 보세요`, `${sc.name} 소음 속에서 말을 알아들어요. 말소리가 소음보다 ${c.snr}dB 커요.`],
    supra: ['말끝을 들어 보세요', '"아?"처럼 끝이 올라가는 소리와 "아."처럼 내려가는 소리를 가려 들어요. 묻는 말은 끝이 올라가요.'],
  }[c.kind];
  const extra = (c.kind === 'word' || c.kind === 'sent' || c.kind === 'noise') && !canSpeak()
    ? '<p class="note warn center" id="nospeech">이 화면에서는 AI 음성이 나오지 않아요. 크롬이나 삼성 인터넷 같은 브라우저에서 열어 주세요. 가족 목소리로 녹음한 말은 여기서도 들려요.</p>' : '';
  view.innerHTML = playShell(back, c.weak ? WEAK_CELL.name : `${c.id} · ${c.name}`, intro[0],
    below ? `${routeId} 칸이 두 판 연달아 어려웠어요. 이번 한 판은 한 칸 아래 문제로 다지고, 다음 판은 다시 ${routeId} 칸이에요.` : intro[1], startBox(inRun, extra));
  if (c.kind === 'tone') $('#orb').innerHTML = ICON.ear;
  view.querySelector('#pnum').textContent = `${TRIALS}문제`;
  await waitStart(inRun, alive);
  if (!alive()) return;
  const startedAt = Date.now();

  const orb = $('#orb');
  const setOrb = (mode) => { orb.className = `orb ${mode}`; };
  let busy = false; // 소리가 나는 동안에는 다시 듣기를 막아 소리가 겹치지 않게 한다
  const playing = async (p) => { busy = true; setOrb('playing'); try { return await p; } finally { busy = false; if (alive()) setOrb('idle'); } };
  const replay = (fn) => () => { if (!busy) playing(fn()); };
  const setQ = (q, hint = '') => { $('#q').textContent = q; $('#hint').innerHTML = hint; };

  for (let i = 0; i < TRIALS && alive(); i++) {
    $('#pnum').textContent = `${i + 1}번째 / ${TRIALS}문제`;
    $('#pbar').style.width = `${(100 * i) / TRIALS}%`;
    const trial = { tone: toneTrial, env: envTrial, word: wordTrial, sent: sentenceTrial, noise: noiseTrial, supra: supraTrial }[c.kind];
    const ok = await trial();
    if (!alive()) return;
    results.push(ok);
    await nextTap(i === TRIALS - 1);
  }
  if (!alive()) return;

  const correct = results.filter(Boolean).length;
  const wasDone = cellState(c) === 'done';
  const stepBefore = nextStep();
  if (c.kind === 'tone' && quietest != null) data.minDb = data.minDb == null ? quietest : Math.min(data.minDb, quietest);
  for (const [f, db] of Object.entries(freqBest)) data.toneByFreq[f] = Math.min(data.toneByFreq[f] ?? 0, db);
  for (const [k, v] of Object.entries(sessionConf)) data.confusions[k] = (data.confusions[k] || 0) + v;
  data.sessions.push({ date: today(), cell: id, ...(below ? { for: routeId } : {}), correct, total: TRIALS, at: Date.now(), sec: Math.round((Date.now() - startedAt) / 1000) });
  data.misses = [...data.misses, ...misses.filter((m) => !m.local).map(({ replayFns, ...m }) => ({ date: today(), at: Date.now(), cell: id, ...m }))].slice(-300); // local: 이 판에서만 다시 듣는 문제
  persist();

  let status = '';
  if (c.weak) status = '약한 소리 연습은 칸 통과에 세지 않아요.';
  else if (below) status = `다음 판은 다시 ${routeId} ${ida(CELL[routeId].name)}.`;
  else if (!wasDone && cellState(c) === 'done') {
    const s = nextStep();
    status = `${c.id} 칸을 통과했어요. ${s.cell ? `다음은 ${s.cell} ${ida(CELL[s.cell].name)}.` : s.gate ? `${s.ch}장 칸을 다 넘었어요. 이제 관문 '${GATES[s.gate].title}'에 도전할 수 있어요.` : ''}`;
  } else if (wasDone) status = stepBefore.cell === id ? '' : '이미 넘은 칸이에요. 복습으로 쳐요.';
  else if (playCellFor(id) !== id) status = '두 판 연달아 어려웠어요. 다음 판은 한 칸 아래 문제로 다져요.';
  else status = passHint(c) + '.';
  const acts = roundActions(back);

  view.innerHTML = `
    <div class="play result">
      <p class="eyebrow center">${c.weak ? WEAK_CELL.name : `${c.id} · ${c.name}`}</p>
      <h1 class="q">${TRIALS}문제 중 ${correct}개 맞혔어요</h1>
      ${status ? `<p class="lead center">${status}</p>` : ''}
      ${acts.ended ? `<p class="lead center">오늘의 연습 ${TODAY_N}판을 마쳤어요.</p>` : ''}
      ${misses.length ? `
      <section class="panel miss-panel">
        <h2 class="panel-title">틀린 문제 다시 듣기</h2>
        <ul class="miss-rows">${misses.map((m, i) => `
          <li><span class="miss-a">${esc(m.label)}</span>
            <span class="miss-btns">
              <button class="pill" data-m="${i}" data-k="0">${ICON.speaker}정답</button>
              <button class="pill alt" data-m="${i}" data-k="1">${ICON.speaker}고른 것: ${esc(m.choseLabel)}</button>
              ${m.replayFns[2] ? `<button class="pill alt" data-m="${i}" data-k="2">${ICON.speaker}소음 속에서</button>` : ''}
            </span></li>`).join('')}
        </ul>
      </section>` : ''}
      <div class="actions">${acts.html}</div>
    </div>`;
  acts.bind();
  let rbusy = false;
  view.querySelectorAll('[data-m]').forEach((b) => {
    b.onclick = async () => {
      if (rbusy) return; rbusy = true; b.classList.add('busy');
      try { await misses[+b.dataset.m].replayFns[+b.dataset.k](); } finally { rbusy = false; b.classList.remove('busy'); }
    };
  });

  // 소리 알아차리기: 순음. 들리면 5dB 작게, 놓치면 5dB 크게.
  async function toneTrial() {
    const present = Math.random() > 0.25; // 4번 중 1번은 소리 없음(찍기 방지)
    const freq = pick(TONES);
    $('#answers').innerHTML = '';
    setQ('준비하세요', '&nbsp;');
    setOrb('idle');
    await wait(700);
    if (!alive()) return false;
    // 3초 '듣는 시간'을 막대로 보여 준다. 소리는 이 안의 아무 때나 나거나 나지 않는다.
    const WINDOW = 3000; const t0 = performance.now();
    setQ('지금 잘 들어 보세요', `<span class="listen-window" style="--dur:${WINDOW}ms" aria-hidden="true"><i></i></span><span class="src">소리가 안 날 수도 있어요</span>`);
    setOrb('listening');
    await wait(400 + Math.random() * 1500);
    if (!alive()) return false;
    if (present) { await playTone(freq, toneDb); if (!alive()) return false; }
    await wait(Math.max(0, WINDOW - (performance.now() - t0)));
    if (!alive()) return false;
    setOrb('idle');
    setQ('소리가 들렸나요?', '&nbsp;');
    const ans = await ask([['들렸어요', ICON.ear], ['안 들렸어요', ICON.x]], null, 'two');
    const heard = ans === 0;
    const ok = heard === present;
    if (present && heard) {
      quietest = quietest == null ? toneDb : Math.min(quietest, toneDb);
      freqBest[freq] = Math.min(freqBest[freq] ?? 0, toneDb);
      toneDb = Math.max(-60, toneDb - 5);
    } else if (present && !heard) toneDb = Math.min(0, toneDb + 5);
    feedback(ok, ok ? '잘 들으셨어요!' : '괜찮아요',
      ok ? (present ? '다음은 조금 더 작게 들려드릴게요.' : '이번엔 소리가 없었어요.') : (present ? `${FREQ_NAME[freq]}(${freq}Hz)가 있었어요. 조금 크게 다시 해 봐요.` : '이번엔 소리가 없었어요.'));
    return ok;
  }

  // 생활 소리 고르기
  async function envTrial() {
    const ids = shuffle(c.pool || Object.keys(ENV_SOUNDS)).slice(0, c.n);
    const target = pick(ids);
    $('#answers').innerHTML = '';
    setQ('무슨 소리일까요?', replayBtn());
    $('#replay').onclick = replay(() => playEnv(target));
    await playing(playEnv(target));
    if (!alive()) return false;
    const ans = await ask(ids.map((x) => [ENV_SOUNDS[x].name, ENV_SOUNDS[x].icon]), ids.indexOf(target), ids.length === 2 ? 'two' : '');
    const ok = ids[ans] === target;
    const pair = [() => playEnv(target), () => playEnv(ids[ans])];
    feedback(ok, ok ? '잘 들으셨어요!' : '괜찮아요', ok ? `${ENV_SOUNDS[target].name} 소리였어요.` : `정답은 ${ida(ENV_SOUNDS[target].name)}. 두 소리를 견줘 들어 보세요.`,
      ok ? null : [[`정답: ${ENV_SOUNDS[target].name}`, pair[0]], [`고른 것: ${ENV_SOUNDS[ids[ans]].name}`, pair[1]]]);
    if (!ok) {
      misses.push({ kind: 'env', answer: target, chose: ids[ans], options: ids, label: ENV_SOUNDS[target].name, choseLabel: ENV_SOUNDS[ids[ans]].name, replayFns: pair });
      await replayAnswer(pair[0]);
    }
    return ok;
  }

  // 낱말 고르기
  async function wordTrial() {
    const { item, focus } = pickTailored(c.sets(), (w) => w, c.weak ? 1 : 0.6);
    const set = shuffle(item);
    const target = pickHeard(focus ? focus.pair : set);
    $('#answers').innerHTML = '';
    setQ('어떤 말을 들었나요?', focusTag(focus) + replayBtn() + '<span class="src" id="src"></span>');
    $('#replay').onclick = replay(() => playWord(target));
    const src = await playing(playWord(target));
    if (!alive()) return false;
    const srcEl = $('#src'); if (srcEl) srcEl.textContent = SRC_LABEL[src] || '';
    const ans = await ask(set.map((w) => [w]), set.indexOf(target), set.some((w) => w.length > 5) ? 'sentences' : 'words');
    const ok = set[ans] === target;
    logFocus(focus, ok);
    logItem(target, ok); // 단어장 정답률에도 센다
    if (!ok) for (const x of contrasts(target, set[ans])) if (x !== '단어 길이') sessionConf[x] = (sessionConf[x] || 0) + 1; // 길이 차이는 소리 혼동이 아니다
    const why = ok ? '' : contrasts(target, set[ans]).filter((x) => x !== '단어 길이').map(friendly).join(', ');
    const pair = [() => playWord(target), () => playWord(set[ans])];
    feedback(ok, ok ? '잘 들으셨어요!' : '괜찮아요', ok ? `"${esc(target)}"였어요.` : `정답은 "${esc(target)}"예요.${why ? ` <span class="why">${esc(why)}</span>` : ''}`,
      ok ? null : [[`정답: ${target}`, pair[0]], [`고른 것: ${set[ans]}`, pair[1]]]);
    if (!ok) {
      misses.push({ kind: 'word', answer: target, chose: set[ans], options: set, say: target, label: target, choseLabel: set[ans], replayFns: pair });
      await replayAnswer(pair[0]); // 틀리면 정답을 한 번 더 들려준다
    }
    return ok;
  }

  // 문장 고르기. 4-3은 문장 속 낱말을 고르게 해 약한 소리 분석에 넣는다.
  async function sentenceTrial() {
    const keyword = c.level === 3;
    let say; let opts; let target; let frame;
    let focus = null;
    if (keyword) {
      const t = pickTailored(SENTENCE_SETS[3], (it) => it.words);
      focus = t.focus;
      frame = t.item.frame; opts = shuffle(t.item.words); target = pickHeard(focus ? focus.pair : opts, (w) => fillFrame(frame, w)); say = fillFrame(frame, target);
    } else {
      opts = shuffle(pick(SENTENCE_SETS[c.level])); target = pickHeard(opts); say = target;
    }
    $('#answers').innerHTML = '';
    setQ(keyword ? '문장에서 어떤 낱말이 들렸나요?' : '어떤 문장을 들었나요?', focusTag(focus) + replayBtn() + '<span class="src" id="src"></span>');
    $('#replay').onclick = replay(() => playWord(say));
    const src = await playing(playWord(say));
    if (!alive()) return false;
    const srcEl = $('#src'); if (srcEl) srcEl.textContent = SRC_LABEL[src] || '';
    const ans = await ask(opts.map((w) => [w]), opts.indexOf(target), keyword ? 'words' : 'sentences');
    const ok = opts[ans] === target;
    logFocus(focus, ok);
    if (!ok && keyword) for (const x of contrasts(target, opts[ans])) sessionConf[x] = (sessionConf[x] || 0) + 1;
    const why = !ok && keyword ? contrasts(target, opts[ans]).map(friendly).join(', ') : '';
    const chosenSay = keyword ? fillFrame(frame, opts[ans]) : opts[ans];
    const pair = [() => playWord(say), () => playWord(chosenSay)];
    feedback(ok, ok ? '잘 들으셨어요!' : '괜찮아요', ok ? `"${esc(say)}"` : `들린 문장은 "${esc(say)}"예요.${why ? ` <span class="why">${esc(why)}</span>` : ''}`,
      ok ? null : [['정답 문장', pair[0]], ['고른 문장', pair[1]]]);
    if (!ok) {
      misses.push({ kind: keyword ? 'frame' : 'sent', answer: target, chose: opts[ans], options: opts, say, ...(keyword ? { frame } : {}), label: say, choseLabel: opts[ans], replayFns: pair });
      await replayAnswer(pair[0]);
    }
    return ok;
  }

  // 장소 소음 속 문장 고르기. 틀리면 소음 없이 정답을 들려준다.
  async function noiseTrial() {
    const opts = shuffle(pick([...sc.easy, ...sc.hard])); const target = pickHeard(opts);
    $('#answers').innerHTML = '';
    setQ(`${sc.name}에서 들린 말은?`, `<span class="chip scene">${sc.icon} ${sc.name} · 소음 ${snrText(c.snr)}</span>` + replayBtn() + '<span class="src" id="src"></span>');
    const listen = () => withNoise(c.scene, c.snr, () => playWord(target));
    $('#replay').onclick = replay(listen);
    const src = await playing(listen());
    if (!alive()) return false;
    const srcEl = $('#src'); if (srcEl) srcEl.textContent = SRC_LABEL[src] || '';
    const ans = await ask(opts.map((w) => [w]), opts.indexOf(target), 'sentences');
    const ok = opts[ans] === target;
    const fns = [() => playWord(target), () => playWord(opts[ans]), listen];
    feedback(ok, ok ? '잘 들으셨어요!' : '괜찮아요', ok ? `"${esc(target)}"` : `들린 말은 "${esc(target)}"예요. 조용할 때 소리를 먼저 익혀 봐요.`,
      ok ? null : [['정답 문장', fns[0]], ['고른 문장', fns[1]], ['소음 속에서 다시', fns[2]]]);
    if (!ok) {
      misses.push({ kind: 'noise', answer: target, chose: opts[ans], options: opts, say: target, scene: c.scene, snr: c.snr, label: target, choseLabel: opts[ans], replayFns: fns });
      await replayAnswer(fns[0]);
    }
    return ok;
  }

  // 소리 높낮이(2-3): 말끝이 올라가는지 내려가는지. 합성한 소리라 기기 음성이 없어도 된다.
  async function supraTrial() {
    const it = supraItem(c.mode, c.labels);
    $('#answers').innerHTML = '';
    setQ(c.labels ? '끝이 올라갔나요, 내려갔나요?' : SUPRA[c.mode].q, replayBtn());
    $('#replay').onclick = replay(it.play);
    await playing(it.play());
    if (!alive()) return false;
    const ans = await ask(it.opts, it.right, 'two');
    const ok = ans === it.right;
    const right = it.opts[it.right][0]; const chose = it.opts[ans][0];
    const pair = [it.plays[it.right], it.plays[ans]];
    feedback(ok, ok ? '잘 들으셨어요!' : '괜찮아요', ok ? it.tell : `정답은 ${ida(right)}. ${it.tell}`,
      ok ? null : [[`정답: ${right}`, pair[0]], [`고른 것: ${chose}`, pair[1]]]);
    if (!ok) {
      misses.push({ local: true, label: right, choseLabel: chose, replayFns: pair });
      await replayAnswer(pair[0]);
    }
    return ok;
  }

  function focusTag(focus) {
    return focus ? `<span class="focus-tag">${ICON.target}맞춤 문제 · ${esc(friendly(focus.c))}</span>` : '';
  }
  function logFocus(focus, ok) {
    if (!focus) return;
    const f = data.focusLog[focus.c] || { n: 0, ok: 0 };
    data.focusLog[focus.c] = { n: f.n + 1, ok: f.ok + (ok ? 1 : 0) };
  }
  // compare: 틀렸을 때 정답과 고른 답을 번갈아 들어 보는 버튼 [[이름, 재생 함수], ...]
  function feedback(ok, title, text, compare) {
    const sh = $('#sheet');
    sh.className = `sheet ${ok ? 'good' : 'bad'}`;
    sh.querySelector('.sheet-icon').innerHTML = ok ? ICON.check : ICON.x;
    $('#sheet-title').textContent = title;
    $('#sheet-text').innerHTML = text;
    const cmp = $('#compare');
    cmp.innerHTML = compare ? compare.map(([label], i) => `<button class="pill" data-k="${i}">${ICON.speaker}${esc(label)}</button>`).join('') : '';
    cmp.hidden = !compare;
    cmp.querySelectorAll('button').forEach((b) => { b.onclick = replay(compare[+b.dataset.k][1]); });
    sh.hidden = false;
  }
  // 정답을 다시 들려주는 동안에는 '다음'을 잠가 두어, 누른 것이 사라지지 않게 한다
  async function replayAnswer(fn) {
    const btn = $('#next');
    btn.disabled = true;
    try { await playing(fn()); } finally { btn.disabled = false; }
  }
  function nextTap(last) {
    const sh = $('#sheet'); const btn = $('#next');
    btn.textContent = last ? '결과 보기' : '다음';
    btn.focus({ preventScroll: true });
    return new Promise((r) => { btn.onclick = () => { sh.hidden = true; r(); }; });
  }
}
const $ = (s) => view.querySelector(s);
const replayBtn = (label = '다시 듣기') => `<button class="pill" id="replay">${ICON.speaker}${label}</button>`;
// 보기 버튼을 보여 주고 고른 번호를 돌려준다. rightIdx를 주면 정답/오답 색을 칠하고, 없으면 고른 것만 표시한다.
function ask(options, rightIdx, layout = '') {
  const box = $('#answers');
  box.className = '';
  box.innerHTML = `<div class="choices ${layout}">${options.map(([main, pic], i) =>
    `<button class="choice" data-i="${i}" style="--d:${i * 50}ms">${pic ? `<span class="pic" aria-hidden="true">${pic}</span>` : ''}<span class="label">${esc(main)}</span></button>`).join('')}</div>`;
  return new Promise((res) => {
    box.querySelectorAll('.choice').forEach((b) => {
      b.onclick = () => {
        const i = +b.dataset.i;
        box.querySelectorAll('.choice').forEach((x) => { x.disabled = true; });
        if (rightIdx != null) {
          box.querySelector(`[data-i="${rightIdx}"]`).classList.add('right');
          if (i !== rightIdx) b.classList.add('wrong');
        } else b.classList.add('picked');
        res(i);
      };
    });
  });
}

/* ---------- 관문 ---------- */

// 그 장소를 그대로 옮긴 장면 15문항. 문제마다 맞았는지는 끝나고 알려 준다(월간 점검처럼).
async function renderGate(n) {
  setNav('play');
  const token = ++playToken;
  const alive = () => token === playToken;
  const g = GATES[n]; const chap = chapterOf(n);
  const inRun = !!todayRun && todayRun.queue[todayRun.i] === current;
  const back = inRun ? '#home' : `#ch/${n}`;
  const qs = []; // talk는 질문마다 한 문항
  g.items.forEach((it) => { if (it.t === 'talk') it.qs.forEach((q, j) => qs.push({ it, q, j })); else qs.push({ it }); });
  const total = qs.length; const need = gateNeed(total, GATE_PASS);
  const left = GATE_TRIES - gateTriesToday(n);
  const useAsr = !!Recognition;
  const says = g.items.filter((it) => it.t === 'say').length;
  view.innerHTML = playShell(back, `${n}장 ${chap.name} · 관문`, g.title,
    `${g.about}<br><span class="chips"><span class="chip scene">${sceneOf(g)}</span><span class="chip">${total}문제 중 ${need}개 이상</span><span class="chip">말로 대답 ${says}개</span></span>`,
    left <= 0 ? `<p class="note center">오늘은 세 번 다 도전했어요. 내일 다시 해요.</p><button class="btn block" data-go="${back}">돌아가기</button>`
      : startBox(inRun, `<p class="note center">${useAsr ? '말로 대답하는 문제는 마이크 버튼을 누르고 대답해요. 말하기 어려우면 대답을 골라도 돼요.' : '이 기기에서는 음성 인식이 안 돼서 말 대신 대답을 골라요.'} 맞았는지는 끝나고 알려 드려요. 오늘 ${left}번 도전할 수 있어요.</p>`));
  $('#orb').innerHTML = ICON.flag;
  $('#pnum').textContent = `${total}문제`;
  if (left <= 0) return;
  await waitStart(inRun, alive);
  if (!alive()) return;
  const startedAt = Date.now();
  const orb = $('#orb'); orb.innerHTML = ICON.speaker;
  const noisy = (fn) => (g.noise ? withNoise(g.noise.id, g.noise.snr, fn) : fn());
  let busy = false;
  const playing = async (fn) => { busy = true; orb.className = 'orb playing'; try { return await fn(); } finally { busy = false; if (alive()) orb.className = 'orb idle'; } };
  const sayLines = (lines) => async () => { for (let i = 0; i < lines.length && alive(); i++) { if (i) await wait(350); const l = lines[i]; await playWord(l.s || l, l.v); } };
  const setQ = (q, hint = '') => { $('#q').textContent = q; $('#hint').innerHTML = hint; };
  // 다시 듣기는 문제마다 한 번
  const oneReplay = (fn) => {
    const b = $('#replay'); if (!b) return;
    b.onclick = () => { if (busy) return; b.disabled = true; b.lastChild.textContent = '다시 듣기를 썼어요'; playing(fn); };
  };
  let correct = 0; const miss = [];

  for (let i = 0; i < total && alive(); i++) {
    const { it, q, j } = qs[i];
    $('#pnum').textContent = `${i + 1}번째 / ${total}문제`;
    $('#pbar').style.width = `${(100 * i) / total}%`;
    $('#answers').innerHTML = '';
    let ok = false;
    if (it.t === 'env') {
      const opts = shuffle(it.opts);
      setQ('무슨 소리일까요?', replayBtn('한 번 더 듣기'));
      const listen = () => noisy(() => playEnv(it.s));
      await playing(listen); if (!alive()) return;
      oneReplay(listen);
      const k = await ask(opts.map((x) => [ENV_SOUNDS[x].name, ENV_SOUNDS[x].icon]), null);
      ok = opts[k] === it.s;
      if (!ok) miss.push({ label: ENV_SOUNDS[it.s].name, note: `고른 것: ${ENV_SOUNDS[opts[k]].name}`, fns: [['정답 소리', () => playEnv(it.s)], ['고른 소리', () => playEnv(opts[k])]] });
    } else if (it.t === 'pick') {
      const opts = shuffle(it.opts); const target = pickHeard(opts);
      setQ('어떤 말이 들렸나요?', replayBtn('한 번 더 듣기'));
      const listen = () => noisy(() => playWord(target));
      await playing(listen); if (!alive()) return;
      oneReplay(listen);
      const k = await ask(opts.map((x) => [x]), null, 'sentences');
      ok = opts[k] === target;
      if (!ok) miss.push({ label: target, note: `고른 것: ${opts[k]}`, fns: [['정답', () => playWord(target)], ['고른 것', () => playWord(opts[k])], ['소음 속에서', listen]].filter((x, m) => m < 2 || g.noise) });
    } else if (it.t === 'talk') {
      const listen = () => noisy(sayLines(it.lines));
      if (j === 0) {
        setQ(it.lines.length > 1 ? '잘 들어 보세요. 듣고 나서 질문에 답해요' : '잘 들어 보세요', '&nbsp;');
        await playing(listen); if (!alive()) return;
      }
      setQ(q.q, replayBtn('한 번 더 듣기'));
      oneReplay(listen);
      const opts = shuffle(q.opts);
      const k = await ask(opts.map((x) => [x]), null, 'sentences');
      ok = opts[k] === q.opts[0];
      if (!ok) miss.push({ label: `${q.q} → ${q.opts[0]}`, note: `고른 것: ${opts[k]}`, fns: [['조용할 때 다시 듣기', sayLines(it.lines)]] });
    } else {
      ok = await sayTrial(it);
      if (!alive()) return;
      if (!ok) miss.push({ label: `“${it.s}”`, note: `이렇게 대답할 수 있어요: ${it.alt[0]}`, fns: [['묻는 말 다시 듣기', () => playWord(it.s)]] });
    }
    if (stopNoise) stopNoise();
    if (ok) correct++;
    await wait(450);
  }
  if (!alive()) return;

  const pass = correct >= need;
  const nextWasOpen = n < 7 && chapterOpen(n + 1);
  data.gates.push({ ch: n, date: today(), at: Date.now(), correct, total, pass, sec: Math.round((Date.now() - startedAt) / 1000) });
  persist();
  const opened = n < 7 && !nextWasOpen && chapterOpen(n + 1);
  const nextName = n < 7 ? `${n + 1}장 ${chapterOf(n + 1).name}` : '';
  const leftNow = GATE_TRIES - gateTriesToday(n);
  let status;
  if (pass) {
    status = n === 5 ? '카페 소음 속에서 점원과 주문 대화를 끝까지 해냈어요. 일상 대화 대부분을 해내는 생활 깃발에 닿았어요.'
      : `${g.title} 장면을 해냈어요. ${n}장의 칸은 모두 통과로 쳐요.`;
    if (opened) status += ` ${josa(nextName, '이', '가')} 열렸어요.`;
  } else if (opened) {
    status = `2주 넘게 도전해 ${gateNeed(total, GATE_STUCK)}개를 넘었어요. ${josa(nextName, '을', '를')} 열어 둘게요. 이 관문은 언제든 다시 도전할 수 있어요.`;
  } else {
    status = `${need}개 이상이면 넘어요. ${leftNow > 0 ? `오늘 ${leftNow}번 더 도전할 수 있어요.` : '오늘 도전은 다 했어요. 내일 다시 해요.'}`;
  }
  const acts = roundActions(back, !pass && leftNow > 0, '다시 도전하기');
  view.innerHTML = `
    <div class="play result">
      <p class="eyebrow center">${n}장 관문 · ${g.title}</p>
      <h1 class="q">${total}문제 중 ${correct}개 맞혔어요</h1>
      <p class="lead center">${status}</p>
      ${pass ? `<section class="panel mission"><div class="focus-head"><span class="focus-ico">${ICON.walk}</span><div><h2 class="panel-title">이제 밖에서 해 볼 일</h2><p class="tip-body">${chap.mission}</p></div></div></section>` : ''}
      ${acts.ended ? `<p class="lead center">오늘의 연습 ${TODAY_N}판을 마쳤어요.</p>` : ''}
      ${miss.length ? `
      <section class="panel miss-panel">
        <h2 class="panel-title">틀린 문제 다시 듣기</h2>
        <ul class="miss-rows">${miss.map((m, i) => `
          <li><span class="miss-a">${esc(m.label)}<small>${esc(m.note)}</small></span>
            <span class="miss-btns">${m.fns.map(([label], k) => `<button class="pill${k ? ' alt' : ''}" data-m="${i}" data-k="${k}">${ICON.speaker}${esc(label)}</button>`).join('')}</span></li>`).join('')}
        </ul>
      </section>` : ''}
      <div class="actions">${acts.html}</div>
    </div>`;
  acts.bind();
  let rbusy = false;
  view.querySelectorAll('[data-m]').forEach((b) => {
    b.onclick = async () => {
      if (rbusy) return; rbusy = true; b.classList.add('busy');
      try { await miss[+b.dataset.m].fns[+b.dataset.k][1](); } finally { rbusy = false; b.classList.remove('busy'); if (stopNoise) stopNoise(); }
    };
  });

  // 말로 대답하기: 묻는 말을 듣고 마이크로 대답한다. 음성 인식이 없거나 말하기 어려우면 대답을 고른다.
  async function sayTrial(it) {
    setQ('대답해 보세요', replayBtn('한 번 더 듣기'));
    const listen = () => noisy(() => playWord(it.s));
    await playing(listen); if (!alive()) return false;
    oneReplay(listen);
    const choose = async () => {
      const opts = shuffle(it.alt);
      $('#q').textContent = '어떻게 대답할까요?';
      const k = await ask(opts.map((x) => [x]), null, 'sentences');
      return opts[k] === it.alt[0];
    };
    if (!useAsr) return choose();
    for (;;) {
      $('#answers').innerHTML = `<button class="btn primary block mic-btn" id="mic">${ICON.mic2}<span>누르고 대답하기</span></button>
        <button class="btn ghost block" id="choose">말 대신 고르기</button>`;
      const how = await new Promise((r) => { $('#mic').onclick = () => r('mic'); $('#choose').onclick = () => r('choose'); });
      if (!alive()) return false;
      if (how === 'choose') return choose();
      const mic = $('#mic'); mic.disabled = true; mic.classList.add('listening'); mic.lastChild.textContent = '듣고 있어요…';
      orb.className = 'orb listening';
      try {
        const alts = await listenOnce();
        if (!alive()) return false;
        if (!alts.length) { toast('대답을 못 들었어요. 마이크 가까이에서 다시 말해 주세요.'); continue; }
        const flat = (x) => x.replace(/\s/g, '');
        const ok = it.ok == null || alts.some((h) => it.ok.some((w) => flat(h).includes(flat(w))));
        $('#hint').innerHTML = `<span class="src">들린 대답: “${esc(alts[0])}”</span>`;
        await wait(1100);
        return ok;
      } catch (e) {
        toast(e === 'not-allowed' || e === 'service-not-allowed' ? '마이크를 쓸 수 없어요. 대답을 골라 주세요.'
          : e === 'network' ? '음성 인식은 인터넷이 연결돼 있어야 해요. 대답을 골라 주세요.' : '다시 한 번 눌러 대답해 주세요.');
        if (e === 'not-allowed' || e === 'service-not-allowed' || e === 'network') return choose();
      } finally {
        if (alive()) orb.className = 'orb idle';
      }
    }
  }
}

function countUp(el, to) {
  if (!el) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / 700);
    el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- 라우터 ---------- */

// 화면 상태는 메모리에 둔다(주소 해시를 쓸 수 없는 미리보기 환경에서도 동작하도록).
let current = location.hash || '#home';
function go(h) {
  current = h;
  try { history.pushState({ h }, ''); } catch {} // 휴대폰 뒤로가기로 앱 안의 이전 화면으로 돌아오게 한다
  route();
}
window.addEventListener('popstate', (e) => { current = e.state?.h || '#home'; route(); });
try { history.replaceState({ h: current }, ''); } catch {}
function route() {
  playToken++;
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (stopNoise) stopNoise();
  if (activeRec) activeRec.abort();
  document.body.classList.remove('in-play');
  let h = current;
  const old = h.match(/^#play\/(\d)$/); // 단계 번호로 된 옛 주소
  if (old && PLAN_STAGE[old[1]]) h = current = `#cell/${PLAN_STAGE[old[1]]}`;
  if (!todayRun || todayRun.queue[todayRun.i] !== h) todayRun = null; // 오늘의 연습 밖으로 나가면 끝낸다
  const cell = h.match(/^#cell\/(\d-\d)$/);
  const gate = h.match(/^#gate\/(\d)$/);
  const ch = h.match(/^#ch\/(\d)$/);
  const inv = h.match(/^#plan\/(.+)$/);
  const fc = h.match(/^#focus(?:\/(word|sound|sent)(?:\/(\d+)(\/go)?)?)?$/);
  const vc = h.match(/^#vocab(?:\/(\d+)(\/go)?)?$/);
  const sp = h.match(/^#supra\/(\w+)$/);
  const flv = fc && fc[2] && +fc[2] >= 1 && +fc[2] <= 10 ? +fc[2] : null;
  const vch = vc && vc[1] && VOCAB[+vc[1] - 1] ? +vc[1] : null;
  if (cell && CELL[cell[1]]?.kind) (CELL[cell[1]].kind === 'speak' ? renderSpeak(cell[1]) : renderPlay(cell[1]));
  else if (h === '#weak') renderPlay('weak');
  else if (gate && GATES[gate[1]]) renderGate(+gate[1]);
  else if (ch && chapterOf(+ch[1])) renderChapter(+ch[1]);
  else if (inv) renderPlanInvite(inv[1]);
  else if (h === '#clinic') renderClinic();
  else if (h === '#check') renderCheck();
  else if (h === '#voices') renderVoices();
  else if (h === '#progress') renderProgress();
  else if (h === '#report') renderReport();
  else if (h === '#speak') renderSpeak(null);
  else if (h === '#noise') renderNoiseRec();
  else if (h === '#retest') renderRetest();
  else if (h === '#who') renderWho(false);
  else if (h === '#ling') renderLing();
  else if (h === '#maps') renderMaps();
  else if (h === '#supra') renderSupra();
  else if (sp && SUPRA[sp[1]]) renderSupraQuiz(sp[1]);
  else if (fc && flv) (fc[3] ? renderFocusTest(fc[1], flv) : renderFocusLevel(fc[1], flv));
  else if (fc && fc[1]) renderFocusCat(fc[1]);
  else if (fc) renderFocusHome();
  else if (vc && vch) (vc[2] ? renderVocabQuiz(vch) : renderVocabCh(vch));
  else if (vc) renderVocab();
  else renderHome();
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-go]');
  if (!el) return;
  e.preventDefault();
  go(el.dataset.go);
});
route();

// 홈 화면에 설치한 앱이 인터넷 없이도 열리게 한다(https나 localhost에서만 동작).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
