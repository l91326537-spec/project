# -*- coding: utf-8 -*-
"""
소리길 음성 파일 만들기
- web/content.js의 단어·문장을 모두 읽어 마이크로소프트 한국어 음성(edge-tts)으로 mp3를 만든다.
- 결과: web/voice/<해시>.mp3, web/voice/index.json ({"글자": "voice/<해시>.mp3"})
- 이미 만든 파일은 건너뛰므로 문항을 추가한 뒤 다시 돌리면 새 문항만 만든다.

- 끝에 붙는 긴 무음은 0.15초만 남기고 자른다(말이 끝난 뒤 보기 버튼이 늦게 뜨지 않게).

준비: pip install edge-tts, node (content.js를 읽는 데 씀), ffmpeg (무음 자르기)
실행: python3 tools/make_voices.py [--voice ko-KR-SunHiNeural] [--rate -10%]
네트워크: speech.platform.bing.com 접속이 필요하다. 프록시 환경에서는 HTTPS_PROXY를 자동으로 쓴다.
"""
import argparse, asyncio, hashlib, json, os, shutil, subprocess, sys

import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
OUT = os.path.join(WEB, 'voice')

# content.js를 그대로 실행해 문항을 꺼낸다(문항 형식을 파이썬에서 다시 해석하지 않으려고).
DUMP_JS = r"""
const vm = require('vm'); const fs = require('fs');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8') + ';this.W = WORD_SETS; this.S = SENTENCE_SETS;', ctx);
const hasBatchim = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c <= 11171 && c % 28 !== 0; };
const fill = (f, w) => f.replace('_{을}', w + (hasBatchim(w) ? '을' : '를')).replace('_{이}', w + (hasBatchim(w) ? '이' : '가'));
const texts = new Set([...Object.values(ctx.W).flat(2), ...ctx.S[1].flat(), ...ctx.S[2].flat(), '안녕하세요']);
for (const { frame, words } of ctx.S[3]) for (const w of words) texts.add(fill(frame, w));
console.log(JSON.stringify([...texts]));
"""


def all_texts():
    out = subprocess.run(['node', '-e', DUMP_JS, os.path.join(WEB, 'content.js')], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def trim_tail(path):
    tmp = path + '.tmp.mp3'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path,
                    '-af', 'areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,areverse',
                    '-c:a', 'libmp3lame', '-b:a', '48k', '-ar', '24000', '-ac', '1', tmp], check=True)
    os.replace(tmp, path)


async def make(text, path, voice, rate, proxy):
    for attempt in range(3):
        try:
            await edge_tts.Communicate(text, voice, rate=rate, proxy=proxy).save(path)
            if os.path.getsize(path) > 0:
                await asyncio.to_thread(trim_tail, path)
                return True
        except Exception as e:  # 일시적인 네트워크 오류는 다시 시도한다
            err = e
        await asyncio.sleep(1 + attempt * 2)
    print(f'  실패: {text} ({err})', file=sys.stderr)
    if os.path.exists(path):
        os.remove(path)
    return False


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--voice', default='ko-KR-SunHiNeural')
    ap.add_argument('--rate', default='-10%')  # 청능훈련용으로 조금 천천히
    ap.add_argument('--jobs', type=int, default=4)
    a = ap.parse_args()
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    if not shutil.which('ffmpeg'):
        sys.exit('ffmpeg가 필요해요 (무음 자르기).')
    os.makedirs(OUT, exist_ok=True)

    texts = all_texts()
    index = {}
    todo = []
    for t in texts:
        name = hashlib.sha1(f'{a.voice}|{a.rate}|trim|{t}'.encode()).hexdigest()[:12] + '.mp3'
        index[t] = f'voice/{name}'
        if not os.path.exists(os.path.join(OUT, name)):
            todo.append((t, os.path.join(OUT, name)))
    print(f'문항 {len(texts)}개, 새로 만들 것 {len(todo)}개')

    sem = asyncio.Semaphore(a.jobs)
    async def one(t, p):
        async with sem:
            return await make(t, p, a.voice, a.rate, proxy)
    results = await asyncio.gather(*(one(t, p) for t, p in todo))
    failed = [t for (t, _), ok in zip(todo, results) if not ok]
    for t in failed:
        index.pop(t, None)

    # 문항에서 빠진 옛 파일은 지운다
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
    sys.exit(asyncio.run(main()))
