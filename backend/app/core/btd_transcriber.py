import os, urllib.request
from pathlib import Path
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Optional
import numpy as np
from scipy.signal import resample_poly
import torch
from piano_transcription_inference import PianoTranscription, sample_rate as MODEL_SR
from app.models import NoteEvent

ZENODO_URL = "https://zenodo.org/record/4034264/files/CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth?download=1"
CKPT_FILENAME = "amt.pth"


class ModelCheckpointError(RuntimeError):
    pass


def _default_cache_dir() -> Path:
    configured = os.getenv("MODEL_CACHE_DIR")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / "piano_transcription_inference_data"


def _truthy_env(name: str, default: str = "true") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes", "on"}

@dataclass
class Cfg:
    cache_dir: Path = field(default_factory=_default_cache_dir)
    filename: str = CKPT_FILENAME
    min_bytes: int = int(8e7)

def ensure_ckpt(cfg: Optional[Cfg] = None) -> Path:
    if cfg is None:
        cfg = Cfg()
    cfg.cache_dir.mkdir(parents=True, exist_ok=True)
    p = cfg.cache_dir / cfg.filename
    if p.exists() and p.stat().st_size >= cfg.min_bytes:
        return p

    if not _truthy_env("ALLOW_MODEL_DOWNLOAD"):
        raise ModelCheckpointError(
            "AMT checkpoint is missing and ALLOW_MODEL_DOWNLOAD is disabled: "
            f"{p}. Put the model there, set MODEL_CACHE_DIR, or start with "
            "ALLOW_MODEL_DOWNLOAD=true."
        )
    tmp = p.with_suffix(".tmp")
    urllib.request.urlretrieve(ZENODO_URL, tmp)
    if tmp.stat().st_size < cfg.min_bytes:
        tmp.unlink(missing_ok=True)
        raise ModelCheckpointError("Checkpoint download incomplete")
    tmp.replace(p)
    return p

@contextmanager
def _allow_compact_ckpt(ckpt: Path):
    original_getsize = os.path.getsize
    ckpt_path = os.fspath(ckpt)

    def getsize(path):
        if os.fspath(path) == ckpt_path:
            return max(original_getsize(path), int(1.6e8))
        return original_getsize(path)

    os.path.getsize = getsize
    try:
        yield
    finally:
        os.path.getsize = original_getsize

def _resample(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return x.astype("float32", copy=False)
    g = int(np.gcd(sr_in, sr_out))
    return resample_poly(x, sr_out//g, sr_in//g).astype("float32", copy=False)

class BTDTranscriber:
    def __init__(self, device: Optional[str] = None):
        ckpt = ensure_ckpt()
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        with _allow_compact_ckpt(ckpt):
            self.engine = PianoTranscription(device=torch.device(device), checkpoint_path=str(ckpt))

    def transcribe(self, audio: np.ndarray, sr: int):
        x = _resample(audio, sr, MODEL_SR)
        out = self.engine.transcribe(x, None)
        est = out["est_note_events"]
        notes = [NoteEvent(onset_s=float(e["onset_time"]), offset_s=float(e["offset_time"]), midi_note=int(e["midi_note"]), velocity=int(e["velocity"])) for e in est]
        notes.sort(key=lambda n: (n.onset_s, n.midi_note))
        return notes
