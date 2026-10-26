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
  if (target.length !== chosen.length) return ['글자 수'];
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
  { n: 1, name: '소리 감지', desc: '소리가 들렸는지 알려 주세요', ready: true },
  { n: 2, name: '환경음', desc: '생활 속 소리를 맞혀요', ready: true },
  { n: 3, name: '단어', desc: '들은 단어를 골라요', ready: true },
  { n: 4, name: '비슷한 소리 구별', desc: '준비 중' },
  { n: 5, name: '문장', desc: '준비 중' },
  { n: 6, name: '소음 속 듣기', desc: '준비 중' },
  { n: 7, name: '대화', desc: '준비 중' },
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

/* ---------- 화면 ---------- */

function setNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === name));
}

function renderHome() {
  setNav('home');
  const todays = data.sessions.filter((s) => s.date === today());
  const best = (n) => Math.max(0, ...data.sessions.filter((s) => s.stage === n).map((s) => s.score));
  view.innerHTML = `
    <h1>오늘의 듣기 연습</h1>
    <p class="sub">하루 10분, 단계를 골라 시작하세요. 이어폰이나 편한 음량으로 들으세요.</p>
    <div class="card stats">
      <div class="stat"><b>${streak()}일</b><span>연속 연습</span></div>
      <div class="stat"><b>${todays.length}판</b><span>오늘 한 판</span></div>
      <div class="stat"><b>${todays.reduce((a, s) => a + s.score, 0)}</b><span>오늘 점수</span></div>
    </div>
    <h2>7단계 커리큘럼</h2>
    ${STAGES.map((s) => `
      <button class="stage" ${s.ready ? `data-go="#play/${s.n}"` : 'disabled'}>
        <span class="num">${s.n}</span>
        <span class="txt"><b>${s.name}</b><span>${s.desc}</span></span>
        ${s.ready ? `<span class="best">레벨 ${data.levels[s.n] || 1}${best(s.n) ? `<br>최고 ${best(s.n)}점` : ''}</span>` : '<span class="best">🔒</span>'}
      </button>`).join('')}
    <p class="note">이 앱은 훈련용이며 청력 검사나 진단을 대신하지 않습니다.</p>`;
}

async function renderVoices() {
  setNav('voices');
  const have = new Set(await voiceDb.keys());
  const canRec = !!(navigator.mediaDevices && window.MediaRecorder);
  view.innerHTML = `
    <h1>가족 목소리</h1>
    <p class="sub">가족이 단어를 녹음하면 3단계에서 그 목소리로 문제를 냅니다. 실제로 매일 들어야 할 목소리로 연습할 수 있어요.</p>
    <div class="card">
      <label class="toggle"><input type="checkbox" id="pref" ${data.preferFamily ? 'checked' : ''}> 녹음이 있으면 가족 목소리로 듣기</label>
      <p class="note">녹음 ${have.size} / ${ALL_WORDS.length}개 · 녹음은 이 기기에만 저장됩니다.</p>
      ${canRec ? '' : '<p class="note">이 브라우저는 녹음을 지원하지 않아요. 최신 크롬이나 사파리에서 열어 주세요.</p>'}
    </div>
    <div class="card">
      ${ALL_WORDS.map((w) => `
        <div class="voice-row" data-w="${esc(w)}">
          <span class="w">${esc(w)}</span>
          ${have.has(w) ? '<span class="ok">녹음됨</span>' : ''}
          <button class="btn small" data-act="rec" ${canRec ? '' : 'disabled'}>🎙 녹음</button>
          <button class="btn small" data-act="play">▶</button>
          ${have.has(w) ? '<button class="btn small" data-act="del" aria-label="삭제">✕</button>' : ''}
        </div>`).join('')}
    </div>`;
  view.querySelector('#pref').onchange = (e) => { data.preferFamily = e.target.checked; persist(); };
  view.querySelectorAll('.voice-row button').forEach((b) => {
    b.onclick = async () => {
      const w = b.closest('.voice-row').dataset.w;
      if (b.dataset.act === 'play') return playWord(w);
      if (b.dataset.act === 'del') { await voiceDb.del(w); return renderVoices(); }
      await recordWord(w, b);
      renderVoices();
    };
  });
}

let recording = null;
async function recordWord(word, btn) {
  if (recording) { recording.stop(); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { alertInline('마이크 권한이 필요해요. 브라우저 설정에서 허용해 주세요.'); return; }
  const rec = new MediaRecorder(stream); const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise((res) => { rec.onstop = res; });
  recording = rec;
  btn.classList.add('rec'); btn.textContent = '■ 멈춤';
  document.querySelectorAll('.voice-row button').forEach((x) => { if (x !== btn) x.disabled = true; });
  rec.start();
  const timer = setTimeout(() => rec.state === 'recording' && rec.stop(), 3000); // 단어 하나는 3초면 충분
  await done;
  clearTimeout(timer);
  stream.getTracks().forEach((t) => t.stop());
  recording = null;
  if (chunks.length) await voiceDb.put(word, new Blob(chunks, { type: rec.mimeType }));
}

function alertInline(msg) {
  const p = document.createElement('p');
  p.className = 'feedback bad'; p.textContent = msg;
  view.prepend(p);
}

function renderProgress() {
  setNav('progress');
  const last14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('sv-SE');
    last14.push({ key, label: `${d.getDate()}`, score: data.sessions.filter((s) => s.date === key).reduce((a, s) => a + s.score, 0) });
  }
  const max = Math.max(1, ...last14.map((d) => d.score));
  const weak = Object.entries(data.confusions).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const acc = (n) => {
    const ss = data.sessions.filter((s) => s.stage === n).slice(-5);
    if (!ss.length) return '-';
    return Math.round(100 * ss.reduce((a, s) => a + s.correct, 0) / ss.reduce((a, s) => a + s.total, 0)) + '%';
  };
  view.innerHTML = `
    <h1>나의 기록</h1>
    <p class="sub">치료사 선생님께 보여 드리거나 파일로 보낼 수 있어요.</p>
    <div class="card">
      <b>최근 14일 점수</b>
      <div class="chart">${last14.map((d) => `<div style="height:${(100 * d.score / max).toFixed(0)}%" title="${d.key} ${d.score}점"></div>`).join('')}</div>
      <div class="chart-labels">${last14.map((d) => `<span>${d.label}</span>`).join('')}</div>
    </div>
    <div class="card stats">
      ${[1, 2, 3].map((n) => `<div class="stat"><b>${acc(n)}</b><span>${n}단계 최근 정답률</span></div>`).join('')}
    </div>
    <div class="card">
      <b>1단계: 들린 가장 작은 소리</b>
      <p class="sub" style="margin:4px 0 0">${data.minDb == null ? '아직 기록이 없어요.' : `기준보다 ${-data.minDb}dB 작은 소리까지 들었어요.`}</p>
    </div>
    <div class="card">
      <b>AI 취약음 분석</b>
      ${weak.length ? `<p class="note">3단계에서 틀린 답을 자모 단위로 비교했어요. 많이 헷갈린 소리부터 보여요.</p>
        <ul class="weak">${weak.map(([k, v]) => `<li><span>${esc(k)}</span><b>${v}회</b></li>`).join('')}</ul>`
        : '<p class="note">3단계를 하면 헷갈린 소리를 분석해 드려요.</p>'}
    </div>
    <div class="row">
      <button class="btn" id="export">기록 파일 받기</button>
      <button class="btn" id="reset">기록 지우기</button>
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
      persist(); renderProgress();
    } else { reset.dataset.confirm = '1'; reset.textContent = '한 번 더 누르면 지워져요'; }
  };
}

/* ---------- 훈련 ---------- */

let playToken = 0; // 다른 화면으로 가면 진행 중인 판을 멈춘다

async function renderPlay(stage) {
  setNav('home');
  const token = ++playToken;
  const alive = () => token === playToken;
  const level = data.levels[stage] || 1;
  const st = STAGES[stage - 1];
  const results = [];
  let toneDb = -10; // 1단계 시작 음량
  let quietest = null;
  const sessionConf = {};

  view.innerHTML = `
    <div class="play-head"><b>${stage}단계 · ${st.name}</b><span class="count">레벨 ${level}</span></div>
    <div class="bar"><i style="width:0%"></i></div>
    <div class="card prompt"><div class="big">🎧</div><p>준비되면 시작을 눌러 주세요</p>
      <p class="hint">${stage === 1 ? '소리가 날 수도, 안 날 수도 있어요.' : '소리를 듣고 맞는 것을 고르세요. 다시 듣기는 언제든 돼요.'}</p></div>
    <button class="btn primary block" id="start">시작</button>`;
  await new Promise((r) => { view.querySelector('#start').onclick = r; });
  audio(); // 사용자 터치로 오디오를 깨운다

  for (let i = 0; i < TRIALS && alive(); i++) {
    view.querySelector('.bar i').style.width = `${(100 * i) / TRIALS}%`;
    view.querySelector('.count').textContent = `${i + 1} / ${TRIALS}`;
    let ok;
    if (stage === 1) {
      ok = await toneTrial();
    } else if (stage === 2) {
      ok = await envTrial();
    } else {
      ok = await wordTrial();
    }
    if (!alive()) return;
    results.push(ok);
    await wait(900);
  }
  if (!alive()) return;

  const correct = results.filter(Boolean).length;
  let bestRun = 0; let run = 0;
  for (const r of results) { run = r ? run + 1 : 0; bestRun = Math.max(bestRun, run); }
  const score = correct * 10 + (bestRun >= 3 ? bestRun * 2 : 0); // 연속 정답 보너스
  const acc = correct / TRIALS;
  const next = adjustLevel(stage, acc);
  if (stage === 1 && quietest != null) data.minDb = data.minDb == null ? quietest : Math.min(data.minDb, quietest);
  for (const [k, v] of Object.entries(sessionConf)) data.confusions[k] = (data.confusions[k] || 0) + v;
  data.sessions.push({ date: today(), stage, level, score, correct, total: TRIALS, at: Date.now() });
  persist();

  const weak = Object.entries(sessionConf).sort((a, b) => b[1] - a[1]).slice(0, 3);
  view.querySelector('.bar i').style.width = '100%';
  view.innerHTML = `
    <div class="card result">
      <p class="sub">${stage}단계 · ${st.name}</p>
      <div class="score">${score}점</div>
      <p>${TRIALS}문제 중 ${correct}개 정답${bestRun >= 3 ? ` · ${bestRun}연속 보너스 +${bestRun * 2}` : ''}</p>
      <p class="sub">${next > level ? `잘하셨어요! 다음엔 레벨 ${next}로 올라가요.` : next < level ? `다음엔 레벨 ${next}에서 다시 익혀 봐요.` : `다음에도 레벨 ${next}로 연습해요.`}</p>
      ${stage === 1 && quietest != null ? `<p>기준보다 <b>${-quietest}dB</b> 작은 소리까지 들으셨어요.</p>` : ''}
      ${weak.length ? `<p><b>이번에 헷갈린 소리</b></p><ul class="weak">${weak.map(([k, v]) => `<li><span>${esc(k)}</span><b>${v}회</b></li>`).join('')}</ul>` : ''}
    </div>
    <div class="row">
      <button class="btn primary" data-go="#play/${stage}">한 판 더</button>
      <button class="btn" data-go="#home">처음으로</button>
    </div>`;

  // 1단계: 순음 감지. 들리면 5dB 작게, 놓치면 5dB 크게.
  async function toneTrial() {
    const present = Math.random() > 0.25; // 4번 중 1번은 소리 없음(찍기 방지)
    const freq = pick(TONES);
    const prompt = view.querySelector('.prompt');
    const body = () => view.querySelector('#answers');
    prompt.innerHTML = `<div class="big">👂</div><p>잘 들어 보세요…</p><p class="hint">&nbsp;</p>`;
    if (body()) body().remove();
    await wait(800 + Math.random() * 1500);
    if (!alive()) return false;
    if (present) await playTone(freq, toneDb); else await wait(900);
    prompt.innerHTML = `<div class="big">❓</div><p>소리가 들렸나요?</p><p class="hint">&nbsp;</p>`;
    const ans = await ask(['들렸어요', '안 들렸어요']);
    const heard = ans === 0;
    const ok = heard === present;
    if (present && heard) { quietest = quietest == null ? toneDb : Math.min(quietest, toneDb); toneDb = Math.max(-60, toneDb - 5); }
    else if (present && !heard) toneDb = Math.min(0, toneDb + 5);
    showFeedback(ok, ok ? (present ? '정확해요! 다음은 더 작게 들려드려요.' : '맞아요, 이번엔 소리가 없었어요.') : (present ? `${freq}Hz 소리가 있었어요. 조금 크게 다시 해 봐요.` : '이번엔 소리가 없었어요.'));
    return ok;
  }

  // 2단계: 환경음 고르기
  async function envTrial() {
    const ids = shuffle(Object.keys(ENV_SOUNDS)).slice(0, ENV_POOLS[level]);
    const target = pick(ids);
    const prompt = view.querySelector('.prompt');
    prompt.innerHTML = `<div class="big">🔊</div><p>무슨 소리일까요?</p><p class="hint"><button class="btn small" id="again">다시 듣기</button></p>`;
    prompt.querySelector('#again').onclick = () => playEnv(target);
    await playEnv(target);
    const ans = await ask(ids.map((id) => [ENV_SOUNDS[id].icon, ENV_SOUNDS[id].name]), ids.indexOf(target));
    const ok = ids[ans] === target;
    showFeedback(ok, ok ? '정답이에요!' : `정답은 ${ENV_SOUNDS[target].name}이에요.`);
    return ok;
  }

  // 3단계: 단어 고르기
  async function wordTrial() {
    const set = shuffle(pick(WORD_SETS[level]));
    const target = pick(set);
    const prompt = view.querySelector('.prompt');
    prompt.innerHTML = `<div class="big">🗣</div><p>어떤 단어를 들었나요?</p><p class="hint"><button class="btn small" id="again">다시 듣기</button> <span id="src"></span></p>`;
    prompt.querySelector('#again').onclick = () => playWord(target);
    const src = await playWord(target);
    const label = { family: '가족 목소리', tts: 'AI 음성', 'tts-nokorean': '이 기기에 한국어 음성이 없어 발음이 어색할 수 있어요', none: '이 브라우저는 음성을 지원하지 않아요' }[src];
    const srcEl = prompt.querySelector('#src'); if (srcEl) srcEl.textContent = label;
    const ans = await ask(set, set.indexOf(target));
    const ok = set[ans] === target;
    if (!ok) for (const c of contrasts(target, set[ans])) sessionConf[c] = (sessionConf[c] || 0) + 1;
    showFeedback(ok, ok ? '정답이에요!' : `정답은 "${target}"이에요.`);
    if (!ok) await playWord(target); // 틀리면 정답을 한 번 더 들려준다
    return ok;
  }

  // 보기 버튼을 보여 주고 고른 번호를 돌려준다. rightIdx를 주면 정답/오답 색을 칠한다.
  function ask(options, rightIdx) {
    let box = view.querySelector('#answers');
    if (!box) {
      box = document.createElement('div'); box.id = 'answers';
      view.querySelector('.prompt').after(box);
    }
    box.innerHTML = `<div class="choices">${options.map((o, i) => {
      const [main, sub] = Array.isArray(o) ? o : [o, ''];
      return `<button class="choice" data-i="${i}">${esc(main)}${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
    }).join('')}</div><div class="feedback"></div>`;
    view.querySelector('#start')?.remove();
    return new Promise((res) => {
      box.querySelectorAll('.choice').forEach((b) => {
        b.onclick = () => {
          const i = +b.dataset.i;
          box.querySelectorAll('.choice').forEach((x) => { x.disabled = true; });
          if (rightIdx != null) {
            box.querySelector(`[data-i="${rightIdx}"]`).classList.add('right');
            if (i !== rightIdx) b.classList.add('wrong');
          }
          res(i);
        };
      });
    });
  }
  function showFeedback(ok, msg) {
    const f = view.querySelector('.feedback');
    if (f) { f.className = `feedback ${ok ? 'good' : 'bad'}`; f.textContent = (ok ? '⭕ ' : '❌ ') + msg; }
  }
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
