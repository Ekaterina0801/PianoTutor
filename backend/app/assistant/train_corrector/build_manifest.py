from __future__ import annotations
import argparse
from pathlib import Path

def main():
    ap = argparse.ArgumentParser("build_manifest")
    ap.add_argument("--audio-root", type=str, required=True)
    ap.add_argument("--midi-root", type=str, required=True)
    ap.add_argument("--out", type=str, default="data/manifest.csv")
    ap.add_argument("--audio-exts", type=str, default=".wav,.mp3,.flac,.m4a")
    ap.add_argument("--midi-exts", type=str, default=".mid,.midi")
    args = ap.parse_args()

    audio_root = Path(args.audio_root)
    midi_root = Path(args.midi_root)
    audio_exts = [e.strip().lower() for e in args.audio_exts.split(",")]
    midi_exts = [e.strip().lower() for e in args.midi_exts.split(",")]

    audio = []
    for ext in audio_exts:
        audio += list(audio_root.rglob(f"*{ext}"))
    midi = []
    for ext in midi_exts:
        midi += list(midi_root.rglob(f"*{ext}"))

    midi_map = {p.stem: p for p in midi}
    pairs = []
    for a in sorted(audio):
        m = midi_map.get(a.stem)
        if m:
            pairs.append((a, m))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        f.write("audio,midi,name\n")
        for a,m in pairs:
            f.write(f"{a.as_posix()},{m.as_posix()},{a.stem}\n")
    print(f"Wrote {len(pairs)} pairs to: {out}")

if __name__ == "__main__":
    main()
