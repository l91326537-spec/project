'use strict';
/*
 * 소리길: 게임형 청능훈련 시제품
 * - 1단계 소리 감지: 순음을 점점 작게(적응형 계단법) 들려주고 들렸는지 묻는다.
 * - 2단계 환경음: 합성한 생활 소리를 듣고 무슨 소리인지 고른다.
 * - 3단계 단어: 가족 녹음 또는 한국어 TTS로 단어를 듣고 고른다. 틀린 답에서 헷갈린 자모를 뽑는다.
 * - 5단계 문장, 6단계 소음 속 듣기(식당·카페·버스·병원 소리를 합성해 깔고 문장을 들려준다).
 * - 자주 헷갈린 소리는 3·5단계에서 더 자주 낸다(맞춤 출제).
 * - 따라 말하기: 들은 말을 소리 내어 따라 하면 음성 인식 결과를 자모 단위로 비교한다.
 * 모든 기록은 이 기기(localStorage, IndexedDB)에만 저장된다.
 */

const TRIALS = 10;
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
  sessions: [],          // {date, stage, score, correct, total, level}
  levels: { 1: 1, 2: 1, 3: 1, 5: 1, 6: 1 },
  minDb: null,           // 1단계에서 들린 가장 작은 소리(dB, 기준 대비)
  toneByFreq: {},        // 1단계 주파수별로 들린 가장 작은 소리
  bigText: false,
  confusions: {},        // '초성 ㅅ↔ㅆ': 횟수
  focusLog: {},          // 맞춤 문제 결과 '초성 ㅅ↔ㅆ': {n, ok}
  speakLog: [],          // 따라 말하기 한 판: {date, at, mode, n, score}
  speakConf: {},         // 따라 말하기에서 다르게 들린 소리 '초성 ㅅ↔ㅆ': 횟수
  preferFamily: true,
  reportName: '',
  reportMemo: '',
  plan: null,            // 선생님이 보낸 숙제 {by, stages, kind, amount, days, memo, at}
  tip: 0,                // 다음에 보여 줄 생활 듣기 요령 번호
  checks: [],            // 월간 듣기 점검 {date, at, score, parts: {word: [맞힘, 문제 수], ...}, miss: [문제 번호]}
});
let data = Object.assign(fresh(), store.load());
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

// 1단계: 순음. level은 기준 대비 dB(0이 가장 큼).
function playTone(freq, db, dur = 0.8) {
  const c = audio();
  osc(c, c.destination, 'sine', freq, c.currentTime + 0.05, dur, 0.5 * dbToGain(db));
  return wait(dur * 1000 + 100);
}

// 2단계: 생활 소리를 녹음 파일 없이 합성한다.
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
  const master = c.createGain(); master.gain.value = 0.9; master.connect(c.destination);
  s.make(c, master, c.currentTime + 0.05);
  return wait(s.dur * 1000 + 200);
}

// 6단계: 장소 소음. 여러 사람이 떠드는 소리(babble)와 그곳의 소리를 미리 합성해 반복 재생한다.
// 소음 RMS는 0.1, AI 음성 말소리 RMS는 약 0.14다. 레벨별 말소리 대 소음 비(SNR) +12, +6, +2dB
const NOISE_GAIN = { 1: 0.35, 2: 0.7, 3: 1.1 };
const noiseCache = {};
function sceneBuffer(c, id) {
  if (noiseCache[id]) return noiseCache[id];
  const sr = 22050; const len = sr * 8; const fade = Math.round(sr / 4);
  const out = new Float32Array(len + fade);
  let seed = id.length * 7919;
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
async function withNoise(id, level, fn) {
  const c = audio();
  const buf = sceneBuffer(c, id);
  const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
  const g = c.createGain(); g.gain.value = 0;
  src.connect(g); g.connect(c.destination);
  if (stopNoise) stopNoise();
  stopNoise = () => { try { src.stop(); } catch {} stopNoise = null; };
  const t = c.currentTime;
  src.start(t, Math.random() * buf.duration);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(NOISE_GAIN[level] || 0.3, t + 0.6);
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

// 3단계: 단어. 가족 녹음이 있으면 그것을, 없으면 한국어 TTS를 쓴다.
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

function playUrl(url) {
  const a = new Audio(url);
  return new Promise((res) => { a.onended = a.onerror = res; a.play().catch(res); setTimeout(res, 8000); }).then(() => a.pause()); // 재생이 멈춰도 넘어간다
}

const spriteCache = {};
function loadSprite(url) {
  return spriteCache[url] || (spriteCache[url] = fetch(url).then((r) => r.arrayBuffer())
    .then((b) => new Promise((res, rej) => audio().decodeAudioData(b, res, rej))) // 옛 사파리는 콜백 방식만 된다
    .catch((e) => { delete spriteCache[url]; throw e; }));
}
async function playSprite({ s, t, d }) {
  const buf = await loadSprite(s);
  const c = audio(); const src = c.createBufferSource();
  src.buffer = buf; src.connect(c.destination); src.start(0, t, d);
  await new Promise((res) => { src.onended = res; setTimeout(res, d * 1000 + 500); });
}

async function playWord(word) {
  if (data.preferFamily) {
    const blob = await voiceDb.get(word);
    if (blob) {
      const url = URL.createObjectURL(blob);
      await playUrl(url);
      URL.revokeObjectURL(url);
      return 'family';
    }
  }
  await voicePackReady;
  const v = voicePack[word];
  if (v) {
    try { await (typeof v === 'string' ? playUrl(v) : playSprite(v)); return 'pack'; } catch {} // 묶음을 못 읽으면 기기 음성으로
  }
  if (!window.speechSynthesis) return 'none';
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = 'ko-KR'; u.rate = 0.85;
  if (koVoice) u.voice = koVoice;
  await new Promise((res) => { u.onend = u.onerror = res; speechSynthesis.speak(u); setTimeout(res, 3000 + word.length * 250); }); // 문장은 길어서 기다리는 시간을 늘린다
  return koVoice ? 'tts' : 'tts-nokorean';
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
// 약한 소리가 있으면 10문제 중 6문제쯤은 그 소리가 든 묶음을 무게에 비례해 고른다.
function pickTailored(items, wordsOf) {
  const scored = items.map((it) => ({ it, wp: weakPair(wordsOf(it)) })).filter((x) => x.wp);
  if (scored.length && Math.random() < 0.6) {
    let r = Math.random() * scored.reduce((a, x) => a + x.wp.w, 0);
    for (const x of scored) { r -= x.wp.w; if (r <= 0) return { item: x.it, focus: x.wp }; }
    const last = scored[scored.length - 1]; return { item: last.it, focus: last.wp };
  }
  return { item: pick(items), focus: null };
}
const weakTop = (n) => Object.entries(data.confusions).filter(([k]) => k !== '단어 길이').sort((a, b) => b[1] - a[1]).slice(0, n);

/* ---------- 문항 ---------- */

const ALL_WORDS = [...new Set(Object.values(WORD_SETS).flat(2))];

const NOISE_SENTENCES = [...new Set(Object.values(NOISE_SCENES).flatMap((sc) => [...sc.easy, ...sc.hard].flat()))];
const ALL_SENTENCES = [...new Set([...SENTENCE_SETS[1], ...SENTENCE_SETS[2]].flat().concat(NOISE_SENTENCES))];
const hasBatchim = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c <= 11171 && c % 28 !== 0; };
const fillFrame = (frame, w) => frame.replace('_{을}', w + (hasBatchim(w) ? '을' : '를')).replace('_{이}', w + (hasBatchim(w) ? '이' : '가'));
const ENV_POOLS = { 1: 2, 2: 3, 3: 4 }; // 단계별 보기 수
const TONES = [500, 1000, 2000, 4000];

const STAGES = [
  { n: 1, name: '소리 감지', desc: '소리가 나면 알려요', ready: true },
  { n: 2, name: '환경음', desc: '생활 소리를 맞혀요', ready: true },
  { n: 3, name: '단어', desc: '들은 단어를 골라요', ready: true },
  { n: 4, name: '비슷한 소리 구별', desc: '같은지 다른지 가려요' },
  { n: 5, name: '문장', desc: '생활 문장을 알아들어요', ready: true },
  { n: 6, name: '소음 속 듣기', desc: '시끄러운 곳에서 들어요', ready: true },
  { n: 7, name: '대화', desc: '묻고 답하며 들어요' },
];

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const today = () => new Date().toLocaleDateString('sv-SE');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function streak() {
  const days = new Set(data.sessions.map((s) => s.date));
  let n = 0; const d = new Date();
  if (!days.has(today())) d.setDate(d.getDate() - 1); // 오늘 아직 안 했으면 어제부터 센다
  while (days.has(d.toLocaleDateString('sv-SE'))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// 최근 정답률로 다음 판의 단계를 정한다.
function adjustLevel(stage, acc) {
  const cur = data.levels[stage] || 1;
  if (acc >= 0.8 && cur < 3) data.levels[stage] = cur + 1;
  else if (acc < 0.5 && cur > 1) data.levels[stage] = cur - 1;
  return data.levels[stage];
}


/* ---------- 아이콘 ---------- */

const ICON = {
  path: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c3 0 3-4 7-4s4-4 7-4M5 19a2 2 0 1 0 0 .01M19 11a2 2 0 1 0 0 .01M12 5a2 2 0 1 0 0 .01"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  ear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-5.5 1.6"/><path d="M10 9.5a2 2 0 0 1 4 0c0 1.2-1 1.5-1.4 2.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  flame: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 4 6 5 6 11a6 6 0 0 1-12 0c0-3 2-4 2-7 2 1 3 3 3 5 1-2 1-6 1-9z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12h.01"/></svg>',
  doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>',
  mic2: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg>',
  print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3h10v6M7 17H4v-7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v7h-3"/><rect x="7" y="14" width="10" height="7"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
};
const stars = (n) => `<span class="stars" aria-label="레벨 ${n}/3">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;

/* ---------- 화면 ---------- */

// 하루 목표: 선생님 숙제가 있으면 숙제 분량, 없으면 집 화면에서 고른 목표(처음엔 3판)
const GOAL_CHOICES = [{ kind: 'r', amount: 3 }, { kind: 'r', amount: 5 }, { kind: 'm', amount: 10 }, { kind: 'm', amount: 20 }];
const goalOf = (d = data) => (d.plan ? { kind: d.plan.kind, amount: d.plan.amount } : Object.assign({ kind: 'r', amount: 3 }, d.goal));
const goalNow = (d = data) => { const t = todayDone(d); return goalOf(d).kind === 'm' ? t.min : t.rounds; };
const goalText = (g) => `${g.amount}${PLAN_UNIT[g.kind]}`;

// 오늘의 연습: 버튼 하나로 숙제(없으면 추천 단계)를 목표를 채울 때까지 이어서 한다
let todayRun = null; // { queue: [단계], i }
function todayQueue() {
  const q = data.plan ? data.plan.stages : STAGES.filter((st) => st.ready).map((st) => st.n);
  const first = data.plan ? planNext(data) : recommended();
  const k = Math.max(0, q.indexOf(first));
  return [...q.slice(k), ...q.slice(0, k)];
}
function startToday() {
  unlockAudio(); // 누른 김에 소리를 열어 두어 판마다 '시작'을 다시 누르지 않게 한다
  const queue = todayQueue();
  todayRun = { queue, i: 0 };
  go(`#play/${queue[0]}`);
}

// 응원 한마디: 가족이 녹음해 두면 하루 목표를 채웠을 때 들려준다
const CHEER_KEY = '__cheer__';
function fanfare() {
  const c = audio(); const t = c.currentTime + 0.05;
  [523, 659, 784, 1047].forEach((f, i) => osc(c, c.destination, 'triangle', f, t + i * 0.12, i === 3 ? 0.5 : 0.18, 0.18));
}
async function playCheer() {
  fanfare();
  const blob = await voiceDb.get(CHEER_KEY);
  if (!blob) return false;
  await wait(800);
  const url = URL.createObjectURL(blob);
  await playUrl(url);
  URL.revokeObjectURL(url);
  return true;
}

function setNav(name) {
  document.body.classList.toggle('in-play', name === 'play');
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === name;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

// 오늘 아직 안 한 가장 낮은 단계를 추천한다.
function recommended() {
  const done = new Set(data.sessions.filter((s) => s.date === today()).map((s) => s.stage));
  const ready = STAGES.filter((s) => s.ready);
  return (ready.find((s) => !done.has(s.n)) || ready[ready.length - 1]).n;
}

function ring(value, max, size = 92) {
  const r = size / 2 - 7; const c = 2 * Math.PI * r;
  const p = Math.min(1, value / max);
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}

function renderHome() {
  setNav('home');
  const todays = data.sessions.filter((s) => s.date === today());
  const rec = recommended();
  const played = (n) => data.sessions.some((s) => s.stage === n);
  const goal = goalOf(); const now = goalNow();
  const goalDone = now >= goal.amount;
  const unit = PLAN_UNIT[goal.kind];
  const hour = new Date().getHours();
  const hello = hour < 12 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후예요' : '편안한 저녁이에요';

  // 단계 길: 노드를 좌우로 흔들어 오솔길처럼 놓는다.
  const STEP = 120; const TOP = 56;
  const pts = STAGES.map((s, i) => ({ x: 50 + Math.sin(i * 1.15) * 24, y: TOP + i * STEP }));
  const h = TOP * 2 + (STAGES.length - 1) * STEP;
  const d = pts.map((p, i) => {
    if (!i) return `M${p.x} ${p.y}`;
    const q = pts[i - 1]; const my = (q.y + p.y) / 2;
    return `C${q.x} ${my} ${p.x} ${my} ${p.x} ${p.y}`;
  }).join(' ');
  const readyEnd = pts[Math.max(...STAGES.filter((s) => s.ready).map((s) => s.n)) - 1].y;

  view.innerHTML = `
    <section class="hero">
      <div class="hero-text">
        <p class="eyebrow">${hello}</p>
        <h1>${goalDone ? '오늘 목표를<br>채웠어요' : `오늘 ${goal.amount - now}${unit}만<br>더 들어 봐요`}</h1>
        <div class="chips">
          <span class="chip warm">${ICON.flame}<b>${streak()}일</b> 연속</span>
          <span class="chip">오늘 <b>${todays.reduce((a, s) => a + s.score, 0)}</b>점</span>
        </div>
      </div>
      <div class="hero-ring" aria-label="오늘 목표 ${goal.amount}${unit} 중 ${Math.min(now, goal.amount)}${unit}">
        ${ring(now, goal.amount)}
        <span class="ring-num"><b>${Math.min(now, goal.amount)}</b>/${goal.amount}${goal.kind === 'm' ? '<small>분</small>' : ''}</span>
      </div>
      <button class="btn primary block today-btn" id="today">${ICON.play}<span><b>${goalDone ? '한 판 더 하기' : now ? '오늘의 연습 이어서' : '오늘의 연습 시작'}</b>
        <small>${data.plan ? '선생님 숙제' : `${rec}단계 ${STAGES[rec - 1].name}부터`} · 하루 ${goalText(goal)}</small></span></button>
    </section>
    ${data.plan ? (() => {
      const p = data.plan;
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
          <span class="plan-lab">이번 주 <b>${weekDays(data.sessions)}/${p.days}일</b></span>
          <span class="acc-bar"><i style="width:${Math.min(100, Math.round((100 * weekDays(data.sessions)) / p.days))}%"></i></span>
        </div>
      </div>
      <div class="chips">${p.stages.map((n) => `<span class="chip focus">${n}단계 ${STAGES[n - 1].name}</span>`).join('')}</div>
      ${p.memo ? `<p class="note">“${esc(p.memo)}”</p>` : ''}
      <p class="note">위의 '오늘의 연습'을 누르면 숙제 단계를 차례로 이어서 해요.</p>
    </section>`;
    })() : ''}
    ${checkDue() ? `
    <button class="report-link check-link" data-go="#check">
      <span class="focus-ico">${ICON.ear}</span>
      <span><b>${(data.checks || []).length ? '이달의 듣기 점검' : '첫 듣기 점검'}</b><small>${(data.checks || []).length
        ? `지난 점검(${shortDate(data.checks[data.checks.length - 1].date)})에서 한 달이 지났어요. 같은 20문제로 얼마나 늘었는지 봐요`
        : '같은 20문제를 달마다 풀어 얼마나 늘었는지 봐요. 5분쯤 걸려요'}</small></span>
    </button>` : ''}
    ${weakTop(3).length ? `
    <section class="panel focus-card">
      <div class="focus-head">
        <span class="focus-ico">${ICON.target}</span>
        <div><h2 class="panel-title">맞춤 연습 중인 소리</h2><p class="note">자주 헷갈린 소리예요. 3단계와 5단계에서 이 소리가 든 문제를 더 자주 내요.</p></div>
      </div>
      <div class="chips">${weakTop(3).map(([k]) => `<span class="chip focus">${esc(friendly(k))}</span>`).join('')}</div>
    </section>` : ''}

    <h2 class="section-title">나의 소리길 <span>7단계</span></h2>
    <div class="trail" style="height:${h}px">
      <svg class="trail-line" viewBox="0 0 100 ${h}" preserveAspectRatio="none" aria-hidden="true">
        <path d="${d}" class="trail-todo"/>
        <path d="${d}" class="trail-done" style="clip-path: inset(0 0 ${h - readyEnd}px 0)"/>
      </svg>
      ${STAGES.map((s, i) => {
        const state = !s.ready ? 'locked' : s.n === rec ? 'current' : played(s.n) ? 'done' : 'open';
        const side = pts[i].x > 50 ? 'left' : 'right';
        return `
        <div class="node ${state} label-${side}" style="left:${pts[i].x}%; top:${pts[i].y}px">
          ${state === 'current' ? '<span class="bubble">오늘은 여기</span>' : ''}
          <button class="node-btn" ${s.ready ? `data-go="#play/${s.n}"` : 'disabled'} aria-label="${s.n}단계 ${s.name}${s.ready ? '' : ', 곧 열려요'}">
            ${s.ready ? `<span class="node-n">${s.n}</span>` : ICON.lock}
          </button>
          <div class="node-label">
            <b>${s.name}</b>
            <span>${s.ready ? s.desc : '곧 열려요'}</span>
            ${s.ready ? stars(data.levels[s.n] || 1) : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
    <button class="report-link speak-link" data-go="#speak">
      <span class="focus-ico">${ICON.mic2}</span>
      <span><b>따라 말하기</b><small>들은 말을 소리 내어 따라 하면 발음을 확인해 드려요</small></span>
    </button>
    <section class="panel settings">
      ${data.plan ? `<p class="note">하루 목표는 선생님 숙제(${goalText(goalOf())})를 따라요.</p>` : `
      <p class="field-label">하루 목표</p>
      <div class="seg goal-seg">${GOAL_CHOICES.map((g, i) => `<button type="button" class="seg-btn${g.kind === goal.kind && g.amount === goal.amount ? ' on' : ''}" data-goal="${i}">${goalText(g)}</button>`).join('')}</div>`}
      <label class="switch" for="big">
        <input type="checkbox" id="big" ${data.bigText ? 'checked' : ''}>
        <span class="switch-ui" aria-hidden="true"></span>
        글자 크게 보기
      </label>
    </section>
    <p class="note center">훈련용 앱이며 청력 검사나 진단을 대신하지 않아요.</p>`;
  view.querySelector('#big').onchange = (e) => { data.bigText = e.target.checked; persist(); applyTextSize(); };
  view.querySelector('#today').onclick = startToday;
  view.querySelectorAll('[data-goal]').forEach((b) => { b.onclick = () => { data.goal = GOAL_CHOICES[+b.dataset.goal]; persist(); renderHome(); }; });
}

let openGroup = 0; // 녹음한 뒤 다시 그려도 보던 묶음을 펼쳐 둔다
async function renderVoices() {
  setNav('voices');
  const keys = await voiceDb.keys();
  const have = new Set(keys.filter((k) => k !== CHEER_KEY));
  const cheer = keys.includes(CHEER_KEY);
  const canRec = !!(navigator.mediaDevices && window.MediaRecorder);
  const groups = [
    ['쉬운 단어', [...new Set(WORD_SETS[1].flat())]],
    ['같은 길이 단어', [...new Set(WORD_SETS[2].flat())]],
    ['헷갈리는 단어', [...new Set(WORD_SETS[3].flat())]],
    ['생활 문장', [...new Set(SENTENCE_SETS[1].flat())]],
    ['한 낱말만 다른 문장', [...new Set(SENTENCE_SETS[2].flat())]],
    ['소음 속 문장', NOISE_SENTENCES],
  ];
  const total = ALL_WORDS.length + ALL_SENTENCES.length;
  const pct = Math.round((100 * have.size) / total);
  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow">가족 목소리</p>
      <h1>매일 듣는 목소리로<br>연습해요</h1>
      <p class="lead">가족이 단어와 문장을 읽어 녹음하면 문제를 그 목소리로 들려드려요.</p>
    </header>
    <section class="panel cheer-panel">
      <div class="focus-head">
        <span class="focus-ico">${ICON.heart}</span>
        <div><h2 class="panel-title">응원 한마디</h2>
        <p class="note">하루 목표를 채우면 축하 소리와 함께 들려드려요. “오늘도 잘했어요, 사랑해요!”처럼 5초 안으로 남겨 주세요.</p></div>
      </div>
      <div class="word-row cheer-row ${cheer ? 'has' : ''}" data-w="${CHEER_KEY}">
          <span class="word">응원</span>
          <span class="word-state">${cheer ? `${ICON.check}녹음됨` : '아직 없어요'}</span>
          ${cheer ? `<button class="icon-btn" data-act="play" aria-label="응원 들어 보기">${ICON.speaker}</button>` : ''}
          <button class="icon-btn rec-btn" data-act="rec" ${canRec ? '' : 'disabled'} aria-label="응원 녹음">${ICON.mic}</button>
          ${cheer ? `<button class="icon-btn" data-act="del" aria-label="응원 지우기">${ICON.trash}</button>` : ''}
      </div>
    </section>
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
      <summary class="section-title">${title} <span>${words.filter((w) => have.has(w)).length} / ${words.length}</span></summary>
      <ul class="word-list">
        ${words.map((w) => `
          <li class="word-row ${have.has(w) ? 'has' : ''}" data-w="${esc(w)}">
            <span class="word">${esc(w)}</span>
            <span class="word-state">${have.has(w) ? `${ICON.check}녹음됨` : 'AI 음성'}</span>
            <button class="icon-btn" data-act="play" aria-label="${esc(w)} 들어 보기">${ICON.speaker}</button>
            <button class="icon-btn rec-btn" data-act="rec" ${canRec ? '' : 'disabled'} aria-label="${esc(w)} 녹음">${ICON.mic}</button>
            ${have.has(w) ? `<button class="icon-btn" data-act="del" aria-label="${esc(w)} 녹음 지우기">${ICON.trash}</button>` : ''}
          </li>`).join('')}
      </ul>
      </details>`).join('')}`;
  view.querySelectorAll('details.group').forEach((d) => { d.ontoggle = () => { if (d.open) openGroup = +d.dataset.g; }; });
  view.querySelector('#pref').onchange = (e) => { data.preferFamily = e.target.checked; persist(); };
  view.querySelectorAll('.word-row button').forEach((b) => {
    b.onclick = async () => {
      const w = b.closest('.word-row').dataset.w;
      if (b.dataset.act === 'play') { b.classList.add('busy'); await (w === CHEER_KEY ? playCheer() : playWord(w)); b.classList.remove('busy'); return; }
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
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('sv-SE');
    days.push({ key, d, score: data.sessions.filter((s) => s.date === key).reduce((a, s) => a + s.score, 0) });
  }
  const max = Math.max(100, ...days.map((d) => d.score));
  const top = Math.ceil(max / 50) * 50;
  const weak = Object.entries(data.confusions).filter(([k]) => k !== '단어 길이').sort((a, b) => b[1] - a[1]).slice(0, 5);
  const weakMax = Math.max(1, ...weak.map(([, v]) => v));
  const acc = (n) => {
    const ss = data.sessions.filter((s) => s.stage === n).slice(-5);
    if (!ss.length) return null;
    return Math.round(100 * ss.reduce((a, s) => a + s.correct, 0) / ss.reduce((a, s) => a + s.total, 0));
  };
  const practiceDays = new Set(data.sessions.map((s) => s.date)).size;

  // 막대그래프: 높이 140, 왼쪽 축 28px
  const W = 320; const H = 150; const L = 30; const B = 22; const bw = (W - L) / 14;
  const y = (v) => (H - B) - ((H - B - 8) * v) / top;
  const chart = `
    <svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 14일 점수">
      ${[0, top / 2, top].map((v) => `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}</text>`).join('')}
      ${days.map((d, i) => {
        const x = L + i * bw + bw * 0.18; const w = bw * 0.64; const isToday = i === 13;
        return `<rect x="${x}" y="${y(d.score)}" width="${w}" height="${Math.max(0, (H - B) - y(d.score))}" rx="3" class="${isToday ? 'bar today' : 'bar'}"><title>${d.key} ${d.score}점</title></rect>
          ${i % 2 === 1 || isToday ? `<text x="${x + w / 2}" y="${H - 6}" class="axis${isToday ? ' strong' : ''}" text-anchor="middle">${isToday ? '오늘' : d.d.getDate()}</text>` : ''}`;
      }).join('')}
    </svg>`;

  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow">나의 기록</p>
      <h1>${data.sessions.length ? '꾸준히 듣고 있어요' : '첫 기록을 만들어 봐요'}</h1>
      ${data.demo ? '<span class="chip demo">시연용 예시 기록이에요</span>' : ''}
    </header>
    ${data.sessions.length ? `<button class="report-link" data-go="#report">
      <span class="focus-ico">${ICON.doc}</span>
      <span><b>치료사·보호자용 리포트</b><small>진도와 약한 소리를 한 장으로 보고 인쇄해요</small></span>
    </button>` : ''}
    ${data.sessions.length ? '' : `
    <section class="panel empty">
      <div class="empty-orb" aria-hidden="true">${ICON.chart}</div>
      <h2 class="panel-title">아직 기록이 없어요</h2>
      <p class="lead">한 판을 마치면 점수, 단계별 정답률, 헷갈린 소리가 여기에 쌓여요. 1단계를 하면 높낮이별로 얼마나 작은 소리까지 들리는지도 기록돼요.</p>
      <button class="btn primary block" data-go="#play/1">${ICON.play}1단계부터 시작하기</button>
      <button class="btn ghost block" id="demo">시연용 예시 기록으로 둘러보기</button>
    </section>`}
    <section class="tiles"${data.sessions.length ? '' : ' hidden'}>
      <div class="tile"><b>${streak()}<small>일</small></b><span>연속 연습</span></div>
      <div class="tile"><b>${practiceDays}<small>일</small></b><span>연습한 날</span></div>
      <div class="tile"><b>${data.sessions.length}<small>판</small></b><span>전체 판 수</span></div>
    </section>
    <section class="panel"${data.sessions.length ? '' : ' hidden'}>
      <h2 class="panel-title">최근 14일 점수</h2>
      ${chart}
    </section>
    <section class="panel"${data.sessions.length ? '' : ' hidden'}>
      <h2 class="panel-title">단계별 정답률 <span>최근 5판</span></h2>
      <ul class="acc-list">
        ${STAGES.filter((s) => s.ready).map((s) => {
          const a = acc(s.n);
          return `<li><span class="acc-name"><b>${s.n}</b>${s.name}</span>
            <span class="acc-bar"><i style="width:${a ?? 0}%"></i></span>
            <span class="acc-val">${a == null ? '–' : a + '%'}</span></li>`;
        }).join('')}
      </ul>
    </section>
    <section class="panel"${data.minDb == null ? ' hidden' : ''}>
      <h2 class="panel-title">높낮이별로 들린 가장 작은 소리 <span>1단계</span></h2>
      <ul class="acc-list freq-list">
        ${TONES.map((f) => {
          const db = (data.toneByFreq || {})[f];
          const name = { 500: '낮은 소리', 1000: '중간 소리', 2000: '높은 소리', 4000: '아주 높은 소리' }[f];
          return `<li><span class="acc-name">${name} <small>${f}Hz</small></span>
            <span class="acc-bar"><i style="width:${db == null ? 0 : Math.round((-db / 60) * 100)}%"></i></span>
            <span class="acc-val">${db == null ? '–' : `${db}dB`}</span></li>`;
        }).join('')}
      </ul>
      <p class="note">막대가 길수록 더 작은 소리까지 들은 거예요. 기준 음량보다 몇 dB 작게 들었는지 보여 줘요. 높은 소리 쪽이 짧다면 치료사 선생님께 알려 주세요.</p>
    </section>
    <section class="panel"${data.sessions.length ? '' : ' hidden'}>
      <h2 class="panel-title">자주 헷갈린 소리</h2>
      ${weak.length ? `<ul class="weak-list">${weak.map(([k, v]) => `
          <li><span class="weak-k">${esc(friendly(k))}</span><span class="weak-bar"><i style="width:${(100 * v) / weakMax}%"></i></span><b>${v}회</b></li>`).join('')}</ul>
        <p class="note">단어와 문장 속 낱말에서 틀린 답을 자모 단위로 비교했어요. 이 소리가 든 문제를 더 자주 내요.</p>`
        : '<p class="note">3단계를 하면 어떤 소리를 헷갈리는지 알려 드려요.</p>'}
    </section>
    <section class="panel check-panel">
      <h2 class="panel-title">월간 듣기 점검 <span>같은 20문제</span></h2>
      ${(data.checks || []).length ? (() => {
        const cs = data.checks; const a = cs[0]; const b = cs[cs.length - 1];
        return `${cs.length > 1 ? `<div class="check-compare">
          <div><span>처음</span><b>${a.score}<small>점</small></b><em>${shortDate(a.date)}</em></div>
          <i aria-hidden="true">→</i>
          <div><span>최근</span><b>${b.score}<small>점</small></b><em>${shortDate(b.date)}</em></div>
          <strong class="${b.score > a.score ? 'up' : ''}">${b.score > a.score ? '▲' : b.score < a.score ? '▼' : ''}${Math.abs(b.score - a.score)}점</strong>
        </div>` : `<div class="check-compare one"><div><span>첫 점검</span><b>${b.score}<small>점</small></b><em>${shortDate(b.date)}</em></div></div>`}
        <p class="note">${cs.length > 1 ? `${cs.length}번 점검했어요. ` : '이 점수가 앞으로 견줄 기준이에요. '}${checkDue() ? '한 달이 지나 다시 점검할 때예요.' : `다음 점검은 ${shortDate(new Date(new Date(b.date).getTime() + CHECK_EVERY * 86400000).toLocaleDateString('sv-SE'))}쯤이에요.`}</p>`;
      })() : '<p class="note">아직 점검 기록이 없어요. 첫 점수가 앞으로 견줄 기준이 돼요.</p>'}
      <button class="btn block${checkDue() ? ' primary' : ''}" data-go="#check">${ICON.ear}${(data.checks || []).length ? '지금 점검하기' : '첫 점검 하기'}</button>
    </section>
    <details class="group tips-all">
      <summary class="section-title">생활 듣기 요령 <span>${LISTEN_TIPS.length}장</span></summary>
      <section class="panel">
        <p class="note">한 판을 마칠 때마다 한 장씩 보여 드려요. 듣기 연습과 함께 생활에서 써 보세요.</p>
        <ol class="tip-list">${LISTEN_TIPS.map((t) => `<li><b>${t.t}</b><span>${t.b}</span>${t.say ? `<em>“${t.say}”</em>` : ''}</li>`).join('')}</ol>
      </section>
    </details>
    <button class="report-link" data-go="#clinic">
      <span class="focus-ico">${ICON.target}</span>
      <span><b>선생님용 화면</b><small>숙제를 내고 여러 사람의 기록을 한 줄씩 모아 봐요</small></span>
    </button>
    <div class="actions">
      <button class="btn" id="export">기록 파일 받기</button>
      <button class="btn ghost" id="reset">기록 지우기</button>
    </div>
    ${data.sessions.length ? `<button class="btn ghost block" id="demo">${data.demo ? '예시 기록 끄고 내 기록으로' : '시연용 예시 기록 채우기'}</button>` : ''}`;
  view.querySelector('#demo').onclick = () => {
    if (data.demo) { clearDemo(); toast('예시 기록을 지웠어요.'); } else { loadDemo(); toast('2주 동안 쓴 것처럼 예시 기록을 채웠어요.'); }
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
      data = Object.assign(fresh(), { preferFamily: data.preferFamily, bigText: data.bigText });
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

async function renderSpeak() {
  setNav('home');
  document.body.classList.add('in-play');
  const token = ++playToken;
  const alive = () => token === playToken;
  const canRec = !!(navigator.mediaDevices && window.MediaRecorder);
  const useAsr = !!Recognition;
  let mode = data.speakMode && SPEAK_MODES[data.speakMode] ? data.speakMode : 'word';
  view.innerHTML = `
    <div class="play">
      <div class="play-top">
        <button class="icon-btn" data-go="#home" aria-label="그만하고 나가기">${ICON.close}</button>
        <div class="dots five" aria-hidden="true">${Array.from({ length: SPEAK_N }, () => '<i></i>').join('')}</div>
        <span class="lvl" id="mode-name">${SPEAK_MODES[mode].name}</span>
      </div>
      <p class="eyebrow center">따라 말하기</p>
      <div class="stagebox">
        <div class="orb idle" id="orb">${ICON.mic2}</div>
        <h1 class="q" id="q">들은 말을 따라 말해 보세요</h1>
        <p class="lead center" id="hint">${useAsr ? '말한 것을 음성 인식으로 받아 적어 자모 하나하나까지 비교해 드려요.' : '녹음해서 정답과 내 목소리를 나란히 들어 볼 수 있어요.'}</p>
      </div>
      <div id="answers" class="start-box">
        <div class="seg" role="radiogroup" aria-label="연습할 말">
          ${Object.entries(SPEAK_MODES).map(([k, m]) => `<button class="seg-btn${k === mode ? ' on' : ''}" role="radio" aria-checked="${k === mode}" data-m="${k}">${m.name}</button>`).join('')}
        </div>
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
    let w = pick(pool); let focus = null;
    if (mode === 'pair') { const t = pickTailored(WORD_SETS[3], (x) => x); if (t.focus) { focus = t.focus; w = pick(t.focus.pair); } }
    if (!picks.some((p) => p.w === w)) picks.push({ w, focus });
  }
  const results = []; const conf = {};
  for (let i = 0; i < SPEAK_N && alive(); i++) {
    const dots = view.querySelectorAll('.dots i');
    dots.forEach((d, k) => d.classList.toggle('now', k === i));
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
    dots[i].classList.remove('now'); dots[i].classList.add(score >= 70 ? 'good' : 'bad');
  }
  if (!alive()) return;
  const avg = Math.round(results.reduce((a, r) => a + r.score, 0) / results.length);
  data.speakLog = data.speakLog || []; data.speakConf = data.speakConf || {};
  data.speakLog.push({ date: today(), at: Date.now(), mode, n: results.length, score: avg, asr: useAsr });
  for (const [k, v] of Object.entries(conf)) data.speakConf[k] = (data.speakConf[k] || 0) + v;
  persist();
  view.innerHTML = `
    <div class="play result">
      <p class="eyebrow center">따라 말하기 · ${SPEAK_MODES[mode].name}</p>
      <h1 class="q">${avg >= 85 ? '또렷하게 말씀하셨어요' : avg >= 60 ? '잘하고 있어요' : '소리 내어 말한 것만으로도 좋은 연습이에요'}</h1>
      ${useAsr ? `<div class="score"><b id="score">0</b><span>%</span></div><p class="lead center">음성 인식이 알아들은 정도예요</p>` : ''}
      <section class="panel"><ul class="speak-list">${results.map((r) => `<li><span>${esc(r.w)}</span>${useAsr ? `<b class="${r.score >= 70 ? 'ok' : ''}">${r.score}%</b>` : `<b class="${r.score >= 70 ? 'ok' : ''}">${r.score >= 70 ? '비슷해요' : '다시 연습'}</b>`}</li>`).join('')}</ul>
      ${Object.keys(conf).length ? `<p class="note">다르게 들린 소리: ${Object.keys(conf).map((c) => esc(friendly(c))).join(', ')}</p>` : ''}</section>
      <div class="actions">
        <button class="btn primary" data-go="#speak">한 판 더</button>
        <button class="btn" data-go="#home">소리길로</button>
      </div>
    </div>`;
  if (useAsr) countUp(view.querySelector('#score'), avg);

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

  // 단계별 처음과 최근 정답률(판이 적으면 반씩 나눠 비교)
  const rows = STAGES.filter((s) => s.ready).map((st) => {
    const l = ss.filter((x) => x.stage === st.n);
    const k = Math.min(5, Math.floor(l.length / 2));
    const first = k ? accOf(l.slice(0, k)) : null; const recent = k ? accOf(l.slice(-k)) : accOf(l);
    return { st, n: l.length, first, recent, level: data.levels[st.n] || 1 };
  });
  const weak = weakTop(5).map(([c, n]) => {
    const f = (data.focusLog || {})[c] || { n: 0, ok: 0 };
    const rate = f.n ? Math.round((100 * f.ok) / f.n) : null;
    return { c, n, f, rate, better: f.n >= 3 && rate >= 70 };
  });
  const tone = data.toneByFreq || {};

  // 한눈에 보기: 기록에서 바로 읽히는 사실만 문장으로 만든다
  const lines = [`최근 2주 동안 14일 중 <b>${n14}일</b> 연습했어요${n14 >= 10 ? '. 아주 꾸준해요' : n14 >= 5 ? '' : '. 하루 한 판부터 다시 시작해 보세요'}.`];
  const up = rows.filter((r) => r.first != null && r.n >= 4 && r.recent - r.first >= 10).sort((a, b) => (b.recent - b.first) - (a.recent - a.first))[0];
  if (up) lines.push(`${up.st.n}단계 ${up.st.name} 정답률이 <b>${up.first}%에서 ${up.recent}%로</b> 올랐어요.`);
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
  const noise = rows.find((r) => r.st.n === 6);
  if (noise && noise.n) lines.push(`소음 속 듣기는 <b>레벨 ${noise.level}</b>에서 연습하고 있어요(최근 정답률 ${noise.recent}%).`);

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
          <p class="note">기간 ${ss[0].date} ~ ${today()} · 만든 날 ${today()}${data.demo ? ' · 시연용 예시 기록' : ''}</p>
        </div>
        <span class="report-logo" aria-hidden="true">${ICON.path}</span>
      </header>
      <label class="field no-print">이름 <input id="rname" value="${esc(data.reportName || '')}" placeholder="이름을 적으면 리포트에 나와요" autocomplete="off"></label>

      <section class="kpis">
        <div class="tile"><b>${n14}<small>/14일</small></b><span>최근 2주 연습</span></div>
        <div class="tile"><b>${ss.length}<small>판</small></b><span>전체 판 수</span></div>
        <div class="tile"><b class="small-num">${fmtMin(totalSec)}</b><span>전체 연습 시간</span></div>
        <div class="tile"><b>${streak()}<small>일</small></b><span>연속 연습</span></div>
      </section>
      <div class="att" aria-label="최근 14일 연습한 날">${days.map((d) => `<i class="${practiced.has(d.key) ? 'on' : ''}" title="${d.key}${practiced.has(d.key) ? ' 연습함' : ''}"></i>`).join('')}</div>

      <section class="panel p-sum">
        <h2 class="panel-title">한눈에 보기</h2>
        <ul class="summary">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
      </section>

      <section class="panel p-chart">
        <h2 class="panel-title">하루 정답률 <span>최근 14일, 모든 단계</span></h2>
        ${chart}
      </section>

      <section class="panel p-stages">
        <h2 class="panel-title">단계별 변화</h2>
        <table class="rtable">
          <thead><tr><th>단계</th><th>레벨</th><th>판 수</th><th>처음</th><th>최근</th><th>변화</th></tr></thead>
          <tbody>${rows.map((r) => {
            const diff = r.first != null && r.recent != null ? r.recent - r.first : null;
            return `<tr><th scope="row"><b class="n">${r.st.n}</b>${r.st.name}</th><td>${r.n ? r.level : '–'}</td><td>${r.n}</td>
              <td>${r.first == null ? '–' : r.first + '%'}</td><td>${r.recent == null ? '–' : r.recent + '%'}</td>
              <td class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff == null ? '–' : `${diff > 0 ? '▲' : diff < 0 ? '▼' : ''}${Math.abs(diff)}`}</td></tr>`;
          }).join('')}</tbody>
        </table>
        <p class="note">처음과 최근은 각각 앞뒤 최대 5판의 정답률이에요. 레벨이 오르면 문제가 어려워져 정답률이 잠시 내려갈 수 있어요.</p>
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
        <h2 class="panel-title">높낮이별로 들린 가장 작은 소리 <span>1단계</span></h2>
        <ul class="acc-list freq-list">${TONES.map((f) => `<li><span class="acc-name">${FREQ_NAME[f]} <small>${f}Hz</small></span>
          <span class="acc-bar"><i style="width:${tone[f] == null ? 0 : Math.round((-tone[f] / 60) * 100)}%"></i></span>
          <span class="acc-val">${tone[f] == null ? '–' : `${tone[f]}dB`}</span></li>`).join('')}</ul>
        <p class="note">기기 음량 기준으로 몇 dB 작게까지 들었는지예요. 기기마다 달라서 청력 검사 결과와 같지 않아요.</p>
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
const planLink = (p) => `${location.href.split('#')[0]}#plan/${b64u.enc(JSON.stringify({ v: 1, by: p.by, st: p.stages, k: p.kind, a: p.amount, d: p.days, m: p.memo }))}`;

// 링크로 받은 값은 남이 고칠 수 있으니 범위를 다시 확인한다.
function planUnpack(code) {
  try {
    const j = JSON.parse(b64u.dec(code));
    const stages = (Array.isArray(j.st) ? j.st : []).map(Number).filter((n) => STAGES.some((s) => s.n === n && s.ready));
    if (!stages.length) return null;
    const kind = j.k === 'r' ? 'r' : 'm';
    const num = (v, d, max) => Math.min(max, Math.max(1, Math.round(Number(v) || d)));
    return {
      by: String(j.by || '').slice(0, 20), stages, kind,
      amount: num(j.a, kind === 'm' ? 10 : 3, kind === 'm' ? 120 : 20),
      days: num(j.d, 5, 7), memo: String(j.m || '').slice(0, 200), at: Date.now(),
    };
  } catch { return null; }
}

const weekStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toLocaleDateString('sv-SE'); }; // 월요일부터
const weekDays = (ss) => { const w = weekStart(); return new Set(ss.filter((s) => s.date >= w).map((s) => s.date)).size; };
const todayDone = (d) => {
  const t = (d.sessions || []).filter((s) => s.date === today());
  return { rounds: t.length, min: Math.round(t.reduce((a, s) => a + (s.sec || 180), 0) / 60) };
};
// 숙제에 든 단계 중 오늘 아직 안 한 것부터
const planNext = (d) => {
  const done = new Set((d.sessions || []).filter((s) => s.date === today()).map((s) => s.stage));
  return d.plan.stages.find((n) => !done.has(n)) || d.plan.stages[0];
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
          <p class="note">숙제에 든 단계예요. 받으면 집 화면에 이번 주 진도가 같이 나와요.</p>
        </div>
      </div>
      <div class="chips">${p.stages.map((n) => `<span class="chip focus">${n}단계 ${STAGES[n - 1].name}</span>`).join('')}</div>
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
function patientRow(d, name) {
  const ss = Array.isArray(d.sessions) ? d.sessions : [];
  const accStage = (n) => { const l = ss.filter((s) => s.stage === n).slice(-5); return l.length ? accOf(l) : null; };
  const checks = Array.isArray(d.checks) ? d.checks : [];
  return {
    name: name || '이름 없음',
    last: ss.length ? ss[ss.length - 1].date : null,
    week: weekDays(ss), planDays: d.plan?.days || null, rounds: ss.length,
    acc: { 3: accStage(3), 5: accStage(5), 6: accStage(6) },
    weak: Object.entries(d.confusions || {}).filter(([k]) => k !== '단어 길이').sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => friendly(k)),
    check: checks.length ? { first: checks[0].score, last: checks[checks.length - 1].score, n: checks.length } : null,
  };
}

let clinicRows = null; // 불러온 환자 요약(예시를 지우면 빈 배열)
function renderClinic() {
  setNav('progress');
  if (!clinicRows) clinicRows = demoPatients().map((d) => Object.assign(patientRow(d, d.reportName), { demo: true }));
  const form = Object.assign({ by: '', stages: [3, 5], kind: 'm', amount: 10, days: 5, memo: '' }, clinicForm);
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
      <p class="field-label">연습할 단계</p>
      <div class="seg stage-pick">${STAGES.filter((s) => s.ready).map((s) => `
        <button type="button" data-stage="${s.n}" class="${form.stages.includes(s.n) ? 'on' : ''}" aria-pressed="${form.stages.includes(s.n)}">${s.n}단계 ${s.name}</button>`).join('')}</div>
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
          <thead><tr><th>이름</th><th>마지막</th><th>이번 주</th><th>3단계</th><th>5단계</th><th>6단계</th><th>약한 소리</th><th>월 점검</th></tr></thead>
          <tbody>${clinicRows.length ? clinicRows.map((r) => `
            <tr><th scope="row">${esc(r.name)}${r.demo ? '<span class="chip demo sm">예시</span>' : ''}</th>
              <td>${dayName(r.last)}</td>
              <td class="${r.planDays && r.week >= r.planDays ? 'up' : ''}">${r.week}${r.planDays ? `/${r.planDays}일` : '일'}</td>
              ${[3, 5, 6].map((n) => `<td>${r.acc[n] == null ? '–' : `${r.acc[n]}%`}</td>`).join('')}
              <td class="weak-cell">${r.weak.length ? r.weak.map((w) => esc(w)).join(', ') : '–'}</td>
              <td class="${r.check && r.check.last > r.check.first ? 'up' : r.check && r.check.last < r.check.first ? 'down' : ''}">${r.check ? (r.check.n > 1 ? `${r.check.first}→${r.check.last}` : `${r.check.last}`) : '–'}</td></tr>`).join('')
            : '<tr><td colspan="8" class="center note">목록이 비어 있어요. 기록 파일을 열어 주세요.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="note">단계별 숫자는 최근 5판 정답률이에요. '이번 주'는 이번 주(월요일부터) 연습한 날수이고, 숙제가 있으면 계획 일수와 함께 보여 줘요.</p>
    </section>
    <button class="btn ghost block" data-go="#progress">기록으로 돌아가기</button>`;

  const $ = (q) => view.querySelector(q);
  const out = $('#out');
  const paint = () => {
    clinicForm = form;
    if (!form.stages.length) { out.innerHTML = '<p class="note">단계를 하나 이상 골라 주세요.</p>'; return; }
    const link = planLink({ by: form.by.trim(), stages: form.stages, kind: form.kind, amount: form.amount, days: form.days, memo: form.memo.trim() });
    let qr = '';
    try { qr = QR.svg(link); } catch { qr = '<p class="note">전할 말이 너무 길어 QR을 만들지 못했어요. 조금 줄여 주세요.</p>'; }
    out.innerHTML = `
      <div class="plan-out">
        <div class="qr-box">${qr}</div>
        <div class="plan-sum">
          <p><b>하루 ${form.amount}${PLAN_UNIT[form.kind]}</b> · 주 ${form.days}일 · ${form.stages.map((n) => `${n}단계`).join(', ')}</p>
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
  view.querySelectorAll('[data-stage]').forEach((b) => {
    b.onclick = () => {
      const n = +b.dataset.stage;
      form.stages = form.stages.includes(n) ? form.stages.filter((x) => x !== n) : [...form.stages, n].sort((a, c) => a - c);
      b.classList.toggle('on'); b.setAttribute('aria-pressed', form.stages.includes(n));
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
        if (!Array.isArray(d.sessions)) throw new Error('기록이 아니에요');
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
        <button class="icon-btn" data-go="#home" aria-label="그만하고 나가기">${ICON.close}</button>
        <div class="check-bar" aria-hidden="true"><i id="bar"></i></div>
        <span class="lvl" id="count">20문제</span>
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
    $('#count').textContent = `${i + 1}/${CHECK_ITEMS.length}`;
    $('#part').textContent = `이달의 듣기 점검 · ${CHECK_KIND[it.kind]}`;
    $('#q').textContent = sc ? `${sc.name}에서 들린 말은?` : it.kind === 'word' ? '어떤 단어를 들었나요?' : '어떤 문장을 들었나요?';
    $('#hint').innerHTML = (sc ? `<span class="chip scene">${sc.icon} ${sc.name} · 주변 소리 보통</span>` : '') + `<button class="pill" id="replay">${ICON.speaker}한 번 더 듣기</button>`;
    $('#answers').className = '';
    $('#answers').innerHTML = '';
    const listen = () => (sc ? withNoise(it.scene, 2, () => playWord(it.answer)) : playWord(it.answer)); // 소음은 늘 '보통'
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
        <button class="btn" data-go="#home">소리길로</button>
      </div>
    </div>`;
  countUp(view.querySelector('#score'), score);
  view.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => playWord(CHECK_ITEMS[+b.dataset.say].answer); });
}

/* ---------- 시연용 예시 기록 ---------- */

const BACKUP_KEY = 'sorigil.v1.backup';
// 2주 동안 꾸준히 쓴 사람처럼 기록을 만든다. 날마다 정답률이 조금씩 오른다.
// opts로 사람마다 다르게 만들어 선생님 화면의 예시 환자로도 쓴다.
function demoData(opts = {}) {
  const { seed0 = 7, name = '김소리', boost = 0, rest = [9, 4], plan = null } = opts;
  let seed = seed0;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const shift = (a, b) => [Math.max(0.2, a + boost), Math.max(0.3, Math.min(1, b + boost))];
  const ACC = { 1: shift(0.6, 0.9), 2: shift(0.6, 0.95), 3: shift(0.45, 0.82), 5: shift(0.5, 0.8), 6: shift(0.4, 0.72) };
  const d = Object.assign(fresh(), { preferFamily: data.preferFamily, bigText: data.bigText, demo: true, reportName: name, plan });
  const lv = d.levels;
  for (let i = 13; i >= 0; i--) {
    if (rest.includes(i)) continue; // 쉰 날
    const k = 13 - i; const p = k / 13;
    const pool = k < 3 ? [1, 2, 3] : k < 6 ? [2, 3, 5] : [3, 5, 6];
    const count = i === 0 ? 2 : 2 + Math.floor(rnd() * 3);
    const day = new Date(); day.setDate(day.getDate() - i); day.setHours(9 + Math.floor(rnd() * 9), Math.floor(rnd() * 60), 0, 0);
    for (let j = 0; j < count; j++) {
      const stage = pool[j % pool.length];
      const [a0, a1] = ACC[stage];
      const acc = Math.max(0.2, Math.min(1, a0 + (a1 - a0) * p + (rnd() - 0.5) * 0.2 - (lv[stage] - 1) * 0.05));
      const correct = Math.round(acc * 10);
      const level = lv[stage];
      if (acc >= 0.8 && lv[stage] < 3) lv[stage]++; else if (acc < 0.5 && lv[stage] > 1) lv[stage]--;
      d.sessions.push({ date: day.toLocaleDateString('sv-SE'), stage, level, score: correct * 10 + (correct >= 7 ? (correct - 3) * 2 : 0), correct, total: TRIALS, at: day.getTime() + j * 360000, sec: 140 + Math.floor(rnd() * 120) });
    }
  }
  // 나이 들며 생기는 난청처럼 높은 소리일수록 덜 들리는 모양
  d.toneByFreq = { 500: -50, 1000: -45, 2000: -35, 4000: -20 }; d.minDb = -50;
  d.confusions = { '초성 ㅅ↔ㅆ': 9, '초성 ㄱ↔ㅋ': 6, '초성 ㄷ↔ㄸ': 5, '종성 ㄴ↔ㅁ': 4, '중성 ㅓ↔ㅗ': 3 };
  d.focusLog = { '초성 ㅅ↔ㅆ': { n: 8, ok: 4 }, '초성 ㄱ↔ㅋ': { n: 6, ok: 5 }, '초성 ㄷ↔ㄸ': { n: 4, ok: 2 }, '종성 ㄴ↔ㅁ': { n: 3, ok: 3 } };
  d.speakLog = [62, 68, 71, 75, 80, 84].map((score, i) => { const t = new Date(); t.setDate(t.getDate() - 10 + i * 2); return { date: t.toLocaleDateString('sv-SE'), at: t.getTime(), mode: i < 3 ? 'word' : 'pair', n: SPEAK_N, score, asr: true }; });
  d.speakConf = { '초성 ㅅ↔ㅆ': 4, '종성 ㄹ↔없음': 2 };
  // 한 달 간격 점검 세 번. 점수가 조금씩 오른다.
  d.checks = [58, 29, 1].map((ago, k) => {
    const t = new Date(); t.setDate(t.getDate() - ago);
    const w = Math.max(2, Math.min(8, Math.round(4 + k + boost * 10 + rnd())));
    const s2 = Math.max(1, Math.min(6, Math.round(3 + k + boost * 8)));
    const n = Math.max(0, Math.min(6, Math.round(2 + k * 1.2 + boost * 8 + rnd())));
    return { date: t.toLocaleDateString('sv-SE'), at: t.getTime(), score: Math.round((100 * (w + s2 + n)) / 20), parts: { word: [w, 8], sent: [s2, 6], noise: [n, 6] }, miss: [] };
  });
  return d;
}
// 선생님 화면에서 보여 줄 예시 환자들
function demoPatients() {
  const mk = (stages, kind, amount, days) => ({ by: '김민정', stages, kind, amount, days, memo: '', at: Date.now() });
  return [
    demoData({ seed0: 7, name: '김소리', plan: mk([3, 5], 'm', 10, 5) }),
    demoData({ seed0: 23, name: '이바다', boost: -0.12, rest: [12, 9, 7, 4, 2], plan: mk([2, 3], 'r', 3, 3) }),
    demoData({ seed0: 101, name: '박하늘', boost: 0.08, rest: [11], plan: mk([3, 5, 6], 'm', 15, 6) }),
    demoData({ seed0: 55, name: '최도윤', boost: -0.05, rest: [13, 12, 10, 6, 3] }),
  ];
}

function loadDemo() {
  if (!data.demo && data.sessions.length) try { localStorage.setItem(BACKUP_KEY, JSON.stringify(data)); } catch {} // 내 기록은 따로 보관한다
  data = demoData(); persist();
}
function clearDemo() {
  let back = null;
  try { back = JSON.parse(localStorage.getItem(BACKUP_KEY)); localStorage.removeItem(BACKUP_KEY); } catch {}
  data = Object.assign(fresh(), back || { preferFamily: data.preferFamily, bigText: data.bigText });
  persist();
}

/* ---------- 훈련 ---------- */

let playToken = 0; // 다른 화면으로 가면 진행 중인 판을 멈춘다

async function renderPlay(stage) {
  setNav('play');
  const token = ++playToken;
  const alive = () => token === playToken;
  const level = data.levels[stage] || 1;
  const st = STAGES[stage - 1];
  const inRun = !!todayRun && todayRun.queue[todayRun.i] === stage;
  const results = [];
  let toneDb = -10 * level; // 1단계 시작 음량: 레벨이 오를수록 작은 소리에서 시작한다
  let quietest = null;
  const freqBest = {}; // 이번 판 주파수별로 들린 가장 작은 소리
  const sessionConf = {};
  const intro = {
    1: ['소리가 들리면 알려 주세요', '삐 소리가 날 수도, 안 날 수도 있어요. 조용한 곳에서 해 주세요.'],
    2: ['무슨 소리인지 맞혀 보세요', '생활 속 소리를 들려드려요. 몇 번이든 다시 들을 수 있어요.'],
    3: ['들은 단어를 골라 주세요', '레벨이 오를수록 비슷한 소리가 나와요.'],
    5: ['들은 문장을 골라 주세요', '생활 속 문장을 들려드려요. 레벨 3에서는 문장 속 낱말 하나를 맞혀요.'],
    6: ['시끄러운 곳에서 들어 보세요', '식당, 카페, 버스, 병원 소리 속에서 말을 알아들어요. 레벨이 오를수록 주변 소리가 커져요.'],
  }[stage];

  view.innerHTML = `
    <div class="play">
      <div class="play-top">
        <button class="icon-btn" data-go="#home" aria-label="그만하고 나가기">${ICON.close}</button>
        <div class="dots" aria-hidden="true">${Array.from({ length: TRIALS }, () => '<i></i>').join('')}</div>
        <span class="lvl">레벨 ${level}</span>
      </div>
      <p class="eyebrow center">${stage}단계 · ${st.name}</p>
      <div class="stagebox">
        <div class="orb idle" id="orb">${stage === 1 ? ICON.ear : ICON.speaker}</div>
        <h1 class="q" id="q">${intro[0]}</h1>
        <p class="lead center" id="hint">${intro[1]}</p>
      </div>
      <div id="answers" class="start-box">
        ${inRun ? `<p class="run-tag center">오늘의 연습 · <b id="count">3</b>초 뒤 시작해요</p>` : ''}
        <button class="btn block" id="soundcheck">${ICON.speaker}소리 확인하기</button>
        <button class="btn primary block" id="start">${inRun ? '바로 시작' : '시작하기'}</button>
        <p class="note center">초인종 소리와 "안녕하세요"가 들리면 준비 끝이에요. 안 들리면 휴대폰 음량과 무음 모드를 확인해 주세요.</p>
        ${stage >= 3 && !canSpeak() ? '<p class="note warn center" id="nospeech">이 화면에서는 AI 음성이 나오지 않아요. 크롬이나 삼성 인터넷 같은 브라우저에서 열어 주세요. 가족 목소리로 녹음한 단어는 여기서도 들려요.</p>' : ''}
      </div>
    </div>
    <div class="sheet" id="sheet" hidden>
      <div class="sheet-msg"><span class="sheet-icon"></span><div><b id="sheet-title"></b><p id="sheet-text"></p></div></div>
      <div class="compare" id="compare" hidden></div>
      <button class="btn block" id="next">다음</button>
    </div>`;
  const $ = (s) => view.querySelector(s);
  let countdown = null;
  const stopCount = () => { clearInterval(countdown); countdown = null; $('.run-tag').textContent = '오늘의 연습 · 준비되면 시작을 눌러 주세요'; $('#start').textContent = '시작하기'; };
  $('#soundcheck').onclick = () => { if (countdown) stopCount(); unlockAudio(); playEnv('doorbell'); setTimeout(() => playWord('안녕하세요'), 1400); };
  await new Promise((r) => {
    $('#start').onclick = () => { clearInterval(countdown); unlockAudio(); r(); };
    if (!inRun) return;
    // 오늘의 연습에서는 앞 화면의 터치로 소리가 이미 풀려 있어서 시작을 따로 누르지 않아도 된다.
    let left = 3;
    countdown = setInterval(() => {
      if (!alive()) { clearInterval(countdown); return; }
      left -= 1;
      if (left > 0) { $('#count').textContent = left; return; }
      clearInterval(countdown); r();
    }, 1000);
  });
  if (!alive()) return;
  const startedAt = Date.now();

  const orb = $('#orb');
  const setOrb = (mode, icon) => { orb.className = `orb ${mode}`; if (icon) orb.innerHTML = icon; };
  let busy = false; // 소리가 나는 동안에는 다시 듣기를 막아 소리가 겹치지 않게 한다
  const playing = async (p) => { busy = true; setOrb('playing'); try { return await p; } finally { busy = false; if (alive()) setOrb('idle'); } };
  const replay = (fn) => () => { if (!busy) playing(fn()); };
  const setQ = (q, hint = '') => { $('#q').textContent = q; $('#hint').innerHTML = hint; };

  for (let i = 0; i < TRIALS && alive(); i++) {
    const dots = view.querySelectorAll('.dots i');
    dots.forEach((d, k) => d.classList.toggle('now', k === i));
    let ok;
    if (stage === 1) ok = await toneTrial();
    else if (stage === 2) ok = await envTrial();
    else if (stage === 3) ok = await wordTrial();
    else if (stage === 5) ok = await sentenceTrial();
    else ok = await noiseTrial();
    if (!alive()) return;
    results.push(ok);
    dots[i].classList.remove('now'); dots[i].classList.add(ok ? 'good' : 'bad');
    await nextTap(i === TRIALS - 1);
  }
  if (!alive()) return;

  const correct = results.filter(Boolean).length;
  let bestRun = 0; let run = 0;
  for (const r of results) { run = r ? run + 1 : 0; bestRun = Math.max(bestRun, run); }
  const bonus = bestRun >= 3 ? bestRun * 2 : 0; // 연속 정답 보너스
  const score = correct * 10 + bonus;
  const acc = correct / TRIALS;
  const next = adjustLevel(stage, acc);
  if (stage === 1 && quietest != null) data.minDb = data.minDb == null ? quietest : Math.min(data.minDb, quietest);
  data.toneByFreq = data.toneByFreq || {};
  for (const [f, db] of Object.entries(freqBest)) data.toneByFreq[f] = Math.min(data.toneByFreq[f] ?? 0, db);
  for (const [k, v] of Object.entries(sessionConf)) data.confusions[k] = (data.confusions[k] || 0) + v;
  const goal = goalOf(); const before = goalNow();
  data.sessions.push({ date: today(), stage, level, score, correct, total: TRIALS, at: Date.now(), sec: Math.round((Date.now() - startedAt) / 1000) });
  const tipNo = (data.tip || 0) % LISTEN_TIPS.length; const tip = LISTEN_TIPS[tipNo];
  data.tip = tipNo + 1;
  persist();
  const after = goalNow();
  const justMet = before < goal.amount && after >= goal.amount;
  const runNext = inRun && !justMet ? todayRun.queue[(todayRun.i + 1) % todayRun.queue.length] : null;
  if (!runNext) todayRun = null;
  const hasCheer = justMet && !!(await voiceDb.get(CHEER_KEY).catch(() => null));
  if (!alive()) return;
  const goalPct = (v) => Math.min(100, Math.round((100 * v) / goal.amount));

  const medal = acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : acc >= 0.4 ? 1 : 0;
  const weak = Object.entries(sessionConf).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const headline = ['오늘도 들어 본 것만으로 충분해요', '좋아요, 감이 오고 있어요', '잘 들으셨어요', '훌륭해요!'][medal];
  view.innerHTML = `
    <div class="play result">
      ${justMet ? `<div class="confetti" aria-hidden="true">${Array.from({ length: 28 }, (_, k) => `<i style="--x:${(k * 37) % 100}%;--d:${(k % 7) * 90}ms;--r:${(k * 53) % 360}deg"></i>`).join('')}</div>` : ''}
      <p class="eyebrow center">${stage}단계 · ${st.name}</p>
      <div class="medal">${[1, 2, 3].map((k) => `<i class="${k <= medal ? 'on' : ''}" style="--d:${k * 120}ms"></i>`).join('')}</div>
      <h1 class="q">${headline}</h1>
      <div class="score"><b id="score">0</b><span>점</span></div>
      <div class="result-chips">
        <span class="chip">${TRIALS}문제 중 <b>${correct}</b>개 정답</span>
        ${bonus ? `<span class="chip warm">${bestRun}연속 정답 +${bonus}</span>` : ''}
        ${stage === 1 && quietest != null ? `<span class="chip">기준보다 <b>${-quietest}dB</b> 작게 들음</span>` : ''}
      </div>
      <p class="lead center">${next > level ? `다음 판은 <b>레벨 ${next}</b>로 올라가요.` : next < level ? `다음 판은 레벨 ${next}에서 다시 익혀요.` : `다음 판도 레벨 ${next}로 연습해요.`}</p>
      ${justMet ? `
      <section class="panel goal-met">
        <span class="focus-ico">${ICON.heart}</span>
        <div>
          <h2 class="panel-title">오늘 목표 ${goalText(goal)}을 채웠어요!</h2>
          <p class="note">${hasCheer ? '가족이 남긴 응원을 들려드려요.' : '가족 목소리 화면에서 응원 한마디를 녹음해 두면 목표를 채울 때 같이 들려드려요.'}</p>
        </div>
        ${hasCheer ? `<button class="icon-btn" id="cheer-again" aria-label="응원 다시 듣기">${ICON.speaker}</button>` : ''}
      </section>` : `
      <div class="goal-bar">
        <span>오늘 목표 <b>${Math.min(after, goal.amount)}/${goalText(goal)}</b>${after >= goal.amount ? ' · 채웠어요' : ''}</span>
        <span class="acc-bar"><i style="width:${goalPct(before)}%" data-to="${goalPct(after)}"></i></span>
      </div>`}
      ${weak.length ? `<section class="panel"><h2 class="panel-title">이번에 헷갈린 소리</h2>
        <ul class="weak-list">${weak.map(([k, v]) => `<li><span class="weak-k">${esc(friendly(k))}</span><span class="weak-bar"><i style="width:${(100 * v) / weak[0][1]}%"></i></span><b>${v}회</b></li>`).join('')}</ul>
        <p class="note">다음 판부터 이 소리가 든 문제를 더 자주 내 드릴게요.</p></section>` : ''}
      <div class="actions">
        ${runNext ? `
        <button class="btn primary run-next" id="run-next">이어서 ${runNext === stage ? '한 판 더' : `${runNext}단계 ${STAGES[runNext - 1].name}`}</button>
        <button class="btn" data-go="#home">오늘은 그만</button>` : justMet ? `
        <button class="btn primary" data-go="#home">소리길로</button>
        <button class="btn" data-go="#play/${stage}">한 판 더</button>` : `
        <button class="btn primary" data-go="#play/${stage}">한 판 더</button>
        <button class="btn" data-go="#home">소리길로</button>`}
      </div>
      <section class="panel tip-card">
        <div class="focus-head">
          <span class="focus-ico">${ICON.bulb}</span>
          <div>
            <p class="eyebrow">생활 듣기 요령 ${tipNo + 1}/${LISTEN_TIPS.length}</p>
            <h2 class="panel-title">${tip.t}</h2>
          </div>
        </div>
        <p class="tip-body">${tip.b}</p>
        ${tip.say ? `<p class="tip-say">“${tip.say}”</p>` : ''}
      </section>
    </div>`;
  countUp(view.querySelector('#score'), score);
  const bar = view.querySelector('.goal-bar i');
  if (bar) requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = `${bar.dataset.to}%`; }));
  if (runNext) $('#run-next').onclick = () => { unlockAudio(); todayRun.i = (todayRun.i + 1) % todayRun.queue.length; go(`#play/${runNext}`); };
  if (justMet) {
    playCheer();
    const again = view.querySelector('#cheer-again');
    if (again) again.onclick = () => playCheer();
  }

  // 1단계: 순음 감지. 들리면 5dB 작게, 놓치면 5dB 크게.
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
    }
    else if (present && !heard) toneDb = Math.min(0, toneDb + 5);
    feedback(ok, ok ? (present ? '정확해요' : '맞아요') : '아쉬워요',
      ok ? (present ? '다음은 조금 더 작게 들려드릴게요.' : '이번엔 소리가 없었어요.') : (present ? `${freq}Hz 소리가 있었어요. 조금 크게 다시 해 봐요.` : '이번엔 소리가 없었어요.'));
    return ok;
  }

  // 2단계: 환경음 고르기
  async function envTrial() {
    const ids = shuffle(Object.keys(ENV_SOUNDS)).slice(0, ENV_POOLS[level]);
    const target = pick(ids);
    $('#answers').innerHTML = '';
    setQ('무슨 소리일까요?', replayBtn());
    $('#replay').onclick = replay(() => playEnv(target));
    await playing(playEnv(target));
    if (!alive()) return false;
    const ans = await ask(ids.map((id) => [ENV_SOUNDS[id].name, ENV_SOUNDS[id].icon]), ids.indexOf(target), ids.length === 2 ? 'two' : '');
    const ok = ids[ans] === target;
    feedback(ok, ok ? '정답이에요' : '아쉬워요', ok ? `${ENV_SOUNDS[target].name} 소리였어요.` : `정답은 ${ENV_SOUNDS[target].name}이에요. 두 소리를 비교해 들어 보세요.`,
      ok ? null : [[`정답: ${ENV_SOUNDS[target].name}`, () => playEnv(target)], [`고른 것: ${ENV_SOUNDS[ids[ans]].name}`, () => playEnv(ids[ans])]]);
    if (!ok) await replayAnswer(() => playEnv(target));
    return ok;
  }

  // 3단계: 단어 고르기
  async function wordTrial() {
    const { item, focus } = pickTailored(WORD_SETS[level], (w) => w);
    const set = shuffle(item);
    const target = focus ? pick(focus.pair) : pick(set);
    $('#answers').innerHTML = '';
    setQ('어떤 단어를 들었나요?', focusTag(focus) + replayBtn() + '<span class="src" id="src"></span>');
    $('#replay').onclick = replay(() => playWord(target));
    const src = await playing(playWord(target));
    if (!alive()) return false;
    const label = { family: '가족 목소리', pack: 'AI 음성', tts: 'AI 음성', 'tts-nokorean': '이 기기에는 한국어 음성이 없어 발음이 어색할 수 있어요', none: '이 화면에서는 AI 음성이 나오지 않아요' }[src];
    const srcEl = $('#src'); if (srcEl) srcEl.textContent = label;
    const ans = await ask(set.map((w) => [w]), set.indexOf(target), 'words');
    const ok = set[ans] === target;
    logFocus(focus, ok);
    if (!ok) for (const c of contrasts(target, set[ans])) if (c !== '단어 길이') sessionConf[c] = (sessionConf[c] || 0) + 1; // 길이 차이는 소리 혼동이 아니다
    const why = ok ? '' : contrasts(target, set[ans]).filter((c) => c !== '단어 길이').map(friendly).join(', ');
    feedback(ok, ok ? '정답이에요' : '아쉬워요', ok ? `"${esc(target)}"였어요.` : `정답은 "${esc(target)}"예요.${why ? ` <span class="why">${esc(why)}</span>` : ''}`,
      ok ? null : [[`정답: ${target}`, () => playWord(target)], [`고른 것: ${set[ans]}`, () => playWord(set[ans])]]);
    if (!ok) await replayAnswer(() => playWord(target)); // 틀리면 정답을 한 번 더 들려준다
    return ok;
  }

  // 5단계: 문장 고르기. 레벨 3은 문장 속 낱말을 고르게 해 취약음 분석에 넣는다.
  async function sentenceTrial() {
    const keyword = level >= 3;
    let say; let opts; let target; let frame;
    let focus = null;
    if (keyword) {
      const t = pickTailored(SENTENCE_SETS[3], (it) => it.words);
      focus = t.focus;
      frame = t.item.frame; opts = shuffle(t.item.words); target = focus ? pick(focus.pair) : pick(opts); say = fillFrame(frame, target);
    } else {
      opts = shuffle(pick(SENTENCE_SETS[level])); target = pick(opts); say = target;
    }
    $('#answers').innerHTML = '';
    setQ(keyword ? '문장에서 어떤 낱말이 들렸나요?' : '어떤 문장을 들었나요?', focusTag(focus) + replayBtn() + '<span class="src" id="src"></span>');
    $('#replay').onclick = replay(() => playWord(say));
    const src = await playing(playWord(say));
    if (!alive()) return false;
    const srcEl = $('#src'); if (srcEl) srcEl.textContent = { family: '가족 목소리', pack: 'AI 음성', tts: 'AI 음성', none: '이 화면에서는 AI 음성이 나오지 않아요' }[src] || '';
    const ans = await ask(opts.map((w) => [w]), opts.indexOf(target), keyword ? 'words' : 'sentences');
    const ok = opts[ans] === target;
    logFocus(focus, ok);
    if (!ok && keyword) for (const c of contrasts(target, opts[ans])) sessionConf[c] = (sessionConf[c] || 0) + 1;
    const why = !ok && keyword ? contrasts(target, opts[ans]).map(friendly).join(', ') : '';
    const chosenSay = keyword ? fillFrame(frame, opts[ans]) : opts[ans];
    feedback(ok, ok ? '정답이에요' : '아쉬워요', ok ? `"${esc(say)}"` : `들린 문장은 "${esc(say)}"예요.${why ? ` <span class="why">${esc(why)}</span>` : ''}`,
      ok ? null : [['정답 문장', () => playWord(say)], ['고른 문장', () => playWord(chosenSay)]]);
    if (!ok) await replayAnswer(() => playWord(say));
    return ok;
  }

  // 6단계: 장소 소음 속 문장 고르기. 틀리면 소음 없이 정답을 들려준다.
  async function noiseTrial() {
    const id = pick(Object.keys(NOISE_SCENES)); const sc = NOISE_SCENES[id];
    const pool = level === 1 ? sc.easy : level === 2 ? [...sc.easy, ...sc.hard] : sc.hard;
    const opts = shuffle(pick(pool)); const target = pick(opts);
    $('#answers').innerHTML = '';
    setQ(`${sc.name}에서 들린 말은?`, `<span class="chip scene">${sc.icon} ${sc.name} · 주변 소리 ${['', '작게', '보통', '크게'][level]}</span>` + replayBtn() + '<span class="src" id="src"></span>');
    const listen = () => withNoise(id, level, () => playWord(target));
    $('#replay').onclick = replay(listen);
    const src = await playing(listen());
    if (!alive()) return false;
    const srcEl = $('#src'); if (srcEl) srcEl.textContent = { family: '가족 목소리', pack: 'AI 음성', tts: 'AI 음성', none: '이 화면에서는 AI 음성이 나오지 않아요' }[src] || '';
    const ans = await ask(opts.map((w) => [w]), opts.indexOf(target), 'sentences');
    const ok = opts[ans] === target;
    feedback(ok, ok ? '정답이에요' : '아쉬워요', ok ? `"${esc(target)}"` : `들린 말은 "${esc(target)}"예요. 조용할 때 소리를 먼저 익혀 봐요.`,
      ok ? null : [['정답 문장', () => playWord(target)], ['고른 문장', () => playWord(opts[ans])], ['소음 속에서 다시', listen]]);
    if (!ok) await replayAnswer(() => playWord(target));
    return ok;
  }

  function focusTag(focus) {
    return focus ? `<span class="focus-tag">${ICON.target}맞춤 문제 · ${esc(friendly(focus.c))}</span>` : '';
  }
  function logFocus(focus, ok) {
    if (!focus) return;
    const f = (data.focusLog = data.focusLog || {})[focus.c] || { n: 0, ok: 0 };
    data.focusLog[focus.c] = { n: f.n + 1, ok: f.ok + (ok ? 1 : 0) };
  }

  function replayBtn() {
    return `<button class="pill" id="replay">${ICON.speaker}다시 듣기</button>`;
  }

  // 보기 버튼을 보여 주고 고른 번호를 돌려준다. rightIdx를 주면 정답/오답 색을 칠한다.
  function ask(options, rightIdx, layout = '') {
    const box = $('#answers');
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
  const h = current;
  const m = h.match(/^#play\/(\d)$/);
  if (!m || !todayRun || todayRun.queue[todayRun.i] !== +m[1]) todayRun = null; // 오늘의 연습 밖으로 나가면 끝낸다
  const inv = h.match(/^#plan\/(.+)$/);
  if (m && STAGES[+m[1] - 1]?.ready) renderPlay(+m[1]);
  else if (inv) renderPlanInvite(inv[1]);
  else if (h === '#clinic') renderClinic();
  else if (h === '#check') renderCheck();
  else if (h === '#voices') renderVoices();
  else if (h === '#progress') renderProgress();
  else if (h === '#report') renderReport();
  else if (h === '#speak') renderSpeak();
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
