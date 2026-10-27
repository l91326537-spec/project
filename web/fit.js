'use strict';
/*
 * 사람에게 맞추기: 사용자 유형, 듣는 귀, 말 빠르기, 링 6소리 점검, 소리 구별(초분절), 기기 조절 일지.
 * - 사용자 유형(보청기 / 인공와우 성인 / 인공와우 아이 / 두 번째 귀)마다 지도에서 시작하는 장, 집중 연습 시작 단계,
 *   말 빠르기, 칸 통과에 필요한 날수, 권하는 연습을 다르게 준다. 뇌가 말소리를 이미 아느냐에 따라 출발점과 진도가 다르다.
 *   청각 재활에서 일반적으로 알려진 원칙을 따른 값이라 담당 청능사·이비인후과 선생님과 맞춰 볼 것.
 * - 듣는 귀: 이어폰이나 기기 블루투스로 들을 때 소리를 한쪽으로만 보낸다(소리 길은 app.js의 earOut).
 * - 링 6소리: 아·우·이·쉬·스·음을 매일 30초 확인한다. 점수가 갑자기 떨어지면 기기 점검이나 매핑을 알아보라고 알린다.
 * - 소리 구별: 짧은 말·긴 말, 묻는 말·대답하는 말(말끝 높낮이), 남자·여자 목소리. 낱말 구별보다 쉬운 출발점이다.
 * - 기기 조절 일지: 매핑·보청기 조절 날짜를 적고, 그 전 7일과 뒤 7일의 점수를 견준다.
 * app.js보다 먼저 읽히므로, app.js의 것은 함수 안에서만 쓴다.
 */

// ch: 지도에서 시작하는 장(앞 장은 열어 두고 몸풀기로 쓴다), focus: 집중 연습 시작 단계, speed: 말 빠르기,
// days: 칸 통과에 필요한 서로 다른 날 수 [1·2장, 3장부터], ling: 집 화면에서 링 6소리를 매일 권하는지
const WHO = {
  ha: {
    name: '보청기', icon: '🦻', about: '나이 들며, 또는 살면서 청력이 떨어져 보청기를 써요',
    start: '3장 시장·마트부터 · 집중 연습 3단계, 문장 5단계부터', ch: 3, focus: { word: 3, sound: 3, sent: 5 }, speed: 1, days: [1, 2], ling: false,
    tip: '고음 자음(ㅅ·ㅊ·ㅎ·ㅆ)과 받침, 소음 속 대화가 어려운 경우가 많아요. 소음 속 듣기는 일찍 시작하고, 애써 듣느라 지치면 20분쯤 하고 쉬어요.',
  },
  ci: {
    name: '인공와우(성인)', icon: '👂', about: '말을 배운 뒤 청력을 잃고 인공와우를 받았어요',
    start: '1장 우리 집부터 · 조금 느리게', ch: 1, focus: { word: 1, sound: 1, sent: 1 }, speed: 0.92, days: [1, 2], ling: true,
    tip: '처음 한두 달은 소리가 낯설고 기계음 같을 수 있어요. 1~3단계에서 익히고 나면 그 뒤로는 빠르게 올라가요.',
  },
  kid: {
    name: '인공와우(아이)', icon: '🧒', about: '태어날 때부터 잘 듣지 못해 소리와 말을 처음부터 배워요',
    start: '소리 알아차리기 → 길이·말끝 구별 → 쉬운 낱말 · 느리게', ch: 1, focus: { word: 1, sound: 1, sent: 1 }, speed: 0.85, days: [2, 3], ling: true,
    tip: '놀이처럼 짧게, 보호자가 옆에서 함께 해요. 글자를 아직 못 읽으면 그림으로 고르는 링 6소리와 소리 구별부터 해요.',
  },
  ear2: {
    name: '두 번째 귀', icon: '🎧', about: '한쪽 귀에 이어 다른 쪽 귀에도 인공와우를 받았어요',
    start: '새 귀로만 1장부터 · 조금 느리게', ch: 1, focus: { word: 1, sound: 1, sent: 1 }, speed: 0.92, days: [1, 2], ling: true,
    tip: '새 귀의 소리는 낯설어서 잘 들리는 귀에 기대기 쉬워요. 처음 몇 주는 다른 쪽 기기를 빼고 새 귀로만 듣고, 익숙해지면 두 귀로 소음 속 듣기(5장)를 해요.',
  },
};
const WHO_NONE = { name: '', ch: 1, focus: { word: 1, sound: 1, sent: 1 }, speed: 1, days: [1, 2], ling: false };
const whoOf = (d = data) => WHO[d.who] || WHO_NONE;
const SPEEDS = [[0.85, '느리게'], [0.92, '조금 느리게'], [1, '보통']];
const talkRate = () => data.talkSpeed || whoOf().speed || 1;
const speedName = () => (SPEEDS.find(([v]) => v === talkRate()) || [0, '보통'])[1];
const EAR_NAME = { both: '두 귀', L: '왼쪽 귀', R: '오른쪽 귀' };
const earSide = () => (data.ear === 'L' || data.ear === 'R' ? data.ear : null);

/* ---------- 합성 소리 ---------- */

// 목소리 같은 소리를 합성한다. f0(p): 0~1 지점의 목소리 높이(Hz), res: 공명 [[주파수, 폭, 크기], ...],
// noise: 성대 울림 대신 바람 소리(쉬·스), db: 크기(AI 음성 말소리 RMS 약 0.14를 0으로)
function voiceBuffer(c, { dur, f0, res, noise = false, db = 0 }) {
  const sr = c.sampleRate; const n = Math.round(sr * dur);
  const sig = new Float32Array(n);
  // RBJ 대역통과 필터 계수(app.js의 장소 소음과 같은 식)
  const co = res.map(([f, bw]) => { const w = 2 * Math.PI * f / sr; const al = Math.sin(w) * bw / (2 * f); const a0 = 1 + al; return [al / a0, -al / a0, -2 * Math.cos(w) / a0, (1 - al) / a0]; });
  const st = res.map(() => [0, 0, 0, 0]);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    let x;
    if (noise) x = Math.random() * 2 - 1;
    else {
      const hz = f0(i / n) * (1 + 0.01 * Math.sin(2 * Math.PI * 5.5 * i / sr)); // 작은 떨림
      ph += hz / sr; if (ph >= 1) ph -= 1;
      x = 1 - 2 * ph + (Math.random() * 2 - 1) * 0.04; // 톱니파(성대 울림)에 숨소리를 조금
    }
    let y = 0;
    for (let k = 0; k < res.length; k++) {
      const [b0, b2, a1, a2] = co[k]; const z = st[k];
      const o = b0 * x + b2 * z[1] - a1 * z[2] - a2 * z[3];
      z[1] = z[0]; z[0] = x; z[3] = z[2]; z[2] = o;
      y += o * res[k][2];
    }
    sig[i] = y;
  }
  let sum = 0; for (let i = 0; i < n; i++) sum += sig[i] * sig[i];
  const scale = (0.14 * Math.pow(10, db / 20)) / Math.sqrt(sum / n || 1);
  const att = Math.round(sr * 0.06); const rel = Math.round(sr * 0.15);
  const buf = c.createBuffer(1, n, sr); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const e = Math.min(1, i / att, (n - 1 - i) / rel); // 시작과 끝을 부드럽게
    d[i] = Math.max(-1, Math.min(1, sig[i] * scale * Math.sin((e * Math.PI) / 2)));
  }
  return buf;
}
function playBuffer(buf) {
  const c = audio(); const src = c.createBufferSource();
  src.buffer = buf; src.connect(earOut(c)); src.start(c.currentTime + 0.05);
  return new Promise((res) => { src.onended = res; setTimeout(res, buf.duration * 1000 + 400); });
}

/* ---------- 링 6소리 ---------- */

// 아·우·이·쉬·스·음은 낮은 소리(음·우)부터 아주 높은 소리(스)까지 말소리 높낮이를 고루 덮는다.
// 매일 같은 소리여야 점수 변화를 견줄 수 있어서 늘 같은 식으로 합성한다(가족이 여섯 소리를 다 녹음하면 그 목소리로).
// f: 목소리 공명, n: 바람 소리 공명. db는 '아' 대비 크기로, 실제 말소리처럼 '스'가 가장 작다(대략의 값).
// pic은 글자를 모르는 아이도 고를 수 있게 붙인 그림(아-비행기, 우-유령, 이-생쥐, 쉬-쉿, 스-뱀, 음-아이스크림)
const LING = [
  { id: 'a', say: '아', pic: '✈️', f: [[900, 90, 1], [1400, 110, 1], [2800, 170, 0.4]], db: 0 },
  { id: 'u', say: '우', pic: '👻', f: [[350, 70, 1], [800, 90, 0.8], [2600, 160, 0.15]], db: -4 },
  { id: 'i', say: '이', pic: '🐭', f: [[320, 70, 1], [2700, 150, 1.6], [3300, 200, 1]], db: -5 },
  { id: 'sh', say: '쉬', pic: '🤫', n: [[2800, 1400, 1], [4500, 1500, 0.4]], db: -5 },
  { id: 's', say: '스', pic: '🐍', n: [[5500, 2000, 1], [7500, 2500, 0.7]], db: -13 },
  { id: 'm', say: '음', pic: '🍦', f: [[250, 60, 1], [1100, 150, 0.15], [2400, 200, 0.1]], db: -8 },
];
const LING_BY = Object.fromEntries(LING.map((s) => [s.id, s]));
const lingKey = (s) => `링:${s.say}`; // 가족 녹음 이름(낱말 녹음과 겹치지 않게)
const lingCache = {};
async function lingFamily() {
  if (!data.preferFamily) return false;
  const keys = await voiceDb.keys();
  return LING.every((s) => keys.includes(lingKey(s)));
}
async function playLing(s, family = false) {
  if (family) {
    const blob = await voiceDb.get(lingKey(s));
    if (blob) { const url = URL.createObjectURL(blob); await playUrl(url); URL.revokeObjectURL(url); return; }
  }
  const c = audio();
  const buf = lingCache[s.id] || (lingCache[s.id] = voiceBuffer(c, { dur: 1.2, f0: (p) => 175 - 15 * p, res: s.f || s.n, noise: !!s.n, db: s.db }));
  await playBuffer(buf);
}
const lingAvg = (list) => (list.length ? Math.round((10 * list.reduce((a, x) => a + x.ok, 0)) / list.length) / 10 : null);
const lingSays = (ids) => ids.map((id) => `'${LING_BY[id].say}'`).join('·');

// 갑자기 덜 들리는지: 같은 귀로 한 최근 점검(최대 7번) 평균보다 1.5개 넘게 적거나,
// 그 앞 세 번은 알아듣던 소리를 두 번 연달아 놓쳤으면 알린다.
function lingDrop(list = data.lings) {
  const last = list[list.length - 1];
  if (!last) return null;
  const mine = list.filter((x) => x.ear === last.ear);
  const prev = mine.slice(-8, -1);
  if (prev.length < 3) return null;
  const avg = lingAvg(prev);
  const before = mine.slice(-5, -2); const lastTwo = mine.slice(-2);
  const lost = mine.length >= 5 ? LING.filter((s) => lastTwo.every((x) => x.miss.includes(s.id)) && before.every((x) => !x.miss.includes(s.id))).map((s) => s.id) : [];
  if (avg - last.ok < 1.5 && !lost.length) return null;
  return {
    date: last.date,
    why: avg - last.ok >= 1.5 ? `최근 ${prev.length}번 평균은 ${avg}개였는데 이번에는 ${last.ok}개예요.` : `늘 알아듣던 ${lingSays(lost)} 소리를 두 번 연달아 놓쳤어요.`,
  };
}
function lingAlert(drop) {
  return `
    <section class="panel alert-card">
      <div class="focus-head"><span class="focus-ico">${ICON.ear}</span>
        <div><h2 class="panel-title">평소보다 덜 들렸어요</h2><p class="note">${drop.why}</p></div></div>
      <ul class="check-list">
        <li>기기 배터리와 충전 상태</li>
        <li>마이크 구멍의 먼지나 덮개</li>
        <li>코일·귀꽂이가 제자리에 있는지</li>
        <li>이어폰 연결과 휴대폰 음량</li>
      </ul>
      <p class="tip-body">살펴봤는데도 내일 다시 낮게 나오면, 다니는 병원(청능사)에 기기 점검이나 매핑이 필요한지 물어보세요.</p>
      <div class="actions"><button class="btn" data-go="#ling">다시 점검하기</button><button class="btn ghost" data-go="#maps">기기 조절 일지</button></div>
    </section>`;
}

async function renderLing() {
  setNav('play');
  const token = ++playToken;
  const alive = () => token === playToken;
  const family = await lingFamily();
  if (!alive()) return;
  const prev = data.lings.filter((x) => x.ear === data.ear).slice(-7);
  view.innerHTML = playShell('#home', `링 6소리 점검${earSide() ? ` · ${EAR_NAME[data.ear]}` : ''}`, '여섯 소리를 들어요',
    `아·우·이·쉬·스·음을 하나씩 들려드려요. 들린 소리를 고르고, 아무 소리도 안 들리면 '안 들렸어요'를 눌러요. 30초쯤 걸려요.${family ? ' 가족이 녹음한 목소리로 들려드려요.' : ''}`,
    startBox(false, `<p class="note center">${prev.length ? `최근 ${prev.length}번 평균 ${lingAvg(prev)}개.` : '매일 같은 소리로 하니 날마다 견줄 수 있어요.'} 아이와 할 때는 보호자가 그림을 같이 짚어 주세요.</p>`));
  $('#orb').innerHTML = ICON.ear;
  $('#pnum').textContent = '6소리';
  await waitStart(false, alive);
  if (!alive()) return;
  const orb = $('#orb'); orb.innerHTML = ICON.speaker;
  let busy = false;
  const playing = async (fn) => { busy = true; orb.className = 'orb playing'; try { return await fn(); } finally { busy = false; if (alive()) orb.className = 'orb idle'; } };
  const setQ = (q, hint = '') => { $('#q').textContent = q; $('#hint').innerHTML = hint; };
  const res = {};
  const order = shuffle(LING);
  for (let i = 0; i < order.length && alive(); i++) {
    const s = order[i];
    $('#pnum').textContent = `${i + 1}번째 / 6소리`;
    $('#pbar').style.width = `${(100 * i) / 6}%`;
    $('#answers').innerHTML = '';
    setQ('잘 들어 보세요', '&nbsp;');
    await wait(500);
    if (!alive()) return;
    const listen = () => playLing(s, family);
    await playing(listen);
    if (!alive()) return;
    setQ('어떤 소리였나요?', replayBtn('한 번 더 듣기'));
    const b = $('#replay'); // 다시 듣기는 소리마다 한 번
    b.onclick = () => { if (busy) return; b.disabled = true; b.lastChild.textContent = '다시 듣기를 썼어요'; playing(listen); };
    const k = await ask([...LING.map((x) => [x.say, x.pic]), ['안 들렸어요', ICON.x]], LING.indexOf(s), 'ling');
    if (!alive()) return;
    res[s.id] = k === LING.length ? 'none' : LING[k].id;
    await wait(900);
  }
  if (!alive()) return;

  const miss = LING.filter((s) => res[s.id] !== s.id).map((s) => s.id);
  const unheard = LING.filter((s) => res[s.id] === 'none').map((s) => s.id);
  const ok = LING.length - miss.length;
  data.lings.push({ date: today(), at: Date.now(), ear: data.ear, src: family ? 'family' : 'synth', ok, heard: LING.length - unheard.length, miss, res });
  persist();
  const drop = lingDrop();
  view.innerHTML = `
    <div class="play result">
      <p class="eyebrow center">링 6소리 점검${earSide() ? ` · ${EAR_NAME[data.ear]}` : ''}</p>
      <h1 class="q">6소리 중 ${ok}개를 알아들었어요</h1>
      <p class="lead center">${unheard.length ? `${lingSays(unheard)} 소리는 안 들렸어요.` : '여섯 소리 모두 들렸어요.'}
        ${prev.length ? `최근 ${prev.length}번 평균은 ${lingAvg(prev)}개예요.` : '첫 점검이에요. 내일도 같은 소리로 견줘 봐요.'}</p>
      ${drop ? lingAlert(drop) : ''}
      <section class="panel">
        <ul class="ling-rows">${LING.map((s) => {
          const r = res[s.id];
          return `<li><span class="ling-pic" aria-hidden="true">${s.pic}</span><b>${s.say}</b>
            <span class="${r === s.id ? 'ok' : ''}">${r === s.id ? `${ICON.check}알아들었어요` : r === 'none' ? '안 들렸어요' : `'${LING_BY[r].say}'${hasBatchim(LING_BY[r].say) ? '으로' : '로'} 들렸어요`}</span>
            <button class="icon-btn" data-ling="${s.id}" aria-label="${s.say} 다시 듣기">${ICON.speaker}</button></li>`;
        }).join('')}</ul>
        <p class="note">소리는 기기와 휴대폰 음량에 따라 달라요. 날마다 같은 음량, 같은 자리에서 하면 견주기 좋아요.</p>
      </section>
      <div class="actions">
        <button class="btn primary" data-go="#home">지도로</button>
        <button class="btn" data-go="#progress">기록 보기</button>
      </div>
    </div>`;
  let rbusy = false;
  view.querySelectorAll('[data-ling]').forEach((b) => {
    b.onclick = async () => {
      if (rbusy) return; rbusy = true; b.classList.add('busy');
      try { await playLing(LING_BY[b.dataset.ling], family); } finally { rbusy = false; b.classList.remove('busy'); }
    };
  });
}

// 기록 화면의 링 6소리 칸: 최근 14일 막대와 자주 놓친 소리
function lingPanel() {
  const ls = data.lings;
  if (!ls.length && !whoOf().ling) return '';
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const key = addDays(today(), -i);
    const on = ls.filter((x) => x.date === key);
    days.push({ key, ok: on.length ? on[on.length - 1].ok : null });
  }
  const recent = ls.slice(-7);
  const missN = {};
  for (const x of ls.slice(-14)) for (const id of x.miss) missN[id] = (missN[id] || 0) + 1;
  const top = Object.entries(missN).sort((a, b) => b[1] - a[1]).slice(0, 2);
  return `
    <section class="panel check-panel">
      <h2 class="panel-title">링 6소리 점검 <span>아·우·이·쉬·스·음</span></h2>
      ${ls.length ? `
      <div class="ling-days" role="img" aria-label="최근 14일 링 6소리 점수">${days.map((d, i) => `
        <span class="${d.ok == null ? 'none' : ''}" title="${d.key}${d.ok == null ? '' : ` ${d.ok}/6`}"><i style="height:${d.ok == null ? 0 : Math.max(8, (100 * d.ok) / 6)}%"></i><em>${i === 13 ? '오늘' : i % 2 ? +d.key.slice(8) : ''}</em></span>`).join('')}
      </div>
      <p class="note">최근 ${recent.length}번 평균 <b>${lingAvg(recent)}개</b>${top.length ? ` · 자주 놓친 소리 ${top.map(([id, n]) => `'${LING_BY[id].say}' ${n}번`).join(', ')}` : ''}. 갑자기 떨어지면 기기 점검이나 매핑이 필요할 수 있어요.</p>`
      : '<p class="note">매일 30초, 여섯 소리가 들리는지 확인해요. 인공와우는 점수가 갑자기 떨어지면 기기를 살펴보는 신호가 돼요.</p>'}
      <button class="btn block line-ico${ls.some((x) => x.date === today()) ? '' : ' primary'}" data-go="#ling">${ICON.ear}${ls.some((x) => x.date === today()) ? '한 번 더 점검하기' : '오늘 점검하기'}</button>
    </section>`;
}

/* ---------- 소리 구별(초분절) ---------- */

const SUPRA_N = 10;
const SUPRA = {
  len: { name: '짧은 말·긴 말', icon: '📏', about: '한 글자 말과 긴 말을 가려 들어요', q: '짧은 말일까요, 긴 말일까요?' },
  tune: { name: '묻는 말·대답하는 말', icon: '❓', about: '말끝이 올라가는지 내려가는지 들어요', q: '묻는 말일까요, 대답하는 말일까요?' },
  voice: { name: '남자·여자 목소리', icon: '🧑', about: '낮은 목소리와 높은 목소리를 가려 들어요', q: '누구 목소리일까요?' },
};
const supraRuns = (mode) => (data.supraRuns || []).filter((r) => r.mode === mode);
// 말끝이 올라가는 '아?'와 내려가는 '아.'를 합성한다. 처음 높이를 그때그때 바꿔 끝의 움직임으로만 가리게 한다.
function playContour(up) {
  const base = 150 + Math.random() * 50;
  const f0 = up ? (p) => base * (p < 0.45 ? 1 : 1 + 0.6 * Math.pow((p - 0.45) / 0.55, 1.5)) : (p) => base * (1.15 - 0.4 * p);
  return playBuffer(voiceBuffer(audio(), { dur: 0.75, f0, res: LING[0].f }));
}
// 한 문제: 보기 두 개(그림 포함), 정답 번호, 들려주기, 보기마다 들어 보기, 정답 설명
function supraItem(mode, labels) {
  if (mode === 'len') {
    const sets = WORD_SETS[1].filter((s) => s.some((w) => w.length === 1) && s.some((w) => w.length >= 3));
    const set = pick(sets);
    const pair = [pickHeard(set.filter((w) => w.length === 1)), pickHeard(set.filter((w) => w.length >= 3))];
    const k = Math.random() < 0.5 ? 0 : 1;
    return {
      opts: [['짧은 말', '<span class="len-bar s"></span>'], ['긴 말', '<span class="len-bar l"></span>']], right: k,
      play: () => playWord(pair[k]), plays: pair.map((w) => () => playWord(w)),
      tell: `"${esc(pair[k])}", ${pair[k].length}글자였어요.`,
    };
  }
  if (mode === 'tune') {
    const k = Math.random() < 0.5 ? 0 : 1;
    const [a, b] = labels || ['묻는 말', '대답하는 말'];
    return {
      opts: [[a, ICON.up], [b, ICON.down]], right: k,
      play: () => playContour(k === 0), plays: [() => playContour(true), () => playContour(false)],
      tell: k === 0 ? '끝이 올라가는 소리였어요. 묻는 말이 이렇게 끝나요.' : '끝이 내려가는 소리였어요. 대답하는 말이 이렇게 끝나요.',
    };
  }
  // 같은 AI 음성을 낮추거나 높여 남자·여자 목소리처럼 들려준다(app.js의 VOICE_RATE)
  const s = pickHeard([...new Set(SENTENCE_SETS[1].flat())]);
  const k = Math.random() < 0.5 ? 0 : 1;
  return {
    opts: [['남자 목소리', '👨'], ['여자 목소리', '👩']], right: k,
    play: () => playWord(s, k ? 'woman' : 'man'), plays: [() => playWord(s, 'man'), () => playWord(s, 'woman')],
    tell: `"${esc(s)}"`,
  };
}

function renderSupra() {
  setNav('home');
  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow">소리 구별</p>
      <h1>말소리의 모양을 들어요</h1>
      <p class="lead">낱말을 알아듣기 전에, 말이 짧은지 긴지, 말끝이 올라가는지, 누구 목소리인지부터 가려 들어요. 낱말 구별보다 쉬운 출발점이고, 글자를 몰라도 그림으로 골라요.</p>
    </header>
    <div class="focus-cats">${Object.entries(SUPRA).map(([k, s]) => {
      const runs = supraRuns(k); const best = runs.reduce((a, r) => Math.max(a, r.correct), 0);
      return `
      <button class="report-link focus-cat" data-go="#supra/${k}">
        <span class="cat-ico" aria-hidden="true">${s.icon}</span>
        <span><b>${s.name}</b><small>${s.about}</small>
          <small>${runs.length ? `${runs.length}번 했어요 · 가장 많이 ${best}/${SUPRA_N}` : `${SUPRA_N}문제, 2~3분`}</small></span>
      </button>`;
    }).join('')}
    </div>
    <p class="note center">지도 2장의 '소리 높낮이' 칸도 같은 방식으로 말끝을 들어요.</p>
    <button class="btn ghost block" data-go="#home">지도로</button>`;
}

async function renderSupraQuiz(mode) {
  const s = SUPRA[mode];
  const res = await runQuiz({
    back: '#supra',
    eyebrow: `소리 구별 · ${s.name}`,
    title: s.q,
    hint: `${SUPRA_N}문제예요. 보기의 그림을 보고 골라도 돼요.`,
    n: SUPRA_N,
    next: async (i, ui) => {
      const it = supraItem(mode);
      ui.setQ(s.q, replayBtn());
      $('#replay').onclick = ui.replay(it.play);
      await ui.play(it.play);
      if (!ui.alive()) return {};
      const ans = await ask(it.opts, it.right, 'two');
      const ok = ans === it.right;
      const fns = it.opts.map(([label], k) => [label, it.plays[k]]);
      ui.feedback(ok, ok ? it.tell : `정답은 ${ida(it.opts[it.right][0])}. ${it.tell}`, ok ? null : fns);
      if (!ok) await ui.replayAnswer(it.play);
      return { ok, miss: { label: it.opts[it.right][0], fns } };
    },
  });
  if (!res) return;
  data.supraRuns.push({ mode, date: today(), at: Date.now(), correct: res.correct, total: SUPRA_N, sec: res.sec });
  persist();
  view.innerHTML = `
    <div class="play result">
      <p class="eyebrow center">소리 구별 · ${s.name}</p>
      <h1 class="q">${SUPRA_N}문제 중 ${res.correct}개 맞혔어요</h1>
      <p class="lead center">${res.correct >= 8 ? '잘 가려 들어요. 다른 구별도 해 보거나 지도의 낱말 칸으로 넘어가 봐요.' : res.correct >= 6 ? '조금씩 들려요. 틀린 것을 아래에서 견줘 듣고 한 번 더 해 봐요.' : '아직 어려워요. 둘을 번갈아 여러 번 들어 보고 다시 해요.'}</p>
      ${missPanel(res.misses)}
      <div class="actions">
        <button class="btn primary" data-go="#supra/${mode}">한 번 더</button>
        <button class="btn" data-go="#supra">소리 구별로</button>
      </div>
    </div>`;
  bindMissPanel(res.misses);
}

/* ---------- 사용자 유형·듣는 귀·말 빠르기 ---------- */

function renderWho(first = false) {
  setNav('home');
  const w = WHO[data.who];
  const side = earSide();
  const earNote = data.who === 'ear2'
    ? (side ? `새 귀(${EAR_NAME[side]})로만 들어요. 다른 쪽 기기는 빼고 이어폰이나 기기 블루투스로 이어 들어요. 익숙해지면 두 귀로 바꿔 소음 속 듣기를 해요.`
      : '새로 받은 귀 쪽을 골라 주세요. 처음 몇 주는 다른 쪽 기기를 빼고 새 귀로만 들어요.')
    : '이어폰이나 보청기·인공와우 블루투스로 이어 들을 때 한쪽으로만 소리를 보낼 수 있어요. 휴대폰 스피커로는 차이가 없어요.';
  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow">${first ? '처음 설정' : '사용자 설정'}</p>
      <h1>누가 연습하나요?</h1>
      <p class="lead">고른 유형에 맞춰 시작하는 곳, 말 빠르기, 권하는 연습을 다르게 드려요. 언제든 바꿀 수 있어요.</p>
    </header>
    <div class="who-list" role="radiogroup" aria-label="사용자 유형">${Object.entries(WHO).map(([k, x]) => `
      <button class="who-card${data.who === k ? ' on' : ''}" role="radio" aria-checked="${data.who === k}" data-who="${k}">
        <span class="ch-ico" aria-hidden="true">${x.icon}</span>
        <span class="who-text"><b>${x.name}</b><small>${x.about}</small><em>${x.start}</em></span>
      </button>`).join('')}
    </div>
    ${w ? `<p class="note ahead-note">${w.tip}</p>` : ''}
    <section class="panel">
      <h2 class="panel-title">듣는 귀</h2>
      <div class="seg" role="radiogroup" aria-label="듣는 귀">${['L', 'both', 'R'].map((x) => `
        <button class="seg-btn${data.ear === x ? ' on' : ''}" role="radio" aria-checked="${data.ear === x}" data-ear="${x}">${x === 'both' ? '두 귀' : `${EAR_NAME[x].slice(0, 2)}만`}</button>`).join('')}</div>
      <p class="note${data.who === 'ear2' && !side ? ' warn' : ''}">${earNote}${side && !Object.keys(voicePack).length ? ' 기기 음성으로 나오는 말은 한쪽으로 보낼 수 없어요.' : ''}</p>
      <button class="pill" id="ear-test">${ICON.speaker}소리 확인</button>
    </section>
    <section class="panel">
      <h2 class="panel-title">말 빠르기</h2>
      <div class="seg" role="radiogroup" aria-label="말 빠르기">${SPEEDS.map(([v, label]) => `
        <button class="seg-btn${talkRate() === v ? ' on' : ''}" role="radio" aria-checked="${talkRate() === v}" data-speed="${v}">${label}</button>`).join('')}</div>
      <p class="note">문제의 말소리 빠르기예요. 월간 점검과 소음 기록은 늘 같은 조건으로 견주려고 보통 빠르기로 들려드려요.</p>
      <button class="pill" id="speed-test">${ICON.speaker}들어 보기</button>
    </section>
    <p class="note">유형별 시작 단계와 빠르기는 청각 재활에서 일반적으로 알려진 원칙이에요. 담당 청능사·이비인후과 선생님 의견이 다르면 그에 맞춰 바꿔 주세요.</p>
    <button class="btn primary block" id="who-done" ${first && !w ? 'disabled' : ''}>${first ? '이대로 시작하기' : '다 됐어요'}</button>
    ${first ? '<button class="btn ghost block" id="who-skip">나중에 고를게요</button>' : ''}`;
  view.querySelectorAll('[data-who]').forEach((b) => {
    b.onclick = () => { data.who = b.dataset.who; data.talkSpeed = WHO[data.who].speed; persist(); renderWho(first); };
  });
  view.querySelectorAll('[data-ear]').forEach((b) => { b.onclick = () => { data.ear = b.dataset.ear; persist(); renderWho(first); }; });
  view.querySelectorAll('[data-speed]').forEach((b) => { b.onclick = () => { data.talkSpeed = +b.dataset.speed; persist(); renderWho(first); }; });
  let busy = false;
  const test = (fn) => async () => { if (busy) return; busy = true; unlockAudio(); try { await fn(); } finally { busy = false; } };
  $('#ear-test').onclick = test(async () => {
    toast(earSide() ? `${EAR_NAME[data.ear]}에서만 들리면 맞아요.` : '두 귀 모두에서 들리면 맞아요.');
    await playEnv('doorbell'); await playWord('안녕하세요');
  });
  $('#speed-test').onclick = test(() => playWord('천천히 말해 주세요'));
  $('#who-done').onclick = () => { if (first && w) toast(`${w.name}에 맞췄어요.`); go('#home'); };
  if (first) $('#who-skip').onclick = () => { data.who = 'none'; persist(); go('#home'); };
}

// 집 화면: 유형에 맞춰 권하는 연습
function fitCard() {
  const w = WHO[data.who];
  if (!w) return '';
  const lv = (cat) => nextLevel(cat);
  const picks = {
    ha: [['#cell/3-1', ICON.target, '첫소리만 다른 낱말', 'ㅅ·ㅆ, ㅈ·ㅊ처럼 비슷한 자음 가려 듣기'],
      [`#focus/sound/${lv('sound')}`, ICON.target, `낱소리 ${lv('sound')}단계`, '받침과 높은 자음을 짧게 집중'],
      ['#noise', ICON.wave, '1분 소음 기록', '시끄러운 곳 듣기를 일찍 시작해요']],
    ci: [['#ling', ICON.ear, '링 6소리', '매일 30초, 기기가 잘 되는지 확인'],
      ['#supra', ICON.shape, '소리 구별', '길이·말끝·목소리부터 익숙해지기'],
      [`#focus/word/${lv('word')}`, ICON.target, `단어 ${lv('word')}단계`, '집중 연습은 낮은 단계부터']],
    kid: [['#ling', ICON.ear, '링 6소리', '그림을 같이 짚으며 매일 30초'],
      ['#supra/len', ICON.shape, '짧은 말·긴 말', '글자 없이 막대 그림으로 골라요'],
      ['#voices', ICON.mic, '가족 목소리 녹음', '엄마·아빠 목소리로 들으면 더 좋아요']],
    ear2: [['#ling', ICON.ear, `링 6소리${earSide() ? ` · ${EAR_NAME[data.ear]}` : ''}`, '새 귀로만 매일 30초'],
      [`#focus/word/${lv('word')}`, ICON.target, `단어 ${lv('word')}단계`, '새 귀로 낮은 단계부터'],
      ['#ch/5', ICON.wave, '두 귀로 소음 속 듣기', '새 귀가 익숙해지면 두 귀로 바꿔서']],
  }[data.who];
  return `
    <section class="panel fit-card">
      <div class="focus-head">
        <span class="focus-ico" aria-hidden="true">${w.icon}</span>
        <div><h2 class="panel-title">${w.name}에 맞춘 연습 <button class="link-btn" data-go="#who">바꾸기</button></h2><p class="note">${w.tip}</p></div>
      </div>
      ${data.who === 'ear2' && !earSide() ? '<button class="report-link warn-link" data-go="#who"><span><b>듣는 귀를 새 귀로 정해 주세요</b><small>소리를 새 귀 쪽으로만 보내요</small></span></button>' : ''}
      <ul class="fit-links">${picks.map(([go, ico, b, small]) => `
        <li><button data-go="${go}"><span class="fit-ico" aria-hidden="true">${ico}</span><span><b>${b}</b><small>${small}</small></span></button></li>`).join('')}
      </ul>
    </section>`;
}
// 집 화면: 링 6소리를 매일 권하는 유형이면 오늘 아직 안 했을 때 알리고, 최근 점검이 갑자기 떨어졌으면 먼저 보여 준다
function lingHome() {
  const drop = lingDrop();
  if (drop && daysSince(drop.date) <= 1) return lingAlert(drop);
  if (!whoOf().ling || data.lings.some((x) => x.date === today())) return '';
  return `
    <button class="report-link ling-link" data-go="#ling">
      <span class="focus-ico">${ICON.ear}</span>
      <span><b>오늘의 링 6소리</b><small>아·우·이·쉬·스·음이 잘 들리는지 30초 확인해요${earSide() ? ` · ${EAR_NAME[data.ear]}` : ''}</small></span>
    </button>`;
}

/* ---------- 기기 조절 일지 ---------- */

const MAP_KIND = { map: '매핑(인공와우 조절)', ha: '보청기 조절', on: '기기 처음 켬', etc: '그 밖의 변화' };
const MAP_DID = { map: '매핑(인공와우 조절)을 받았어요', ha: '보청기를 조절했어요', on: '기기를 처음 켰어요', etc: '기기에 변화가 있었어요' };
// 조절한 날 전 7일과 그날부터 7일 동안의 하루 정답률(칸 판)과 링 6소리 평균
function mapEffect(m, d = data) {
  const win = (from, to) => ({
    acc: accOf((d.sessions || []).filter((s) => s.date >= from && s.date <= to)),
    ling: lingAvg((d.lings || []).filter((x) => x.date >= from && x.date <= to)),
  });
  return { before: win(addDays(m.date, -7), addDays(m.date, -1)), after: win(m.date, addDays(m.date, 6)) };
}
const effText = (w) => [w.acc == null ? '' : `정답률 ${w.acc}%`, w.ling == null ? '' : `링 ${w.ling}개`].filter(Boolean).join(' · ') || '기록 없음';

let mapDraft = null; // 다시 그려도 적던 값을 둔다
function renderMaps() {
  setNav('progress');
  const f = mapDraft || (mapDraft = { date: today(), kind: data.who === 'ha' ? 'ha' : 'map', ear: data.ear, memo: '' });
  const list = [...data.maps].sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow"><button class="link-btn" data-go="#progress">기록</button> · 기기 조절 일지</p>
      <h1>기기를 조절한 날을 적어요</h1>
      <p class="lead">인공와우 매핑이나 보청기 조절을 받은 날을 적어 두면, 그 전 7일과 뒤 7일의 정답률과 링 6소리를 견줘 리포트에 보여 드려요.</p>
    </header>
    <section class="panel">
      <h2 class="panel-title">새로 적기</h2>
      <label class="field">날짜 <input id="m-date" type="date" value="${f.date}" max="${today()}"></label>
      <p class="field-label">무엇을 했나요</p>
      <div class="seg kind-seg">${Object.entries(MAP_KIND).map(([k, v]) => `<button class="seg-btn${f.kind === k ? ' on' : ''}" data-kind="${k}">${v}</button>`).join('')}</div>
      <p class="field-label">어느 귀</p>
      <div class="seg">${['L', 'both', 'R'].map((x) => `<button class="seg-btn${f.ear === x ? ' on' : ''}" data-mear="${x}">${EAR_NAME[x]}</button>`).join('')}</div>
      <label class="field">메모 <textarea id="m-memo" rows="2" maxlength="120" placeholder="예: 소리를 조금 키움, 새 프로그램 추가">${esc(f.memo)}</textarea></label>
      <button class="btn primary block" id="m-add">${ICON.check}적기</button>
    </section>
    ${list.length ? `
    <section class="panel">
      <h2 class="panel-title">적은 날 <span>전 7일 → 뒤 7일</span></h2>
      <ul class="miss-rows map-rows">${list.map((m) => {
        const e = mapEffect(m); const going = daysSince(m.date) < 6;
        return `
        <li><span class="miss-a">${shortDate(m.date)} · ${MAP_KIND[m.kind] || ''}<small>${EAR_NAME[m.ear] || ''}${m.memo ? ` · ${esc(m.memo)}` : ''}</small></span>
          <span class="then-now"><span>전: <b>${effText(e.before)}</b></span><span>뒤: <b>${effText(e.after)}</b>${going ? ` <small>(${daysSince(m.date) + 1}일째)</small>` : ''}</span></span>
          <span class="miss-btns"><button class="pill alt" data-del="${m.at}">${ICON.trash}지우기</button></span></li>`;
      }).join('')}</ul>
      <p class="note">정답률은 그동안 한 칸 판을 모두 모은 것이라 연습한 칸이 바뀌면 함께 달라져요. 링 6소리는 늘 같은 소리라 견주기 좋아요.</p>
    </section>` : ''}
    <button class="btn ghost block" data-go="#progress">기록으로</button>`;
  view.querySelectorAll('[data-kind]').forEach((b) => { b.onclick = () => { f.kind = b.dataset.kind; renderMaps(); }; });
  view.querySelectorAll('[data-mear]').forEach((b) => { b.onclick = () => { f.ear = b.dataset.mear; renderMaps(); }; });
  $('#m-date').onchange = (e) => { f.date = e.target.value; };
  $('#m-memo').oninput = (e) => { f.memo = e.target.value; };
  $('#m-add').onclick = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || f.date > today()) { toast('오늘이나 지난 날짜를 골라 주세요.'); return; }
    data.maps.push({ date: f.date, at: Date.now(), kind: f.kind, ear: f.ear, memo: f.memo.trim().slice(0, 120) });
    persist(); mapDraft = null; renderMaps(); toast('적었어요. 리포트에 전후 변화가 나와요.');
  };
  view.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => {
      if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.lastChild.textContent = '한 번 더 누르면 지워요'; b.classList.add('danger'); return; }
      data.maps = data.maps.filter((m) => String(m.at) !== b.dataset.del); persist(); renderMaps();
    };
  });
}
