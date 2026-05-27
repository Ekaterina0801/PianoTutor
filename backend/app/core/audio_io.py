import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

def load_audio(path: str, target_sr: int = 44100):
    x, sr = sf.read(path, dtype="float32", always_2d=False)
    if x.ndim == 2:
        x = x.mean(axis=1).astype("float32", copy=False)
    if sr != target_sr:
        g = int(np.gcd(sr, target_sr))
        x = resample_poly(x, target_sr//g, sr//g).astype("float32", copy=False)
        sr = target_sr
    return x, sr
