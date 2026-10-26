# -*- coding: utf-8 -*-
"""
음성 묶음 만들기
- 파일 수 제한이 있는 곳(예: Claude 아티팩트)에 올릴 때 web/voice의 음성 수백 개를 묶음 몇 개로 합친다.
- 결과: OUT/voice/sprite-N.mp3, OUT/voice/index.json ({"글자": {"s": 묶음 경로, "t": 시작 초, "d": 길이 초}})
- 앱(app.js)은 index.json 값이 문자열이면 파일 하나를, 객체면 묶음의 해당 구간을 재생한다.

준비: node, ffmpeg. 먼저 web/voice에 음성 파일이 있어야 한다(tools/make_voices.py).
실행: python3 tools/make_sprites.py OUT
"""
import json, os, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_voices import WEB, all_texts  # 문항 순서대로 묶어 한 단계에서 쓰는 음성이 같은 묶음에 모이게 한다

SR = 24000
GAP = 0.25  # 음성 사이 무음(초)
PER = 80    # 묶음 하나에 넣을 음성 수


def decode(path):
    return subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', str(SR), '-'],
                          capture_output=True, check=True).stdout


def main():
    out = os.path.join(sys.argv[1], 'voice')
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(WEB, 'voice', 'index.json'), encoding='utf-8') as fp:
        files = json.load(fp)
    texts = [t for t in all_texts() if t in files]
    gap = b'\0\0' * int(SR * GAP)
    index = {}
    for n in range(0, len(texts), PER):
        name = f'voice/sprite-{n // PER}.mp3'
        pcm = bytearray(gap)
        for t in texts[n:n + PER]:
            clip = decode(os.path.join(WEB, files[t]))
            index[t] = {'s': name, 't': round(len(pcm) / 2 / SR, 3), 'd': round(len(clip) / 2 / SR, 3)}
            pcm += clip + gap
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ac', '1', '-ar', str(SR), '-i', '-',
                        '-c:a', 'libmp3lame', '-b:a', '48k', os.path.join(sys.argv[1], name)], input=bytes(pcm), check=True)
    with open(os.path.join(out, 'index.json'), 'w', encoding='utf-8') as fp:
        json.dump(index, fp, ensure_ascii=False, separators=(',', ':'))
    size = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
    print(f'음성 {len(index)}개 → 묶음 {(len(texts) + PER - 1) // PER}개, 전체 {size / 1e6:.1f}MB')


if __name__ == '__main__':
    main()
