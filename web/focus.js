'use strict';
/*
 * 집중 연습과 단어장.
 * - 집중 연습: 단어·낱소리·문장을 따로 모아 1~10단계로 나눈다. 단계마다 미리 들어 보는 연습과 20문제 도전이 있다.
 *   20문제 중 12개 이상이면 통과, 12~15개 C, 16~18개 B, 19~20개 A.
 *   단어·낱소리: 1~5번 두 말이 같은지, 6~10번 화면의 말과 들린 말이 같은지, 11~15번 둘 중 고르기, 16~20번 넷 중 고르기.
 *   문장: 1~4번 화면의 문장과 같은지(O·X), 5~8번 둘 중, 9~12번 넷 중, 13~16번 빈칸 하나(보기 4개), 17~20번 빈칸 2~3개(빈칸마다 보기 3개).
 * - 단어장: 상황·장소별 낱말을 눌러 듣고, 장마다 10문제로 풀어 본다.
 * - 문제로 나온 말마다 맞힌 횟수를 모아(data.itemStats) 틀렸을 때와 단어장에 정답률로 보여 준다.
 * - 소음 모드를 켜면 연습과 문제 모두 고른 장소 소음을 깔고 들려준다.
 * app.js보다 먼저 읽히므로, app.js의 것은 함수 안에서만 쓴다.
 */

const FOCUS_N = 20;
const FOCUS_PASS = 12;
const VOCAB_N = 10;
const VOCAB_SNR = 6;
const FOCUS_SNR = [0, 12, 12, 10, 10, 8, 6, 6, 4, 2, 0];                      // 소음 모드: 말소리가 소음보다 큰 정도(dB)
const FOCUS_SPEED = [0, 1, 1, 1, 1, 1.05, 1.1, 1.1, 1.15, 1.2, 1.25];        // 문장 빠르기(뒤 단계일수록 빠르게)
const gradeOf = (n) => (n >= 19 ? 'A' : n >= 16 ? 'B' : n >= FOCUS_PASS ? 'C' : null);

const FOCUS_CATS = {
  word: {
    name: '단어', icon: '🔤', about: '낱말을 듣고 구별해요',
    desc: ['', '글자 수가 크게 다른 낱말', '글자 수가 크게 다른 낱말', '세 글자 낱말', '두 글자 낱말', '첫 글자가 같은 낱말',
      '끝 글자가 같은 낱말', '한 소리만 다른 낱말', '예사소리·된소리·거센소리', '받침과 모음이 다른 낱말', '거의 같게 들리는 두 글자'],
    sets: (lv) => FOCUS_WORDS[lv],
  },
  sound: {
    name: '낱소리', icon: '🔉', about: '가·까·카처럼 짧은 소리를 구별해요',
    desc: ['', '모음이 크게 다른 소리', '첫소리가 크게 다른 소리', '비슷한 모음', "'아나·아다'처럼 가운데 소리", '입술·잇몸·입천장 소리',
      '가운데 소리가 나는 자리', 'ㅓ·ㅗ·ㅡ·ㅜ', '가·까·카', '아가·아까·아카', '받침 ㄴ·ㅁ·ㅇ·ㄹ'],
    sets: (lv) => FOCUS_SOUNDS[lv],
  },
  sent: {
    name: '문장', icon: '💬', about: '생활 문장을 듣고 알아들어요',
    desc: ['', '짧은 생활 문장', '짧은 생활 문장', '조금 긴 문장', '조금 긴 문장', '긴 문장 · 조금 빠르게',
      '긴 문장 · 조금 빠르게', '긴 문장 · 조금 빠르게', '어려운 낱말 · 빠르게', '어려운 낱말 · 빠르게', '어려운 낱말 · 더 빠르게'],
  },
};
const QTYPES = {
  word: [['same', 5, '두 말이 같은지'], ['shown', 5, '화면의 말과 들린 말이 같은지'], ['two', 5, '둘 중 고르기'], ['four', 5, '넷 중 고르기']],
  sent: [['ox', 4, '화면의 문장과 같은지 O·X'], ['two', 4, '두 문장 중 고르기'], ['four', 4, '네 문장 중 고르기'], ['blank', 4, '빈칸 하나 채우기'], ['blanks', 4, '빈칸 여러 개 채우기']],
};
const qTypeAt = (cat, i) => {
  let k = i;
  for (const [t, n] of QTYPES[cat === 'sent' ? 'sent' : 'word']) { if (k < n) return t; k -= n; }
  return 'four';
};

/* ---------- 기록 ---------- */

// 문제로 나온 말마다 [나온 횟수, 맞힌 횟수]
function logItem(text, ok) {
  if (!data.itemStats) data.itemStats = {};
  const s = data.itemStats[text] || [0, 0];
  data.itemStats[text] = [s[0] + 1, s[1] + (ok ? 1 : 0)];
}
const itemRate = (text) => {
  const s = (data.itemStats || {})[text];
  return s && s[0] ? { n: s[0], ok: s[1], pct: Math.round((100 * s[1]) / s[0]) } : null;
};
const rateLine = (text) => {
  const r = itemRate(text);
  return r ? `지금까지 정답률 ${r.pct}% (${r.n}번 중 ${r.ok}번)` : '';
};
const focusRuns = (cat, lv) => (data.focusRuns || []).filter((r) => r.cat === cat && (lv == null || r.lv === lv));
const bestRun = (cat, lv) => focusRuns(cat, lv).reduce((b, r) => (!b || r.correct > b.correct ? r : b), null);
const levelPassed = (cat, lv) => focusRuns(cat, lv).some((r) => r.correct >= FOCUS_PASS);
// 권하는 단계: 사용자 유형의 시작 단계부터 아직 넘지 못한 첫 단계. 그 단계에서 두 번 연달아 절반도 못 맞혔으면
// 한 단계 아래를 한 번 권한다(정답률이 50% 아래로 자주 떨어지면 지쳐서 그만두기 쉽다).
const nextLevel = (cat) => {
  let lv = whoOf().focus[cat] || 1;
  while (lv < 10 && levelPassed(cat, lv)) lv++;
  const recent = focusRuns(cat).slice(-2);
  if (lv > 1 && recent.length === 2 && recent.every((r) => r.lv === lv && r.correct < FOCUS_N / 2)) return lv - 1;
  return lv;
};
const noiseCfg = () => data.focusNoise || (data.focusNoise = { on: false, scene: 'cafe' });

/* ---------- 소리 ---------- */

const sayAt = (speed) => (t) => playWord(t, undefined, speed);
// 소음 모드면 장소 소음을 깔고 fn()을 들려준다
const withFocusNoise = (snr, fn) => (noiseCfg().on ? withNoise(noiseCfg().scene, snr, fn) : fn());

/* ---------- 공통 부품 ---------- */

function noisePanel(snr) {
  const nz = noiseCfg();
  return `
    <section class="panel noise-set">
      <label class="switch" for="fnoise">
        <input type="checkbox" id="fnoise" ${nz.on ? 'checked' : ''}>
        <span class="switch-ui" aria-hidden="true"></span>
        <span><b>소음 모드</b> <small class="note">말소리가 소음보다 ${snrText(snr)} 커요</small></span>
      </label>
      <div class="seg scene-seg" id="fscene" ${nz.on ? '' : 'hidden'}>${Object.entries(SCENE_NAME).map(([k, v]) =>
        `<button class="seg-btn${k === nz.scene ? ' on' : ''}" data-k="${k}">${v}</button>`).join('')}</div>
    </section>`;
}
function bindNoisePanel() {
  const nz = noiseCfg();
  const box = $('#fscene');
  $('#fnoise').onchange = (e) => { nz.on = e.target.checked; box.hidden = !nz.on; persist(); };
  box.querySelectorAll('.seg-btn').forEach((b) => {
    b.onclick = () => { nz.scene = b.dataset.k; persist(); box.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('on', x === b)); };
  });
}
// 눌러서 듣는 버튼. 한 번에 하나만 나게 한다.
let tapBusy = false;
function bindTapPlay(root, play) {
  root.querySelectorAll('[data-say]').forEach((b) => {
    b.onclick = async () => {
      if (tapBusy) return;
      tapBusy = true; b.classList.add('busy'); unlockAudio();
      try { await play(b.dataset.say); } finally { tapBusy = false; b.classList.remove('busy'); }
    };
  });
}
const rateChip = (text) => { const r = itemRate(text); return `<small class="rate${r ? (r.pct >= 80 ? ' hi' : r.pct < 50 ? ' lo' : '') : ''}">${r ? `${r.pct}%` : '–'}</small>`; };

/* ---------- 집중 연습 화면 ---------- */

function renderFocusHome() {
  setNav('home');
  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow">집중 연습</p>
      <h1>골라서 집중해요</h1>
      <p class="lead">단어·낱소리·문장을 따로 1~10단계로 연습해요. 단계마다 미리 들어 보고, 20문제에 도전해요.</p>
    </header>
    <div class="focus-cats">${Object.entries(FOCUS_CATS).map(([k, c]) => {
      const passed = [...Array(10)].filter((_, i) => levelPassed(k, i + 1)).length;
      return `
      <button class="report-link focus-cat" data-go="#focus/${k}">
        <span class="cat-ico" aria-hidden="true">${c.icon}</span>
        <span><b>${c.name}</b><small>${c.about}</small>
          <span class="ch-bar" aria-hidden="true"><i style="width:${passed * 10}%"></i></span>
          <small>${passed ? `10단계 중 ${passed}단계 통과 · 다음은 ${nextLevel(k)}단계` : `${nextLevel(k)}단계부터 시작해요`}</small></span>
      </button>`;
    }).join('')}
    </div>
    <button class="report-link speak-link" data-go="#vocab">
      <span class="focus-ico">${ICON.doc}</span>
      <span><b>단어장</b><small>장소별 낱말을 눌러 듣고 틈틈이 풀어 봐요</small></span>
    </button>
    <p class="note center">단계: 1~2 왕초보 · 3~4 초보 · 5~7 중급 · 8~9 고수 · 10 초고수${whoOf().name ? `<br>${whoOf().name}에 맞춰 권하는 단계부터 보여 드려요.` : ''}</p>`;
}

function renderFocusCat(cat) {
  setNav('home');
  const c = FOCUS_CATS[cat];
  const rec = nextLevel(cat);
  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow"><button class="link-btn" data-go="#focus">집중 연습</button> · ${c.name}</p>
      <h1>${c.icon} ${c.name} 1~10단계</h1>
      <p class="lead">${c.about}. 20문제 중 12개 이상 맞히면 통과예요.</p>
    </header>
    <ol class="cell-list">${[...Array(10)].map((_, i) => {
      const lv = i + 1; const best = bestRun(cat, lv); const passed = levelPassed(cat, lv);
      const g = best && gradeOf(best.correct);
      return `
      <li class="cell-row ${passed ? 'done' : ''}${lv === rec && !passed ? ' now' : ''}">
        <span class="cell-id">${lv}</span>
        <span class="cell-text"><b>${lv}단계 <i class="tag">${FOCUS_TIERS[lv]}</i></b><small>${c.desc[lv]}</small>
          <em>${best ? `최고 ${best.correct}/${FOCUS_N}${g ? ` · ${g}등급` : ''}` : lv === rec ? '여기부터 해 보세요' : lv < (whoOf().focus[cat] || 1) ? '건너뛰어도 되는 단계' : '아직 도전 전'}</em></span>
        ${g ? `<span class="grade g${g}" aria-label="${g}등급">${g}</span>` : ''}
        <button class="icon-btn play-btn" data-go="#focus/${cat}/${lv}" aria-label="${lv}단계 열기">${ICON.play}</button>
      </li>`;
    }).join('')}
    </ol>`;
}

function renderFocusLevel(cat, lv) {
  setNav('home');
  const c = FOCUS_CATS[cat];
  const best = bestRun(cat, lv); const g = best && gradeOf(best.correct);
  const sp = cat === 'sent' ? FOCUS_SPEED[lv] : 1;
  const say = sayAt(sp);
  let practice;
  if (cat === 'sent') {
    practice = FOCUS_SENTENCES[lv].map((it) => `
        <ul class="say-list">${focusVariants(it).map((p) => { const t = focusSay(it, p); return `
          <li><button class="say-row" data-say="${esc(t)}">${ICON.speaker}<span>${esc(t)}</span>${rateChip(t)}</button></li>`; }).join('')}
        </ul>`).join('');
  } else {
    practice = `<div class="tile-sets">${c.sets(lv).map((set) => `
        <div class="tile-row">${set.map((w) => `<button class="tile" data-say="${esc(w)}"><span>${esc(w)}</span>${rateChip(w)}</button>`).join('')}</div>`).join('')}
      </div>`;
  }
  const types = QTYPES[cat === 'sent' ? 'sent' : 'word'];
  let from = 1;
  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow"><button class="link-btn" data-go="#focus/${cat}">${c.name}</button> · ${lv}단계 · ${FOCUS_TIERS[lv]}</p>
      <h1>${c.desc[lv]}</h1>
      ${sp !== 1 ? `<p class="lead">말 빠르기 ${sp}배</p>` : ''}
    </header>
    <section class="panel">
      <h2 class="panel-title">연습 <span>눌러서 미리 들어 보기</span></h2>
      <p class="note">숫자는 지금까지 문제로 나왔을 때 맞힌 비율이에요.</p>
      ${practice}
    </section>
    <section class="panel challenge">
      <h2 class="panel-title">도전 <span>${FOCUS_N}문제</span></h2>
      <ol class="qtype-list">${types.map(([, n, label]) => { const t = `<li><b>${from}~${from + n - 1}번</b> ${label}</li>`; from += n; return t; }).join('')}</ol>
      <p class="note">12개 이상 맞히면 통과예요. 12~15개 C, 16~18개 B, 19~20개 A등급.</p>
      ${best ? `<p class="best-line">최고 기록 <b>${best.correct}/${FOCUS_N}</b>${g ? ` <span class="grade g${g}">${g}</span>` : ''} · ${focusRuns(cat, lv).length}번 도전</p>` : ''}
    </section>
    ${noisePanel(FOCUS_SNR[lv])}
    <button class="btn primary block" data-go="#focus/${cat}/${lv}/go">도전 시작</button>
    <div class="actions two">
      ${lv > 1 ? `<button class="btn" data-go="#focus/${cat}/${lv - 1}">← ${lv - 1}단계</button>` : '<span></span>'}
      ${lv < 10 ? `<button class="btn" data-go="#focus/${cat}/${lv + 1}">${lv + 1}단계 →</button>` : '<span></span>'}
    </div>`;
  bindNoisePanel();
  bindTapPlay(view, (t) => withFocusNoise(FOCUS_SNR[lv], () => say(t)));
}

/* ---------- 문제 풀기 틀 ---------- */

// n문제를 차례로 낸다. next(i, ui)는 문제 하나를 내고 { ok, text, miss }를 돌려준다.
async function runQuiz({ back, eyebrow, title, hint, n, next }) {
  setNav('play');
  const token = ++playToken;
  const alive = () => token === playToken;
  const extra = !canSpeak() ? '<p class="note warn center">이 화면에서는 AI 음성이 나오지 않아요. 크롬이나 삼성 인터넷 같은 브라우저에서 열어 주세요.</p>' : '';
  view.innerHTML = playShell(back, eyebrow, title, hint, startBox(false, extra));
  $('#pnum').textContent = `${n}문제`;
  await waitStart(false, alive);
  if (!alive()) return null;
  const startedAt = Date.now();
  const orb = $('#orb');
  let busy = false;
  const ui = {
    alive,
    setQ(q, h = '', cls = '') { const el = $('#q'); el.textContent = q; el.className = `q ${cls}`; $('#hint').innerHTML = h; },
    async play(fn) { busy = true; orb.className = 'orb playing'; try { return await fn(); } finally { busy = false; if (alive()) orb.className = 'orb idle'; } },
    replay(fn) { return () => { if (!busy) ui.play(fn); }; },
    // compare: 틀렸을 때 견줘 들어 볼 버튼 [[이름, 재생 함수], ...]
    feedback(ok, text, compare) {
      const sh = $('#sheet');
      sh.className = `sheet ${ok ? 'good' : 'bad'}`;
      sh.querySelector('.sheet-icon').innerHTML = ok ? ICON.check : ICON.x;
      $('#sheet-title').textContent = ok ? '잘 들으셨어요!' : '괜찮아요';
      $('#sheet-text').innerHTML = text;
      const cmp = $('#compare');
      cmp.innerHTML = compare ? compare.map(([label], i) => `<button class="pill" data-k="${i}">${ICON.speaker}${esc(label)}</button>`).join('') : '';
      cmp.hidden = !compare;
      cmp.querySelectorAll('button').forEach((b) => { b.onclick = ui.replay(compare[+b.dataset.k][1]); });
      sh.hidden = false;
    },
    // 틀리면 정답을 소음 없이 한 번 더 들려준다. 그동안 '다음'을 잠근다.
    async replayAnswer(fn) {
      const btn = $('#next');
      btn.disabled = true;
      try { await ui.play(fn); } finally { btn.disabled = false; }
    },
  };
  const misses = [];
  let correct = 0;
  for (let i = 0; i < n && alive(); i++) {
    $('#pnum').textContent = `${i + 1}번째 / ${n}문제`;
    $('#pbar').style.width = `${(100 * i) / n}%`;
    $('#answers').innerHTML = '';
    const r = await next(i, ui);
    if (!alive()) return null;
    if (r.ok) correct++; else if (r.miss) misses.push(r.miss);
    const btn = $('#next');
    btn.textContent = i === n - 1 ? '결과 보기' : '다음';
    btn.focus({ preventScroll: true });
    await new Promise((res) => { btn.onclick = () => { $('#sheet').hidden = true; res(); }; });
  }
  if (!alive()) return null;
  return { correct, misses, sec: Math.round((Date.now() - startedAt) / 1000) };
}

// 결과 화면 공통: 틀린 문제 다시 듣기
function missPanel(misses) {
  if (!misses.length) return '';
  return `
      <section class="panel miss-panel">
        <h2 class="panel-title">틀린 문제 다시 듣기</h2>
        <ul class="miss-rows">${misses.map((m, i) => `
          <li><span class="miss-a">${esc(m.label)}</span>
            <span class="miss-btns">${m.fns.map(([name], k) => `<button class="pill${k ? ' alt' : ''}" data-m="${i}" data-k="${k}">${ICON.speaker}${esc(name)}</button>`).join('')}</span></li>`).join('')}
        </ul>
      </section>`;
}
function bindMissPanel(misses) {
  let rbusy = false;
  view.querySelectorAll('[data-m]').forEach((b) => {
    b.onclick = async () => {
      if (rbusy) return; rbusy = true; b.classList.add('busy');
      try { await misses[+b.dataset.m].fns[+b.dataset.k][1](); } finally { rbusy = false; b.classList.remove('busy'); }
    };
  });
}
const quoted = (t) => `"${esc(t)}"`;
const was = (t) => `${quoted(t)}${hasBatchim(t) ? '이었어요' : '였어요'}`;   // "기린"이었어요
const isIt = (t) => `${quoted(t)}${hasBatchim(t) ? '이에요' : '예요'}`;   // "기린"이에요

/* ---------- 단어·낱소리 문제 ---------- */

// 같은 말이 너무 자주 나오지 않게, 아직 안 나온 묶음과 말을 먼저 고른다
function picker(groups) {
  const usedSet = new Map(); const usedWord = new Set();
  return {
    set() {
      const least = Math.min(...groups.map((g) => usedSet.get(g) || 0));
      const g = pick(groups.filter((x) => (usedSet.get(x) || 0) === least));
      usedSet.set(g, (usedSet.get(g) || 0) + 1);
      return g;
    },
    target(cands) {
      const fresh = cands.filter((w) => !usedWord.has(w));
      const t = pick(fresh.length ? fresh : cands);
      usedWord.add(t);
      return t;
    },
  };
}

function wordQuestion(type, pk, say, snr, isSound) {
  const listen = (fn) => withFocusNoise(snr, fn);
  const layout = (opts) => (opts.some((w) => w.length > 4) ? 'sentences' : 'words');
  const what = isSound ? '소리' : '말';
  return async (i, ui) => {
    const set = pk.set();
    if (type === 'same' || type === 'shown') {
      const a = pk.target(set);
      const b = pick(set.filter((x) => x !== a));
      const same = Math.random() < 0.5;
      const heard = same ? a : b;
      let play;
      if (type === 'same') {
        play = () => listen(async () => { await say(a); await wait(700); await say(heard); });
        ui.setQ(`두 ${josa(what, '이', '가')} 같을까요, 다를까요?`, replayBtn());
      } else {
        play = () => listen(() => say(heard));
        ui.setQ(a, `<span class="src">${josa(`화면의 ${what}`, '과', '와')} 들리는 ${josa(what, '이', '가')} 같을까요?</span>${replayBtn()}`, 'shown');
      }
      $('#replay').onclick = ui.replay(play);
      await ui.play(play);
      if (!ui.alive()) return {};
      const ans = await ask([['같아요', ICON.check], ['달라요', ICON.x]], same ? 0 : 1, 'two');
      const ok = (ans === 0) === same;
      logItem(heard, ok);
      const told = type === 'same'
        ? (same ? `두 번 모두 ${was(a)}.` : `처음은 ${quoted(a)}, 다음은 ${was(b)}.`)
        : (same ? `화면과 같은 ${was(a)}.` : `화면은 ${quoted(a)}, 들린 ${josa(what, '은', '는')} ${was(b)}.`);
      const rate = rateLine(heard);
      const fns = same ? [[a, () => say(a)]] : [[a, () => say(a)], [b, () => say(b)]];
      ui.feedback(ok, `${told}${!ok && rate ? ` <span class="why">${quoted(heard)} ${rate}</span>` : ''}`, ok ? null : fns);
      if (!ok) await ui.replayAnswer(fns[fns.length - 1][1]);
      return { ok, miss: { label: same ? `${a} = ${a}` : `${a} ≠ ${b}`, fns } };
    }
    const opts = type === 'two' ? shuffle(set).slice(0, 2) : shuffle(set);
    const target = pk.target(opts);
    const play = () => listen(() => say(target));
    ui.setQ(`어떤 ${josa(what, '을', '를')} 들었나요?`, replayBtn());
    $('#replay').onclick = ui.replay(play);
    await ui.play(play);
    if (!ui.alive()) return {};
    const ans = await ask(opts.map((w) => [w]), opts.indexOf(target), `${layout(opts)}${type === 'two' ? ' two' : ''}`);
    const ok = opts[ans] === target;
    logItem(target, ok);
    if (!ok) for (const x of contrasts(target, opts[ans])) if (x !== '단어 길이') data.confusions[x] = (data.confusions[x] || 0) + 1;
    const why = ok ? '' : contrasts(target, opts[ans]).filter((x) => x !== '단어 길이').map(friendly).join(', ');
    const rate = rateLine(target);
    const fns = [[`정답: ${target}`, () => say(target)], [`고른 것: ${opts[ans]}`, () => say(opts[ans])]];
    ui.feedback(ok, ok ? `${was(target)}.` : `정답은 ${isIt(target)}.${why ? ` <span class="why">${esc(why)}</span>` : ''}${rate ? ` <span class="why">${rate}</span>` : ''}`, ok ? null : fns);
    if (!ok) await ui.replayAnswer(fns[0][1]);
    return { ok, miss: { label: target, fns } };
  };
}

/* ---------- 문장 문제 ---------- */

const CIRCLED = ['①', '②', '③'];
// 빈칸 자리는 ①＿＿ 처럼, 나머지 자리는 들려준 낱말로 채운 문장
const blankText = (it, p, blanks) => {
  let k = 0;
  return it.s.replace(/\{(\d)\}/g, (_, j) => (blanks.includes(+j) ? `${blanks.length > 1 ? CIRCLED[k++] : ''}＿＿` : it.o[j][p[j]]));
};

function sentQuestion(type, pk, say, snr) {
  const listen = (fn) => withFocusNoise(snr, fn);
  return async (i, ui) => {
    const it = pk.set();
    const vs = focusVariants(it);
    const texts = vs.map((p) => focusSay(it, p));
    let target; let opts; let ok; let ans; let fns; let text;
    const startListen = async (q, h, cls) => {
      const play = () => listen(() => say(target));
      ui.setQ(q, `${h}${replayBtn()}`, cls);
      $('#replay').onclick = ui.replay(play);
      await ui.play(play);
      return ui.alive();
    };
    if (type === 'ox') {
      const shown = pk.target(texts);
      const other = pick(texts.filter((x) => x !== shown));
      const same = Math.random() < 0.5;
      target = same ? shown : other;
      if (!await startListen(shown, '<span class="src">들리는 문장이 화면과 같으면 O, 다르면 X</span>', 'shown sent')) return {};
      ans = await ask([['O 같아요', ICON.check], ['X 달라요', ICON.x]], same ? 0 : 1, 'two');
      ok = (ans === 0) === same;
      fns = [['들린 문장', () => say(target)], ...(same ? [] : [['화면의 문장', () => say(shown)]])];
      text = same ? '화면과 같은 문장이었어요.' : `화면과 다른 문장이었어요. 들린 문장: ${quoted(target)}`;
    } else if (type === 'two' || type === 'four') {
      opts = type === 'two' ? shuffle(texts).slice(0, 2) : shuffle(texts);
      target = pk.target(opts);
      if (!await startListen('어떤 문장을 들었나요?', '')) return {};
      ans = await ask(opts.map((t) => [t]), opts.indexOf(target), 'sentences');
      ok = opts[ans] === target;
      fns = [['정답 문장', () => say(target)], ['고른 문장', () => say(opts[ans])]];
      text = ok ? quoted(target) : `들린 문장: ${quoted(target)}`;
    } else {
      const p = pick(vs);
      target = focusSay(it, p);
      const slots = it.o.map((_, k) => k);
      const blanks = type === 'blank' ? [pick(slots)] : slots.slice(0, 3);
      if (!await startListen(blankText(it, p, blanks), `<span class="src">${type === 'blank' ? '빈칸에 들어갈 낱말을 골라 주세요' : '빈칸마다 들린 낱말을 골라 주세요'}</span>`, 'shown sent')) return {};
      if (type === 'blank') {
        const k = blanks[0]; const right = it.o[k][p[k]];
        opts = shuffle(it.o[k]);
        ans = await ask(opts.map((w) => [w]), opts.indexOf(right), opts.some((w) => w.length > 4) ? 'sentences' : '');
        ok = opts[ans] === right;
        if (!ok) for (const x of contrasts(right, opts[ans])) if (x !== '단어 길이') data.confusions[x] = (data.confusions[x] || 0) + 1;
        text = ok ? quoted(target) : `빈칸은 ${isIt(right)}. 들린 문장: ${quoted(target)}`;
      } else {
        const rows = blanks.map((k) => {
          const right = it.o[k][p[k]];
          return { right, opts: shuffle([right, ...shuffle(it.o[k].filter((w) => w !== right)).slice(0, 2)]) };
        });
        const picks = await askBlanks(rows);
        ok = picks.every((x, r) => rows[r].opts[x] === rows[r].right);
        text = ok ? quoted(target) : `정답은 ${rows.map((r, k) => `${CIRCLED[k]} ${esc(r.right)}`).join(', ')}. 들린 문장: ${quoted(target)}`;
      }
      fns = [['정답 문장', () => say(target)]];
    }
    logItem(target, ok);
    const rate = rateLine(target);
    ui.feedback(ok, `${text}${!ok && rate ? ` <span class="why">이 문장 ${rate}</span>` : ''}`, ok ? null : fns);
    if (!ok) await ui.replayAnswer(fns[0][1]);
    return { ok, miss: { label: target, fns } };
  };
}

// 빈칸이 여러 개인 문제: 빈칸마다 보기 3개 중 하나씩 고르고 '확인'을 누른다. 고른 번호들을 돌려준다.
function askBlanks(rows) {
  const box = $('#answers');
  box.className = '';
  box.innerHTML = `
    <div class="blank-rows">${rows.map((r, k) => `
      <div class="blank-row" data-r="${k}"><span class="blank-no">${CIRCLED[k]}</span>
        <div class="choices blank-opts">${r.opts.map((w, i) => `<button class="choice" data-i="${i}"><span class="label">${esc(w)}</span></button>`).join('')}</div>
      </div>`).join('')}
    </div>
    <button class="btn primary block" id="blank-ok" disabled>확인</button>`;
  const picks = rows.map(() => null);
  return new Promise((res) => {
    box.querySelectorAll('.blank-row').forEach((row) => {
      const r = +row.dataset.r;
      row.querySelectorAll('.choice').forEach((b) => {
        b.onclick = () => {
          picks[r] = +b.dataset.i;
          row.querySelectorAll('.choice').forEach((x) => x.classList.toggle('picked', x === b));
          $('#blank-ok').disabled = picks.some((x) => x == null);
        };
      });
    });
    $('#blank-ok').onclick = () => {
      box.querySelectorAll('.blank-row').forEach((row) => {
        const r = +row.dataset.r; const right = rows[r].opts.indexOf(rows[r].right);
        row.querySelectorAll('.choice').forEach((x) => { x.disabled = true; x.classList.remove('picked'); });
        row.querySelector(`[data-i="${right}"]`).classList.add('right');
        if (picks[r] !== right) row.querySelector(`[data-i="${picks[r]}"]`).classList.add('wrong');
      });
      $('#blank-ok').remove();
      res(picks);
    };
  });
}

/* ---------- 도전 ---------- */

async function renderFocusTest(cat, lv) {
  const c = FOCUS_CATS[cat];
  const back = `#focus/${cat}/${lv}`;
  const snr = FOCUS_SNR[lv];
  const say = sayAt(cat === 'sent' ? FOCUS_SPEED[lv] : 1);
  const pk = picker(cat === 'sent' ? FOCUS_SENTENCES[lv] : c.sets(lv));
  const nz = noiseCfg();
  const res = await runQuiz({
    back,
    eyebrow: `${c.name} ${lv}단계 · ${FOCUS_TIERS[lv]} · 도전`,
    title: `${FOCUS_N}문제에 도전해요`,
    hint: `12개 이상 맞히면 통과예요.${nz.on ? ` 소음 모드: ${SCENE_NAME[nz.scene]} 소음 ${snrText(snr)}` : ''}`,
    n: FOCUS_N,
    next: (i, ui) => (cat === 'sent' ? sentQuestion(qTypeAt(cat, i), pk, say, snr) : wordQuestion(qTypeAt(cat, i), pk, say, snr, cat === 'sound'))(i, ui),
  });
  if (!res) return;
  const wasPassed = levelPassed(cat, lv);
  const prevBest = bestRun(cat, lv);
  if (!data.focusRuns) data.focusRuns = [];
  data.focusRuns.push({ cat, lv, date: today(), at: Date.now(), correct: res.correct, total: FOCUS_N, noise: nz.on ? nz.scene : null, sec: res.sec });
  persist();
  const g = gradeOf(res.correct);
  const status = g
    ? `${lv}단계 통과! ${g}등급이에요.${!wasPassed && lv < 10 ? ` ${lv + 1}단계로 넘어갈 수 있어요.` : ''}${prevBest && res.correct > prevBest.correct ? ' 최고 기록을 새로 썼어요.' : ''}`
    : `${FOCUS_PASS}개 이상이면 통과예요. ${FOCUS_PASS - res.correct}개만 더 맞히면 돼요. 연습에서 미리 들어 보고 다시 도전해 보세요.`;
  view.innerHTML = `
    <div class="play result">
      <p class="eyebrow center">${c.name} ${lv}단계 · ${FOCUS_TIERS[lv]}</p>
      ${g ? `<div class="grade big g${g}" aria-label="${g}등급">${g}</div>` : ''}
      <h1 class="q">${FOCUS_N}문제 중 ${res.correct}개 맞혔어요</h1>
      <p class="lead center">${status}</p>
      ${missPanel(res.misses)}
      <div class="actions">
        ${g && lv < 10 ? `<button class="btn primary" data-go="#focus/${cat}/${lv + 1}">${lv + 1}단계로</button>` : ''}
        <button class="btn${g && lv < 10 ? '' : ' primary'}" data-go="${back}/go">다시 도전</button>
        <button class="btn" data-go="${back}">${lv}단계 연습</button>
      </div>
    </div>`;
  bindMissPanel(res.misses);
}

/* ---------- 단어장 ---------- */

const vocabRate = (words) => {
  const rs = words.map(itemRate).filter(Boolean);
  if (!rs.length) return null;
  return Math.round((100 * rs.reduce((a, r) => a + r.ok, 0)) / rs.reduce((a, r) => a + r.n, 0));
};

function renderVocab() {
  setNav('home');
  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow"><button class="link-btn" data-go="#focus">집중 연습</button> · 단어장</p>
      <h1>단어장</h1>
      <p class="lead">상황·장소별 낱말을 눌러 듣고, 장마다 ${VOCAB_N}문제로 풀어 봐요.</p>
    </header>
    <div class="vocab-grid">${VOCAB.map((ch, i) => {
      const r = vocabRate(ch.words);
      return `
      <button class="vocab-card" data-go="#vocab/${i + 1}">
        <span class="cat-ico" aria-hidden="true">${ch.icon}</span>
        <b>${ch.name}</b><small>${ch.words.length}개${r != null ? ` · 정답률 ${r}%` : ''}</small>
      </button>`;
    }).join('')}
    </div>`;
}

function renderVocabCh(n) {
  setNav('home');
  const ch = VOCAB[n - 1];
  const r = vocabRate(ch.words);
  view.innerHTML = `
    <header class="page-head">
      <p class="eyebrow"><button class="link-btn" data-go="#vocab">단어장</button> · ${n}장</p>
      <h1>${ch.icon} ${ch.name}</h1>
      <p class="lead">낱말을 누르면 들려요. 아래 숫자는 문제로 나왔을 때 맞힌 비율이에요${r != null ? ` (이 장 전체 ${r}%)` : ''}.</p>
    </header>
    <div class="word-grid">${ch.words.map((w) => {
      const x = itemRate(w);
      return `<button class="tile word-tile" data-say="${esc(w)}"><span>${esc(w)}</span>
        <small class="rate${x ? (x.pct >= 80 ? ' hi' : x.pct < 50 ? ' lo' : '') : ''}">${x ? `정답률 ${x.pct}% · ${x.n}번` : '아직 안 나왔어요'}</small></button>`;
    }).join('')}
    </div>
    ${noisePanel(VOCAB_SNR)}
    <button class="btn primary block" data-go="#vocab/${n}/go">이 낱말로 ${VOCAB_N}문제 풀기</button>
    <div class="actions two">
      ${n > 1 ? `<button class="btn" data-go="#vocab/${n - 1}">← ${VOCAB[n - 2].name}</button>` : '<span></span>'}
      ${n < VOCAB.length ? `<button class="btn" data-go="#vocab/${n + 1}">${VOCAB[n].name} →</button>` : '<span></span>'}
    </div>`;
  bindNoisePanel();
  bindTapPlay(view, (t) => withFocusNoise(VOCAB_SNR, () => playWord(t)));
}

async function renderVocabQuiz(n) {
  const ch = VOCAB[n - 1];
  const back = `#vocab/${n}`;
  // 넷 중 고르기. 아직 덜 나온 낱말부터 정답으로 낸다.
  const order = shuffle(ch.words).sort((a, b) => (itemRate(a)?.n || 0) - (itemRate(b)?.n || 0));
  const res = await runQuiz({
    back,
    eyebrow: `단어장 · ${ch.name}`,
    title: `${VOCAB_N}문제 풀어 봐요`,
    hint: '들은 낱말을 넷 중에서 골라요.',
    n: VOCAB_N,
    next: (i, ui) => {
      const target = order[i % order.length];
      const opts = shuffle([target, ...shuffle(ch.words.filter((w) => w !== target)).slice(0, 3)]);
      return wordQuestion('four', { set: () => opts, target: () => target }, (t) => playWord(t), VOCAB_SNR, false)(i, ui);
    },
  });
  if (!res) return;
  persist();
  view.innerHTML = `
    <div class="play result">
      <p class="eyebrow center">단어장 · ${ch.name}</p>
      <h1 class="q">${VOCAB_N}문제 중 ${res.correct}개 맞혔어요</h1>
      ${missPanel(res.misses)}
      <div class="actions">
        <button class="btn primary" data-go="${back}/go">한 번 더</button>
        <button class="btn" data-go="${back}">단어장으로</button>
      </div>
    </div>`;
  bindMissPanel(res.misses);
}
