"""Рабочий процесс GigaAM-v3 e2e_rnnt (запускается Python из отдельного окружения GIGAAM_PYTHON).

    python gigaam_worker.py <wav> <turns.json> <out.json> <model_dir>

turns.json — [{"start","end","speaker"}]; out.json — те же отрезки с полем text. Диаризационные реплики одного спикера
с паузой до 0.8 с склеиваются (≤24 с: предел модели ~25 с), короче 0.5 с пропускаются.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile


def merge_turns(turns, gap=0.8, max_len=24.0, min_len=0.5):
    out = []
    for t in sorted(turns, key=lambda x: x["start"]):
        if out and out[-1]["speaker"] == t["speaker"] and t["start"] - out[-1]["end"] <= gap \
                and t["end"] - out[-1]["start"] <= max_len:
            out[-1]["end"] = max(out[-1]["end"], t["end"])
        else:
            out.append({"start": float(t["start"]), "end": float(t["end"]), "speaker": t["speaker"]})
    return [t for t in out if t["end"] - t["start"] >= min_len]


def main(wav, turns_json, out_json, model_dir):
    import soundfile as sf
    import torch
    from transformers import AutoModel

    model = AutoModel.from_pretrained(model_dir, trust_remote_code=True).to("cuda" if torch.cuda.is_available() else "cpu").eval()
    sr = sf.info(wav).samplerate
    turns = merge_turns(json.load(open(turns_json, encoding="utf-8")))
    tmp = tempfile.mkdtemp()
    path = os.path.join(tmp, "c.wav")
    rows = []
    for i, t in enumerate(turns):
        audio, _ = sf.read(wav, start=int(t["start"] * sr), stop=int(t["end"] * sr), dtype="float32")
        sf.write(path, audio, sr)
        with torch.inference_mode():
            text = model.transcribe(path)
        text = text if isinstance(text, str) else str(text)
        if text.strip():
            rows.append({**t, "text": text.strip()})
        if i % 100 == 0:
            print(f"{i}/{len(turns)}", flush=True)
    json.dump(rows, open(out_json, "w", encoding="utf-8"), ensure_ascii=False)


if __name__ == "__main__":
    main(*sys.argv[1:5])
