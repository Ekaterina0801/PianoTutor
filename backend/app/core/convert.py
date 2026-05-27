from __future__ import annotations
import shutil
import subprocess
import os
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

def ffmpeg_to_wav(src_path: str, dst_path: str, sr: int = 44100) -> None:
    """Convert arbitrary audio container to mono WAV using ffmpeg."""
    src = Path(src_path)
    dst = Path(dst_path)
    dst.parent.mkdir(parents=True, exist_ok=True)
    if shutil.which("ffmpeg"):
        cmd = ["ffmpeg","-y","-i", str(src), "-ac","1","-ar", str(sr), "-f","wav", str(dst)]
        try:
            timeout_s = float(os.getenv("FFMPEG_TIMEOUT_S", "30"))
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=timeout_s)
            return
        except subprocess.CalledProcessError as exc:
            msg = (exc.stderr or b"").decode("utf-8", errors="ignore").strip()
            raise RuntimeError(f"ffmpeg failed to convert audio: {msg[-500:]}") from exc
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("ffmpeg timed out while converting audio") from exc

    try:
        audio, in_sr = sf.read(str(src), dtype="float32", always_2d=False)
    except Exception as exc:
        raise RuntimeError(
            "ffmpeg is not installed and this audio container cannot be read directly. "
            "Upload WAV/FLAC or install ffmpeg for MP3/WebM/M4A."
        ) from exc

    if audio.ndim == 2:
        audio = audio.mean(axis=1).astype("float32", copy=False)
    if in_sr != sr:
        g = int(np.gcd(in_sr, sr))
        audio = resample_poly(audio, sr // g, in_sr // g).astype("float32", copy=False)
    sf.write(str(dst), audio, sr, subtype="PCM_16")
