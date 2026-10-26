# -*- coding: utf-8 -*-
"""
소리길 음성 파일 만들기 (Azure 음성 서비스, 공식 API)
- web/content.js의 단어·문장을 모두 읽어 마이크로소프트 한국어 음성(ko-KR-SunHiNeural)으로 mp3를 만든다.
- 결과: web/voice/<해시>.mp3, web/voice/index.json ({"글자": "voice/<해시>.mp3"})
- 이미 만든 파일은 건너뛰므로 문항을 추가한 뒤 다시 돌리면 새 문항만 만든다. 문항에서 빠진 파일은 지운다.
- 앞뒤 무음은 0.15초로 맞춘다(말이 끝난 뒤 보기 버튼이 늦게 뜨지 않게).

준비: Azure Speech 리소스의 키와 지역, node (content.js를 읽는 데 씀). 다른 패키지는 필요 없다.
실행: AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=koreacentral python3 tools/make_voices.py
무료(F0) 요금제는 1분에 20번까지만 요청할 수 있어 기본으로 3.2초마다 하나씩 만든다.
"""
import argparse, hashlib, json, os, subprocess, sys, time, urllib.error, urllib.request
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
OUT = os.path.join(WEB, 'voice')

# content.js를 그대로 실행해 문항을 꺼낸다(문항 형식을 파이썬에서 다시 해석하지 않으려고).
DUMP_JS = r"""
const vm = require('vm'); const fs = require('fs');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8') + ';this.W = WORD_SETS; this.S = SENTENCE_SETS; this.N = NOISE_SCENES;', ctx);
const hasBatchim = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c <= 11171 && c % 28 !== 0; };
const fill = (f, w) => f.replace('_{을}', w + (hasBatchim(w) ? '을' : '를')).replace('_{이}', w + (hasBatchim(w) ? '이' : '가'));
const texts = new Set([...Object.values(ctx.W).flat(2), ...ctx.S[1].flat(), ...ctx.S[2].flat(), '안녕하세요']);
for (const { frame, words } of ctx.S[3]) for (const w of words) texts.add(fill(frame, w));
for (const sc of Object.values(ctx.N)) for (const t of [...sc.easy, ...sc.hard].flat()) texts.add(t);
console.log(JSON.stringify([...texts]));
"""


def all_texts():
    out = subprocess.run(['node', '-e', DUMP_JS, os.path.join(WEB, 'content.js')], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


class KeyError_(Exception):
    pass


def synth(text, voice, rate, key, region):
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--voice', default='ko-KR-SunHiNeural')
    ap.add_argument('--rate', default='-10%')  # 청능훈련용으로 조금 천천히
    ap.add_argument('--interval', type=float, default=3.2)  # 무료 요금제: 1분에 20번
    a = ap.parse_args()
    key = os.environ.get('AZURE_SPEECH_KEY')
    region = os.environ.get('AZURE_SPEECH_REGION') or 'koreacentral'
    if not key:
        sys.exit('AZURE_SPEECH_KEY가 없어요. GitHub 저장소 Settings > Secrets and variables > Actions에 넣어 주세요.')
    os.makedirs(OUT, exist_ok=True)

    texts = all_texts()
    index = {}
    todo = []
    for t in texts:
        name = hashlib.sha1(f'azure|{a.voice}|{a.rate}|{t}'.encode()).hexdigest()[:12] + '.mp3'
        index[t] = f'voice/{name}'
        if not os.path.exists(os.path.join(OUT, name)):
            todo.append((t, os.path.join(OUT, name)))
    print(f'문항 {len(texts)}개, 새로 만들 것 {len(todo)}개 (약 {len(todo) * a.interval / 60:.0f}분)', flush=True)

    failed = []
    for i, (t, path) in enumerate(todo):
        t0 = time.time()
        try:
            audio = synth(t, a.voice, a.rate, key, region)
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
    for t in failed:
        index.pop(t, None)

    keep = {os.path.basename(v) for v in index.values()}
    for f in os.listdir(OUT):
        if f.endswith('.mp3') and f not in keep:
            os.remove(os.path.join(OUT, f))

    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as fp:
        json.dump(index, fp, ensure_ascii=False, indent=0, sort_keys=True)
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f'완료: {len(index)}개, 실패 {len(failed)}개, 전체 {size / 1e6:.1f}MB')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
