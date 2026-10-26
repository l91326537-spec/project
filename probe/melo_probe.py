# MeloTTS 한국어 시험: 몇 문장을 만들고 Whisper로 다시 받아 적어 비교한다(시험용, 병합하지 않음)
import json, os, time, numpy as np
from melo.api import TTS
from faster_whisper import WhisperModel
import lameenc

TEXTS = ['쌀', '살', '달', '발', '불', '풀', '뿔', '물', '감', '김', '곰', '토끼', '도끼', '시장에서 쌀을 샀어요', '할머니가 전화하셨어요', '다음 정류장은 시청입니다', '덜 맵게 해 주세요', '안녕하세요']
os.makedirs('probe/out', exist_ok=True)
t0 = time.time()
tts = TTS(language='KR', device='cpu')
spk = tts.hps.data.spk2id['KR']
sr = tts.hps.data.sampling_rate
print('load', round(time.time() - t0, 1), 'sr', sr, flush=True)
asr = WhisperModel('small', device='cpu', compute_type='int8')
res = []
for i, t in enumerate(TEXTS):
    t1 = time.time()
    audio = tts.tts_to_file(t, spk, None, speed=0.9, quiet=True)
    gen = time.time() - t1
    a = np.asarray(audio, dtype=np.float32)
    # 앞뒤 무음 자르고 0.15초씩 남기기
    thr = 0.02 * np.max(np.abs(a))
    idx = np.where(np.abs(a) > thr)[0]
    pad = int(0.15 * sr)
    a = a[max(0, idx[0] - pad): idx[-1] + pad] if len(idx) else a
    pcm = (np.clip(a / max(1e-6, np.max(np.abs(a))) * 0.7, -1, 1) * 32767).astype(np.int16)
    enc = lameenc.Encoder(); enc.set_bit_rate(48); enc.set_in_sample_rate(sr); enc.set_channels(1); enc.set_quality(2)
    mp3 = enc.encode(pcm.tobytes()) + enc.flush()
    p = f'probe/out/{i:02d}.mp3'
    open(p, 'wb').write(mp3)
    segs, _ = asr.transcribe(p, language='ko', beam_size=5)
    heard = ''.join(s.text for s in segs).strip()
    res.append({'text': t, 'heard': heard, 'gen_s': round(gen, 2), 'dur_s': round(len(a) / sr, 2), 'bytes': len(mp3)})
    print(res[-1], flush=True)
json.dump(res, open('probe/out/result.json', 'w'), ensure_ascii=False, indent=1)
