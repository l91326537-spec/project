# MeloTTS 한국어 시험 2: 낱말 하나를 여러 설정으로 만들고, 기준 음성(이전 마이크로소프트 음성)과 함께 Whisper로 받아 적는다(시험용, 병합하지 않음)
import json, os, sys, numpy as np
from melo.api import TTS
from faster_whisper import WhisperModel
import lameenc

WORDS = json.load(open(sys.argv[1], encoding='utf-8'))  # {"쌀": "voice/....mp3", ...}
os.makedirs('probe/out', exist_ok=True)
tts = TTS(language='KR', device='cpu')
spk = tts.hps.data.spk2id['KR']; sr = tts.hps.data.sampling_rate

def save(a, p):
    a = np.asarray(a, dtype=np.float32)
    idx = np.where(np.abs(a) > 0.02 * np.max(np.abs(a)))[0]; pad = int(0.15 * sr)
    a = a[max(0, idx[0] - pad): idx[-1] + pad]
    pcm = (a / max(1e-6, np.max(np.abs(a))) * 0.7 * 32767).astype(np.int16)
    enc = lameenc.Encoder(); enc.set_bit_rate(48); enc.set_in_sample_rate(sr); enc.set_channels(1); enc.set_quality(2)
    open(p, 'wb').write(enc.encode(pcm.tobytes()) + enc.flush())

VARIANTS = {
    'base': lambda w: dict(text=w, speed=0.9),
    'dot': lambda w: dict(text=w + '.', speed=0.9),
    'clean': lambda w: dict(text=w, speed=0.9, sdp_ratio=0.0, noise_scale=0.3, noise_scale_w=0.4),
    'slow': lambda w: dict(text=w, speed=0.75),
}
clips = []
for i, (w, ref) in enumerate(WORDS.items()):
    clips.append((w, 'ref', f'probe/ref/{os.path.basename(ref)}'))
    for name, f in VARIANTS.items():
        kw = f(w); text = kw.pop('text')
        p = f'probe/out/{i:02d}-{name}.mp3'
        save(tts.tts_to_file(text, spk, None, quiet=True, **kw), p)
        clips.append((w, name, p))
res = {}
for size in ['small', 'medium']:
    asr = WhisperModel(size, device='cpu', compute_type='int8')
    for w, name, p in clips:
        segs, _ = asr.transcribe(p, language='ko', beam_size=5)
        res.setdefault(w, {}).setdefault(name, {})[size] = ''.join(s.text for s in segs).strip()
    print(size, 'done', flush=True)
json.dump(res, open('probe/out/result2.json', 'w'), ensure_ascii=False, indent=1)
