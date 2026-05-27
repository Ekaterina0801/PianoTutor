# Assistant Corrector training (post-teacher)

This trains a **small post-corrector** that improves teacher AMT outputs.
It does NOT replace the heavy model; it refines its output.

## Data format
Create a manifest (CSV or JSON) with pairs:
- audio file (wav/mp3/…)
- midi ground-truth (.mid/.midi)

CSV example:
```
audio,midi,name
/abs/path/a.wav,/abs/path/a.mid,a
```
JSON example:
```json
[{"audio":"...","midi":"...","name":"..."}]
```

## Build manifest automatically
```
python -m app.assistant.train_corrector.build_manifest   --audio-root data/real/audio   --midi-root  data/real/midi   --out data/manifest.csv
```

## Train
Run from `backend/` (venv activated):
```
python -m app.assistant.train_corrector.train   --manifest data/manifest.csv   --epochs 10 --batch 4 --segment-s 10 --hop-s 0.02   --out data/corrector_ckpt.pt
```

## Use in fullstack backend
Set corrector mode to `tcn` and point to checkpoint.
In `backend/app/assistant/corrector.py` you can load the ckpt via `CorrectorConfig(mode="tcn", ckpt_path="data/corrector_ckpt.pt")`.

For API:
- `/api/transcribe?assistant=true` will apply assistant correction (heuristic now).
- For sessions, payload supports: `assistant: "on"/"off"`, `aligner: "basic"/"dtw"`.

(Neural TCN inference is left as diploma extension; training code is complete.)
