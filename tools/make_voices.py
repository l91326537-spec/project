# -*- coding: utf-8 -*-
"""
소리길 음성 파일 만들기
- web/content.js의 단어·문장을 모두 읽어 한국어 음성 mp3를 만든다.
- 결과: web/voice/<해시>.mp3, web/voice/index.json ({"글자": "voice/<해시>.mp3"})
- 이미 만든 파일은 건너뛰므로 문항을 추가한 뒤 다시 돌리면 새 문항만 만든다. 문항에서 빠진 파일은 지운다.

엔진 두 가지(--engine, 기본은 키가 있으면 azure, 없으면 melo):
- melo: MeloTTS(MIT 라이선스, 오픈소스). 키가 필요 없다. 만든 음성을 Whisper로 듣고 같은 문제의
  다른 보기보다 정답으로 들리는지 확인해, 아니면 다시 만든다. 확인 결과는 tools/voice_qa.json에 남긴다.
  준비: pip install git+https://github.com/myshell-ai/MeloTTS.git faster-whisper lameenc && python -m unidic download
- azure: Azure 음성 서비스(공식 API, ko-KR-SunHiNeural). 준비: AZURE_SPEECH_KEY, AZURE_SPEECH_REGION.
  무료(F0) 요금제는 1분에 20번까지만 요청할 수 있어 기본으로 3.2초마다 하나씩 만든다.
공통 준비: node (content.js를 읽는 데 씀).
실행: python3 tools/make_voices.py
"""
import argparse, hashlib, json, os, re, subprocess, sys, time, urllib.error, urllib.request
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
OUT = os.path.join(WEB, 'voice')
QA = os.path.join(ROOT, 'tools', 'voice_qa.json')

# content.js를 그대로 실행해 문항을 꺼낸다(문항 형식을 파이썬에서 다시 해석하지 않으려고).
# groups는 한 문제에 함께 나오는 보기 묶음이다(음성 확인 때 헷갈릴 만한 후보로 쓴다).
DUMP_JS = r"""
const vm = require('vm'); const fs = require('fs');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8') + ';this.W = WORD_SETS; this.S = SENTENCE_SETS; this.N = NOISE_SCENES;', ctx);
const hasBatchim = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c <= 11171 && c % 28 !== 0; };
const fill = (f, w) => f.replace('_{을}', w + (hasBatchim(w) ? '을' : '를')).replace('_{이}', w + (hasBatchim(w) ? '이' : '가'));
const groups = [...Object.values(ctx.W).flat(), ...ctx.S[1], ...ctx.S[2], ['안녕하세요']];
for (const { frame, words } of ctx.S[3]) groups.push(words.map((w) => fill(frame, w)));
for (const sc of Object.values(ctx.N)) groups.push(...sc.easy, ...sc.hard);
console.log(JSON.stringify({ texts: [...new Set(groups.flat())], groups }));
"""


def _dump():
    out = subprocess.run(['node', '-e', DUMP_JS, os.path.join(WEB, 'content.js')], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def all_texts():
    return _dump()['texts']


def rivals_of(groups):
    """글자마다 같은 문제에 함께 나오는 다른 보기들"""
    out = {}
    for g in groups:
        for t in g:
            out.setdefault(t, set()).update(x for x in g if x != t)
    return {t: sorted(v) for t, v in out.items()}


def finish(index, failed):
    index = {t: v for t, v in index.items() if t not in failed and os.path.exists(os.path.join(WEB, v))}
    keep = {os.path.basename(v) for v in index.values()}
    for f in os.listdir(OUT):
        if f.endswith('.mp3') and f not in keep:
            os.remove(os.path.join(OUT, f))
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as fp:
        json.dump(index, fp, ensure_ascii=False, indent=0, sort_keys=True)
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f'완료: {len(index)}개, 실패 {len(failed)}개, 전체 {size / 1e6:.1f}MB')
    return 1 if failed else 0


def plan(texts, tag):
    index, todo = {}, []
    for t in texts:
        name = hashlib.sha1(f'{tag}|{t}'.encode()).hexdigest()[:12] + '.mp3'
        index[t] = f'voice/{name}'
        if not os.path.exists(os.path.join(OUT, name)):
            todo.append((t, os.path.join(OUT, name)))
    return index, todo


# ---------- MeloTTS + Whisper 확인 ----------

def norm(s):
    return re.sub(r'[\s.,?!~·"\']', '', s)


L0, V0, T0 = 0x1100, 0x1161, 0x11a7
TAIL = ' ᆨᆩᆪᆫᆬᆭᆮᆯᆰᆱᆲᆳᆴᆵᆶᆷᆸᆹᆺᆻᆼᆽᆾᆿᇀᇁᇂ'


def jamo(s):
    """글자를 첫소리·모음·받침으로 풀어 쓴다(소리 한 조각씩 비교하려고)."""
    out = []
    for ch in norm(s):
        c = ord(ch) - 0xac00
        if 0 <= c <= 11171:
            out += [chr(L0 + c // 588), chr(V0 + (c % 588) // 28)]
            if c % 28:
                out.append(chr(T0 + c % 28))
        else:
            out.append(ch)
    return out


def sim(a, b):
    """자모 편집거리로 센 닮은 정도(0~100). app.js의 따라 말하기 채점과 같은 방식."""
    x, y = jamo(a), jamo(b)
    if not x and not y:
        return 100.0
    prev = list(range(len(y) + 1))
    for i, xi in enumerate(x, 1):
        cur = [i]
        for j, yj in enumerate(y, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (xi != yj)))
        prev = cur
    return max(0.0, 100.0 * (1 - prev[-1] / max(len(x), len(y))))


class Judge:
    """만든 음성을 Whisper로 받아 적고, 정답과 같은 문제의 다른 보기 중 무엇에 더 가깝게 들리는지 본다."""

    def __init__(self, size):
        from faster_whisper import WhisperModel
        self.m = WhisperModel(size, device='cpu', compute_type='int8')

    def check(self, text, wav16, rivals):
        segs, _ = self.m.transcribe(wav16, language='ko', beam_size=5)
        heard = ''.join(s.text for s in segs).strip()
        own = sim(text, heard)
        best = max(((sim(r, heard), r) for r in rivals), default=(0.0, None))
        return {'heard': heard, 'sim': round(own, 1), 'margin': round(own - best[0], 1) if best[1] else 100.0,
                'rival': best[1], 'exact': norm(heard) == norm(text)}


def run_melo(a, texts, rivals):
    import numpy as np, torch, lameenc
    from melo.api import TTS
    tts = TTS(language='KR', device='cpu')
    spk = tts.hps.data.spk2id['KR']
    sr = tts.hps.data.sampling_rate
    judge = Judge(a.whisper)
    index, todo = plan(texts, f'melo|KR|{a.speed}')
    if a.limit:  # 시험 삼아 일부만
        todo = todo[:a.limit]
    qa = {}
    if os.path.exists(QA):
        with open(QA, encoding='utf-8') as fp:
            qa = {t: v for t, v in json.load(fp).items() if t in index}
    print(f'문항 {len(texts)}개, 새로 만들 것 {len(todo)}개', flush=True)

    def resample(wav, to):
        n = int(len(wav) * to / sr)
        return np.interp(np.arange(n) * (sr / to), np.arange(len(wav)), wav).astype(np.float32)

    def make(text, seed):
        torch.manual_seed(seed)
        wav = np.asarray(tts.tts_to_file(text, spk, None, quiet=True, speed=a.speed), dtype=np.float32)
        loud = np.where(np.abs(wav) > 0.02 * np.max(np.abs(wav)))[0]
        pad = int(0.15 * sr)  # 앞뒤 무음 0.15초(말이 끝난 뒤 보기 버튼이 늦게 뜨지 않게)
        wav = wav[max(0, loud[0] - pad): loud[-1] + pad]
        return wav / max(1e-6, np.max(np.abs(wav))) * 0.85

    def mp3(wav, path):
        enc = lameenc.Encoder()
        enc.set_bit_rate(48); enc.set_in_sample_rate(24000); enc.set_channels(1); enc.set_quality(2)
        with open(path, 'wb') as fp:
            fp.write(enc.encode((resample(wav, 24000) * 32767).astype(np.int16).tobytes()) + enc.flush())

    failed = []
    t0 = time.time()
    for i, (t, path) in enumerate(todo):
        best = None
        tries = a.tries if len(norm(t)) <= 3 else max(2, a.tries // 2)  # 짧은 낱말이 헷갈리기 쉽다
        for k in range(tries):
            try:
                wav = make(t, 1000 * k + 7)
            except Exception as e:  # 드물게 합성이 실패하면 다음 시드로
                print(f'  합성 오류: {t} ({e})', file=sys.stderr)
                continue
            r = judge.check(t, resample(wav, 16000), rivals.get(t, []))
            r['try'] = k + 1
            score = (r['margin'] >= a.margin, r['exact'], r['margin'], r['sim'])
            if best is None or score > best[0]:
                best = (score, wav, r)
            if r['margin'] >= a.margin and r['exact']:
                break
        if best is None:
            failed.append(t)
            continue
        mp3(best[1], path)
        best[2]['ok'] = best[2]['margin'] >= a.margin
        qa[t] = best[2]
        if (i + 1) % 25 == 0:
            print(f'  {i + 1}/{len(todo)} ({(time.time() - t0) / 60:.0f}분)', flush=True)

    with open(QA, 'w', encoding='utf-8') as fp:
        json.dump(dict(sorted(qa.items())), fp, ensure_ascii=False, indent=0)
    weak = sorted((v['margin'], t, v['heard']) for t, v in qa.items() if not v.get('ok'))
    print(f'확인: {len(qa) - len(weak)}/{len(qa)}개가 다른 보기보다 정답에 가깝게 들림')
    for m, t, h in weak[:40]:
        print(f'  애매함: {t} → "{h}" (차이 {m})')
    return finish(index, failed)


# ---------- Azure ----------

class KeyError_(Exception):
    pass


def synth_azure(text, voice, rate, key, region):
    ssml = (f"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='ko-KR'>"
            f"<voice name='{voice}'><mstts:silence type='Leading-exact' value='150ms'/><mstts:silence type='Tailing-exact' value='150ms'/>"
            f"<prosody rate='{rate}'>{escape(text)}</prosody></voice></speak>")
    req = urllib.request.Request(
        f'https://{region}.tts.speech.microsoft.com/cognitiveservices/v1', data=ssml.encode('utf-8'), method='POST',
        headers={'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml',
                 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'sorigil-voices'})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
            if body:
                return body
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise KeyError_(f'키나 지역이 맞지 않아요 (HTTP {e.code})')
            if e.code == 429:  # 요청이 너무 잦다: 알려 준 만큼 쉬었다가 다시
                time.sleep(float(e.headers.get('Retry-After') or 10))
                continue
            err = e
        except Exception as e:  # 일시적인 네트워크 오류는 다시 시도한다
            err = e
        time.sleep(2 + attempt * 3)
    print(f'  실패: {text} ({err})', file=sys.stderr)
    return None


def run_azure(a, texts):
    key = os.environ.get('AZURE_SPEECH_KEY')
    region = os.environ.get('AZURE_SPEECH_REGION') or 'koreacentral'
    if not key:
        sys.exit('AZURE_SPEECH_KEY가 없어요.')
    index, todo = plan(texts, f'azure|{a.voice}|{a.rate}')
    print(f'문항 {len(texts)}개, 새로 만들 것 {len(todo)}개 (약 {len(todo) * a.interval / 60:.0f}분)', flush=True)
    failed = []
    for i, (t, path) in enumerate(todo):
        t0 = time.time()
        try:
            audio = synth_azure(t, a.voice, a.rate, key, region)
        except KeyError_ as e:
            sys.exit(str(e))
        if audio:
            with open(path, 'wb') as fp:
                fp.write(audio)
        else:
            failed.append(t)
        if (i + 1) % 50 == 0:
            print(f'  {i + 1}/{len(todo)}', flush=True)
        time.sleep(max(0, a.interval - (time.time() - t0)))
    return finish(index, failed)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', choices=['melo', 'azure'], default='azure' if os.environ.get('AZURE_SPEECH_KEY') else 'melo')
    ap.add_argument('--speed', type=float, default=0.9)  # melo: 청능훈련용으로 조금 천천히
    ap.add_argument('--tries', type=int, default=6)  # melo: 짧은 낱말을 다시 만들어 볼 횟수(문장은 절반)
    ap.add_argument('--margin', type=float, default=1.0)  # melo: 정답이 다른 보기보다 이만큼(닮은 정도 점수) 더 가깝게 들려야 통과
    ap.add_argument('--whisper', default='small')  # melo: 확인에 쓸 Whisper 크기
    ap.add_argument('--limit', type=int, default=0)  # melo: 시험 삼아 새 문항 중 앞의 몇 개만 만든다
    ap.add_argument('--voice', default='ko-KR-SunHiNeural')  # azure
    ap.add_argument('--rate', default='-10%')  # azure
    ap.add_argument('--interval', type=float, default=3.2)  # azure 무료 요금제: 1분에 20번
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    d = _dump()
    print(f'엔진: {a.engine}', flush=True)
    if a.engine == 'melo':
        return run_melo(a, d['texts'], rivals_of(d['groups']))
    return run_azure(a, d['texts'])


if __name__ == '__main__':
    sys.exit(main())
