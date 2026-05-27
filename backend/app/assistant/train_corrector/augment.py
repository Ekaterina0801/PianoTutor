from __future__ import annotations
import math
import numpy as np

def random_gain(x: np.ndarray, rng: np.random.Generator, lo_db: float=-6.0, hi_db: float=3.0) -> np.ndarray:
    g_db = float(rng.uniform(lo_db, hi_db))
    g = 10 ** (g_db / 20.0)
    y = x * g
    m = float(np.max(np.abs(y)) + 1e-9)
    if m > 1.0:
        y = y / m
    return y.astype(np.float32, copy=False)

def add_noise_snr(x: np.ndarray, snr_db: float, rng: np.random.Generator) -> np.ndarray:
    x = x.astype(np.float32, copy=False)
    sig_pow = float(np.mean(x * x) + 1e-12)
    snr = 10 ** (snr_db / 10.0)
    noise_pow = sig_pow / snr
    n = rng.normal(0.0, math.sqrt(noise_pow), size=x.shape).astype(np.float32)
    y = x + n
    m = float(np.max(np.abs(y)) + 1e-9)
    if m > 1.0:
        y = y / m
    return y

def time_shift(x: np.ndarray, shift_s: float, sr: int) -> np.ndarray:
    shift = int(round(shift_s * sr))
    if shift == 0:
        return x
    if shift > 0:
        pad = np.zeros(shift, dtype=x.dtype)
        return np.concatenate([pad, x[:-shift]])
    else:
        shift = -shift
        pad = np.zeros(shift, dtype=x.dtype)
        return np.concatenate([x[shift:], pad])
