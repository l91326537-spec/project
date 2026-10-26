'use strict';
/*
 * 소리길: 게임형 청능훈련 시제품
 * - 1단계 소리 감지: 순음을 점점 작게(적응형 계단법) 들려주고 들렸는지 묻는다.
 * - 2단계 환경음: 합성한 생활 소리를 듣고 무슨 소리인지 고른다.
 * - 3단계 단어: 가족 녹음 또는 한국어 TTS로 단어를 듣고 고른다. 틀린 답에서 헷갈린 자모를 뽑는다.
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
let data = Object.assign({
  sessions: [],          // {date, stage, score, correct, total, level}
  levels: { 1: 1, 2: 1, 3: 1 },
  minDb: null,           // 1단계에서 들린 가장 작은 소리(dB, 기준 대비)
  confusions: {},        // '초성 ㅅ↔ㅆ': 횟수
  preferFamily: true,
}, store.load());
const persist = () => store.save(data);

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

// 3단계: 단어. 가족 녹음이 있으면 그것을, 없으면 한국어 TTS를 쓴다.
let koVoice = null;
function pickVoice() {
  const vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  koVoice = vs.find((v) => /^ko/i.test(v.lang)) || null;
}
if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

async function playWord(word) {
  if (data.preferFamily) {
    const blob = await voiceDb.get(word);
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      await new Promise((res) => { a.onended = a.onerror = res; a.play().catch(res); });
      URL.revokeObjectURL(url);
      return 'family';
    }
  }
  if (!window.speechSynthesis) return 'none';
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = 'ko-KR'; u.rate = 0.85;
  if (koVoice) u.voice = koVoice;
  await new Promise((res) => { u.onend = u.onerror = res; speechSynthesis.speak(u); setTimeout(res, 4000); });
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

/* ---------- 문항 ---------- */

// 단계(level)가 오를수록 보기끼리 소리가 비슷해진다.
const WORD_SETS = {
  1: [ // 글자 수가 다른 단어
    ['물', '우산', '바나나', '텔레비전'],
    ['밥', '모자', '할머니', '냉장고'],
    ['컵', '시계', '자동차', '아이스크림'],
    ['눈', '신발', '강아지', '할아버지'],
  ],
  2: [ // 글자 수는 같고 소리가 다른 단어
    ['사과', '우유', '모자', '가방'],
    ['기차', '나무', '포도', '의자'],
    ['수박', '안경', '연필', '거울'],
    ['고양이', '비행기', '자전거', '전화기'],
  ],
  3: [ // 최소대립쌍: 한 소리만 다르다
    ['살', '쌀', '달', '발'],
    ['불', '풀', '뿔', '물'],
    ['방', '빵', '밤', '반'],
    ['공', '콩', '곰', '골'],
    ['감', '김', '검', '곰'],
    ['사다', '싸다', '자다', '차다'],
  ],
};
const ALL_WORDS = [...new Set(Object.values(WORD_SETS).flat(2))];
const ENV_POOLS = { 1: 2, 2: 3, 3: 4 }; // 단계별 보기 수
const TONES = [500, 1000, 2000, 4000];

const STAGES = [
  { n: 1, name: '소리 감지', desc: '소리가 나면 알려요', ready: true },
  { n: 2, name: '환경음', desc: '생활 소리를 맞혀요', ready: true },
  { n: 3, name: '단어', desc: '들은 단어를 골라요', ready: true },
  { n: 4, name: '비슷한 소리 구별', desc: '같은지 다른지 가려요' },
  { n: 5, name: '문장', desc: '짧은 문장을 알아들어요' },
  { n: 6, name: '소음 속 듣기', desc: '시끄러운 곳에서 들어요' },
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
};
const stars = (n) => `<span class="stars" aria-label="레벨 ${n}/3">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;

/* ---------- 화면 ---------- */

const DAILY_GOAL = 3;

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
  const goalDone = todays.length >= DAILY_GOAL;
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
  const readyEnd = pts[STAGES.filter((s) => s.ready).length - 1].y;

  view.innerHTML = `
    <section class="hero">
      <div class="hero-text">
        <p class="eyebrow">${hello}</p>
        <h1>${goalDone ? '오늘 목표를<br>채웠어요' : `오늘 ${DAILY_GOAL - todays.length}판만<br>더 들어 봐요`}</h1>
        <div class="chips">
          <span class="chip warm">${ICON.flame}<b>${streak()}일</b> 연속</span>
          <span class="chip">오늘 <b>${todays.reduce((a, s) => a + s.score, 0)}</b>점</span>
        </div>
      </div>
      <div class="hero-ring">
        ${ring(todays.length, DAILY_GOAL)}
        <span class="ring-num"><b>${Math.min(todays.length, DAILY_GOAL)}</b>/${DAILY_GOAL}</span>
      </div>
      <button class="btn primary block" data-go="#play/${rec}">${ICON.play}${rec}단계 ${STAGES[rec - 1].name} 시작</button>
    </section>

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
    <p class="note center">훈련용 앱이며 청력 검사나 진단을 대신하지 않아요.</p>`;
}

async function renderVoices() {
  setNav('voices');
  const have = new Set(await voiceDb.keys());
  const canRec = !!(navigator.mediaDevices && window.MediaRecorder);
  const groups = [
    ['쉬운 단어', [...new Set(WORD_SETS[1].flat())]],
    ['같은 길이 단어', [...new Set(WORD_SETS[2].flat())]],
    ['헷갈리는 단어', [...new Set(WORD_SETS[3].flat())]],
  ];
  const pct = Math.round((100 * have.size) / ALL_WORDS.length);
  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow">가족 목소리</p>
      <h1>매일 듣는 목소리로<br>연습해요</h1>
      <p class="lead">가족이 단어를 읽어 녹음하면 3단계 문제를 그 목소리로 들려드려요.</p>
    </header>
    <section class="panel">
      <div class="meter-row"><span>녹음한 단어</span><b>${have.size} / ${ALL_WORDS.length}</b></div>
      <div class="meter"><i style="width:${pct}%"></i></div>
      <label class="switch" for="pref">
        <input type="checkbox" id="pref" ${data.preferFamily ? 'checked' : ''}>
        <span class="switch-ui" aria-hidden="true"></span>
        녹음이 있으면 가족 목소리로 듣기
      </label>
      ${canRec ? '<p class="note">녹음 버튼을 누르고 단어를 또박또박 읽어 주세요. 3초 뒤 저절로 멈춰요.</p>'
        : '<p class="note warn">이 화면에서는 녹음을 쓸 수 없어요. 최신 크롬이나 사파리에서 앱 주소를 직접 열어 주세요.</p>'}
    </section>
    ${groups.map(([title, words]) => `
      <h2 class="section-title">${title}</h2>
      <ul class="word-list">
        ${words.map((w) => `
          <li class="word-row ${have.has(w) ? 'has' : ''}" data-w="${esc(w)}">
            <span class="word">${esc(w)}</span>
            <span class="word-state">${have.has(w) ? `${ICON.check}녹음됨` : 'AI 음성'}</span>
            <button class="icon-btn" data-act="play" aria-label="${esc(w)} 들어 보기">${ICON.speaker}</button>
            <button class="icon-btn rec-btn" data-act="rec" ${canRec ? '' : 'disabled'} aria-label="${esc(w)} 녹음">${ICON.mic}</button>
            ${have.has(w) ? `<button class="icon-btn" data-act="del" aria-label="${esc(w)} 녹음 지우기">${ICON.trash}</button>` : ''}
          </li>`).join('')}
      </ul>`).join('')}`;
  view.querySelector('#pref').onchange = (e) => { data.preferFamily = e.target.checked; persist(); };
  view.querySelectorAll('.word-row button').forEach((b) => {
    b.onclick = async () => {
      const w = b.closest('.word-row').dataset.w;
      if (b.dataset.act === 'play') { b.classList.add('busy'); await playWord(w); b.classList.remove('busy'); return; }
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
  btn.classList.add('recording'); btn.setAttribute('aria-label', '녹음 멈추기');
  document.querySelectorAll('.word-row button').forEach((x) => { if (x !== btn) x.disabled = true; });
  rec.start();
  const timer = setTimeout(() => rec.state === 'recording' && rec.stop(), 3000); // 단어 하나는 3초면 충분
  await done;
  clearTimeout(timer);
  stream.getTracks().forEach((t) => t.stop());
  recording = null;
  if (chunks.length) await voiceDb.put(word, new Blob(chunks, { type: rec.mimeType }));
  return true;
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
  const weak = Object.entries(data.confusions).sort((a, b) => b[1] - a[1]).slice(0, 5);
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
      <h1>꾸준히 듣고 있어요</h1>
      <p class="lead">치료사 선생님께 이 화면을 보여 드리세요.</p>
    </header>
    <section class="tiles">
      <div class="tile"><b>${streak()}<small>일</small></b><span>연속 연습</span></div>
      <div class="tile"><b>${practiceDays}<small>일</small></b><span>연습한 날</span></div>
      <div class="tile"><b>${data.sessions.length}<small>판</small></b><span>전체 판 수</span></div>
    </section>
    <section class="panel">
      <h2 class="panel-title">최근 14일 점수</h2>
      ${chart}
    </section>
    <section class="panel">
      <h2 class="panel-title">단계별 정답률 <span>최근 5판</span></h2>
      <ul class="acc-list">
        ${STAGES.filter((s) => s.ready).map((s) => {
          const a = acc(s.n);
          return `<li><span class="acc-name"><b>${s.n}</b>${s.name}</span>
            <span class="acc-bar"><i style="width:${a ?? 0}%"></i></span>
            <span class="acc-val">${a == null ? '–' : a + '%'}</span></li>`;
        }).join('')}
      </ul>
      <p class="note">${data.minDb == null ? '1단계를 하면 들린 가장 작은 소리를 기록해요.' : `1단계에서 기준보다 <b>${-data.minDb}dB</b> 작은 소리까지 들었어요.`}</p>
    </section>
    <section class="panel">
      <h2 class="panel-title">자주 헷갈린 소리</h2>
      ${weak.length ? `<ul class="weak-list">${weak.map(([k, v]) => `
          <li><span class="weak-k">${esc(k)}</span><span class="weak-bar"><i style="width:${(100 * v) / weakMax}%"></i></span><b>${v}회</b></li>`).join('')}</ul>
        <p class="note">3단계에서 틀린 답을 자모 단위로 비교했어요.</p>`
        : '<p class="note">3단계를 하면 어떤 소리를 헷갈리는지 알려 드려요.</p>'}
    </section>
    <div class="actions">
      <button class="btn" id="export">기록 파일 받기</button>
      <button class="btn ghost" id="reset">기록 지우기</button>
    </div>`;
  view.querySelector('#export').onclick = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `소리길_기록_${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const reset = view.querySelector('#reset');
  reset.onclick = () => {
    if (reset.dataset.confirm) {
      data = { sessions: [], levels: { 1: 1, 2: 1, 3: 1 }, minDb: null, confusions: {}, preferFamily: data.preferFamily };
      persist(); renderProgress(); toast('기록을 지웠어요.');
    } else { reset.dataset.confirm = '1'; reset.textContent = '한 번 더 누르면 지워져요'; reset.classList.add('danger'); }
  };
}

/* ---------- 훈련 ---------- */

let playToken = 0; // 다른 화면으로 가면 진행 중인 판을 멈춘다

async function renderPlay(stage) {
  setNav('play');
  const token = ++playToken;
  const alive = () => token === playToken;
  const level = data.levels[stage] || 1;
  const st = STAGES[stage - 1];
  const results = [];
  let toneDb = -10; // 1단계 시작 음량
  let quietest = null;
  const sessionConf = {};
  const intro = {
    1: ['소리가 들리면 알려 주세요', '삐 소리가 날 수도, 안 날 수도 있어요. 조용한 곳에서 해 주세요.'],
    2: ['무슨 소리인지 맞혀 보세요', '생활 속 소리를 들려드려요. 몇 번이든 다시 들을 수 있어요.'],
    3: ['들은 단어를 골라 주세요', '레벨이 오를수록 비슷한 소리가 나와요.'],
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
      <div id="answers"><button class="btn primary block" id="start">시작하기</button></div>
    </div>
    <div class="sheet" id="sheet" hidden>
      <div class="sheet-msg"><span class="sheet-icon"></span><div><b id="sheet-title"></b><p id="sheet-text"></p></div></div>
      <button class="btn block" id="next">다음</button>
    </div>`;
  const $ = (s) => view.querySelector(s);
  await new Promise((r) => { $('#start').onclick = r; });
  audio(); // 사용자 터치로 오디오를 깨운다

  const orb = $('#orb');
  const setOrb = (mode, icon) => { orb.className = `orb ${mode}`; if (icon) orb.innerHTML = icon; };
  const playing = async (p) => { setOrb('playing'); try { return await p; } finally { if (alive()) setOrb('idle'); } };
  const setQ = (q, hint = '') => { $('#q').textContent = q; $('#hint').innerHTML = hint; };

  for (let i = 0; i < TRIALS && alive(); i++) {
    const dots = view.querySelectorAll('.dots i');
    dots.forEach((d, k) => d.classList.toggle('now', k === i));
    let ok;
    if (stage === 1) ok = await toneTrial();
    else if (stage === 2) ok = await envTrial();
    else ok = await wordTrial();
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
  for (const [k, v] of Object.entries(sessionConf)) data.confusions[k] = (data.confusions[k] || 0) + v;
  data.sessions.push({ date: today(), stage, level, score, correct, total: TRIALS, at: Date.now() });
  persist();

  const medal = acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : acc >= 0.4 ? 1 : 0;
  const weak = Object.entries(sessionConf).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const headline = ['오늘도 들어 본 것만으로 충분해요', '좋아요, 감이 오고 있어요', '잘 들으셨어요', '훌륭해요!'][medal];
  view.innerHTML = `
    <div class="play result">
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
      ${weak.length ? `<section class="panel"><h2 class="panel-title">이번에 헷갈린 소리</h2>
        <ul class="weak-list">${weak.map(([k, v]) => `<li><span class="weak-k">${esc(k)}</span><span class="weak-bar"><i style="width:${(100 * v) / weak[0][1]}%"></i></span><b>${v}회</b></li>`).join('')}</ul></section>` : ''}
      <div class="actions">
        <button class="btn primary" data-go="#play/${stage}">한 판 더</button>
        <button class="btn" data-go="#home">소리길로</button>
      </div>
    </div>`;
  countUp(view.querySelector('#score'), score);

  // 1단계: 순음 감지. 들리면 5dB 작게, 놓치면 5dB 크게.
  async function toneTrial() {
    const present = Math.random() > 0.25; // 4번 중 1번은 소리 없음(찍기 방지)
    const freq = pick(TONES);
    $('#answers').innerHTML = '';
    setQ('잘 들어 보세요', '&nbsp;');
    setOrb('listening');
    await wait(800 + Math.random() * 1500);
    if (!alive()) return false;
    if (present) await playing(playTone(freq, toneDb)); else await wait(900);
    if (!alive()) return false;
    setOrb('idle');
    setQ('소리가 들렸나요?', '&nbsp;');
    const ans = await ask([['들렸어요'], ['안 들렸어요']], null, 'two');
    const heard = ans === 0;
    const ok = heard === present;
    if (present && heard) { quietest = quietest == null ? toneDb : Math.min(quietest, toneDb); toneDb = Math.max(-60, toneDb - 5); }
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
    $('#replay').onclick = () => playing(playEnv(target));
    await playing(playEnv(target));
    if (!alive()) return false;
    const ans = await ask(ids.map((id) => [ENV_SOUNDS[id].name, ENV_SOUNDS[id].icon]), ids.indexOf(target), ids.length === 2 ? 'two' : '');
    const ok = ids[ans] === target;
    feedback(ok, ok ? '정답이에요' : '아쉬워요', ok ? `${ENV_SOUNDS[target].name} 소리였어요.` : `정답은 ${ENV_SOUNDS[target].name}이에요. 한 번 더 들어 보세요.`);
    if (!ok) await playEnv(target);
    return ok;
  }

  // 3단계: 단어 고르기
  async function wordTrial() {
    const set = shuffle(pick(WORD_SETS[level]));
    const target = pick(set);
    $('#answers').innerHTML = '';
    setQ('어떤 단어를 들었나요?', replayBtn() + '<span class="src" id="src"></span>');
    $('#replay').onclick = () => playing(playWord(target));
    const src = await playing(playWord(target));
    if (!alive()) return false;
    const label = { family: '가족 목소리', tts: 'AI 음성', 'tts-nokorean': '이 기기에는 한국어 음성이 없어 발음이 어색할 수 있어요', none: '이 브라우저는 음성을 지원하지 않아요' }[src];
    const srcEl = $('#src'); if (srcEl) srcEl.textContent = label;
    const ans = await ask(set.map((w) => [w]), set.indexOf(target), 'words');
    const ok = set[ans] === target;
    if (!ok) for (const c of contrasts(target, set[ans])) sessionConf[c] = (sessionConf[c] || 0) + 1;
    const why = ok ? '' : contrasts(target, set[ans]).filter((c) => c !== '단어 길이').join(', ');
    feedback(ok, ok ? '정답이에요' : '아쉬워요', ok ? `"${esc(target)}"였어요.` : `정답은 "${esc(target)}"예요.${why ? ` <span class="why">${esc(why)}</span>` : ''}`);
    if (!ok) await playWord(target); // 틀리면 정답을 한 번 더 들려준다
    return ok;
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

  function feedback(ok, title, text) {
    const sh = $('#sheet');
    sh.className = `sheet ${ok ? 'good' : 'bad'}`;
    sh.querySelector('.sheet-icon').innerHTML = ok ? ICON.check : ICON.x;
    $('#sheet-title').textContent = title;
    $('#sheet-text').innerHTML = text;
    sh.hidden = false;
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
function go(h) { current = h; route(); }
function route() {
  playToken++;
  if (window.speechSynthesis) speechSynthesis.cancel();
  const h = current;
  const m = h.match(/^#play\/(\d)$/);
  if (m && STAGES[+m[1] - 1]?.ready) renderPlay(+m[1]);
  else if (h === '#voices') renderVoices();
  else if (h === '#progress') renderProgress();
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
