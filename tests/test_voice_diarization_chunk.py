"""voice_video/modules/diarization.py: chunked dispatch seam (heavy deps stubbed)."""
from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
MODULES = ROOT / "voice_video" / "modules"


def _load_diarization(tmp_path, monkeypatch):
    """Load diarization.py as 'vvd.diarization' with stubbed torch/pyannote/whisperx."""
    pkg = types.ModuleType("vvd")
    pkg.__path__ = [str(MODULES)]
    monkeypatch.setitem(sys.modules, "vvd", pkg)

    spec = importlib.util.spec_from_file_location(
        "vvd.speaker_utils", MODULES / "speaker_utils.py"
    )
    speaker_utils = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, "vvd.speaker_utils", speaker_utils)
    spec.loader.exec_module(speaker_utils)

    audio_processor = types.ModuleType("vvd.audio_processor")
    audio_processor.ProcessingConfig = object
    audio_processor.retry_on_failure = lambda *a, **k: (lambda f: f)
    audio_processor.monitor_memory = lambda *a, **k: 0.0
    audio_processor.cleanup_memory = lambda *a, **k: None
    monkeypatch.setitem(sys.modules, "vvd.audio_processor", audio_processor)

    config = types.ModuleType("config")
    config.DEVICE = "cpu"
    config.HF_TOKEN = None
    config.MODELS_DIR = tmp_path / "models"
    config.PROJECT_ROOT = tmp_path
    config.REFERENCE_VOICES_DIR = tmp_path / "ref"
    monkeypatch.setitem(sys.modules, "config", config)

    class _Tensor:
        def float(self):
            return self

        def unsqueeze(self, dim):
            return self

        def detach(self):
            return self

    torch = types.ModuleType("torch")
    torch.from_numpy = lambda array: _Tensor()
    torch.uint8 = "uint8"
    monkeypatch.setitem(sys.modules, "torch", torch)

    pyannote_audio = types.ModuleType("pyannote.audio")
    pyannote_audio.Model = object
    pyannote_audio.Inference = object
    pyannote_audio.__version__ = "4.0.7"
    pyannote = types.ModuleType("pyannote")
    pyannote.audio = pyannote_audio
    monkeypatch.setitem(sys.modules, "pyannote", pyannote)
    monkeypatch.setitem(sys.modules, "pyannote.audio", pyannote_audio)

    whisperx = types.ModuleType("whisperx")
    whisperx.DiarizationPipeline = None
    monkeypatch.setitem(sys.modules, "whisperx", whisperx)

    tqdm_mod = types.ModuleType("tqdm")
    tqdm_mod.tqdm = lambda iterable=None, *a, **k: iterable
    monkeypatch.setitem(sys.modules, "tqdm", tqdm_mod)

    # Module-level _configure_pyannote_runtime writes cache dirs via env
    for name in ("HUGGINGFACE_HUB_CACHE", "HF_HOME", "TORCH_HOME", "PYANNOTE_CACHE"):
        monkeypatch.setenv(name, str(tmp_path / "env" / name))

    spec = importlib.util.spec_from_file_location(
        "vvd.diarization", MODULES / "diarization.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _config(**overrides):
    base = dict(
        diarization_chunk_seconds=10.0,
        diarization_chunk_threshold_seconds=100.0,
        diarization_chunk_overlap_seconds=2.0,
        diarization_chunk_max_speakers=20,
        diarization_stitch_similarity=0.80,
        diarization_stitch_margin=0.08,
        diarization_stitch_min_speech=6.0,
        diarization_num_speakers=0,
        diarization_min_speakers=1,
        diarization_max_speakers=10,
        diarization_clustering_threshold=None,
        diarization_min_duration_off=None,
        diarization_audio="processed",
        diarization_exclusive=False,
        diarization_overlap_assign=False,
        speaker_embeddings_improved=False,
        use_checkpoints=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_long_audio_uses_chunked_runner_with_global_registry_params(tmp_path, monkeypatch):
    np = pytest.importorskip("numpy")
    mod = _load_diarization(tmp_path, monkeypatch)
    seen = {}

    def fake_chunked(audio, diarize_window, **kwargs):
        seen["audio"] = audio
        seen["diarize_window"] = diarize_window
        seen["kwargs"] = kwargs
        return mod.DiarizationSegments([], [], {"speakers_count": 3, "windows": []})

    monkeypatch.setattr(mod, "run_chunked_diarization", fake_chunked)
    wrapper_calls = []

    def wrapper(audio, **kwargs):
        wrapper_calls.append(kwargs)
        return ["legacy"]

    audio = np.zeros(250)  # 250 s > max(chunk 10 s, threshold 100 s)
    result = mod.run_diarization(
        wrapper, audio, num_speakers=None, min_speakers=1, max_speakers=10,
        sample_rate=1, config=_config(), audio_file=None,
    )
    assert isinstance(result, mod.DiarizationSegments)
    assert not wrapper_calls
    kwargs = seen["kwargs"]
    assert kwargs["chunk_seconds"] == 10.0
    assert kwargs["overlap_seconds"] == 2.0
    # Локальный предел окна — отдельный, глобальный реестр не ограничен max_speakers=10
    assert kwargs["local_max_speakers"] == 20
    assert kwargs["similarity"] == 0.80 and kwargs["margin"] == 0.08
    assert kwargs["min_speech"] == 6.0
    assert kwargs["cache_prefix"] is None
    assert kwargs["cache_identity"]["policy"]
    assert kwargs["cache_identity"]["exclusive"] is False
    assert callable(seen["diarize_window"])


def test_exact_num_speakers_caps_window_but_not_registry(tmp_path, monkeypatch):
    np = pytest.importorskip("numpy")
    mod = _load_diarization(tmp_path, monkeypatch)
    seen = {}

    def fake_chunked(audio, diarize_window, **kwargs):
        seen["kwargs"] = kwargs
        return mod.DiarizationSegments([], [], {"speakers_count": 5, "windows": []})

    monkeypatch.setattr(mod, "run_chunked_diarization", fake_chunked)
    audio = np.zeros(250)
    mod.run_diarization(
        lambda *a, **k: ["legacy"], audio,
        num_speakers=5, min_speakers=1, max_speakers=10,
        sample_rate=1, config=_config(), audio_file=None,
    )
    assert seen["kwargs"]["local_max_speakers"] == 5


def test_short_audio_and_disabled_chunking_keep_legacy_path(tmp_path, monkeypatch):
    np = pytest.importorskip("numpy")
    mod = _load_diarization(tmp_path, monkeypatch)
    monkeypatch.setattr(
        mod,
        "run_chunked_diarization",
        lambda *a, **k: pytest.fail("chunked path must not run"),
    )
    wrapper_calls = []

    def wrapper(audio, **kwargs):
        wrapper_calls.append(kwargs)
        return ["legacy"]

    # Короткое аудио при включённой нарезке — прежний путь
    short = np.zeros(50)
    assert mod.run_diarization(
        wrapper, short, num_speakers=2, min_speakers=1, max_speakers=10,
        sample_rate=1, config=_config(), audio_file=None,
    ) == ["legacy"]
    # Длинное аудио при выключенной нарезке — тоже прежний путь
    long_audio = np.zeros(500)
    assert mod.run_diarization(
        wrapper, long_audio, num_speakers=None, min_speakers=1, max_speakers=10,
        sample_rate=1, config=_config(diarization_chunk_seconds=0), audio_file=None,
    ) == ["legacy"]
    assert wrapper_calls[0] == {"num_speakers": 2, "min_speakers": 1, "max_speakers": 10}
    assert wrapper_calls[1] == {"num_speakers": None, "min_speakers": 1, "max_speakers": 10}


def test_invalid_chunk_config_raises(tmp_path, monkeypatch):
    np = pytest.importorskip("numpy")
    mod = _load_diarization(tmp_path, monkeypatch)
    for bad in (-1.0, float("nan")):
        with pytest.raises(mod.DiarizationChunkError):
            mod.run_diarization(
                lambda *a, **k: [], np.zeros(5), num_speakers=None,
                min_speakers=1, max_speakers=10, sample_rate=1,
                config=_config(diarization_chunk_seconds=bad), audio_file=None,
            )


class _FakeAnnotation:
    def __init__(self, turns):
        self._turns = turns

    def labels(self):
        return sorted({speaker for _, _, speaker in self._turns})

    def itertracks(self, yield_label=False):
        for start, end, speaker in self._turns:
            yield SimpleNamespace(start=start, end=end), None, speaker


def test_native_chunk_payload_calls_pipeline_and_aligns_embeddings(tmp_path, monkeypatch):
    np = pytest.importorskip("numpy")
    mod = _load_diarization(tmp_path, monkeypatch)
    seen = {}
    full = _FakeAnnotation([(0.0, 5.0, "B"), (3.0, 8.0, "A")])
    exclusive = _FakeAnnotation([(0.0, 8.0, "A")])
    output = SimpleNamespace(
        speaker_diarization=full,
        exclusive_speaker_diarization=exclusive,
        speaker_embeddings=np.array([[0.9, 0.1], [0.1, 0.9]]),
    )

    def pipeline(file, **kwargs):
        seen["file"] = file
        seen["kwargs"] = kwargs
        return output

    payload = mod._native_chunk_payload(
        SimpleNamespace(model=pipeline), np.zeros(160), sample_rate=16000,
        exclusive=True, num_speakers=None, min_speakers=1, max_speakers=20,
    )
    assert seen["file"]["sample_rate"] == 16000
    kwargs = seen["kwargs"]
    assert kwargs["num_speakers"] is None
    assert kwargs["min_speakers"] == 1 and kwargs["max_speakers"] == 20
    assert callable(kwargs["hook"])
    # Слова идут по exclusive-разметке, наложения хранятся отдельно
    assert payload["segments"] == [{"start": 0.0, "end": 8.0, "speaker": "A"}]
    assert len(payload["overlap_segments"]) == 2
    # labels() отсортированы: A ↔ row 0, B ↔ row 1
    np = pytest.importorskip("numpy")
    assert np.allclose(payload["embeddings"]["A"], [0.9, 0.1])
    assert np.allclose(payload["embeddings"]["B"], [0.1, 0.9])


def test_native_chunk_payload_rejects_misaligned_embeddings(tmp_path, monkeypatch):
    np = pytest.importorskip("numpy")
    mod = _load_diarization(tmp_path, monkeypatch)
    full = _FakeAnnotation([(0.0, 5.0, "A"), (0.0, 5.0, "B")])
    output = SimpleNamespace(
        speaker_diarization=full,
        exclusive_speaker_diarization=full,
        speaker_embeddings=np.array([[0.9, 0.1]]),  # одна строка на два лейбла
    )
    with pytest.raises(mod.DiarizationChunkError):
        mod._native_chunk_payload(
            SimpleNamespace(model=lambda file, **kw: output), np.zeros(160),
            sample_rate=16000, exclusive=True, num_speakers=None, min_speakers=1,
            max_speakers=20,
        )
