"""Build custom vocabulary from past meeting transcripts.

Extracts project-specific terms (abbreviations, proper nouns, technical terms)
from all transcripts in output/ and saves to data/voice_server/auto_vocabulary.json.
Loaded automatically by the STT pipeline as Whisper initial_prompt.

Usage: python -m voice_server.build_vocabulary
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

from .config import config

VOCAB_PATH = config.data_dir / "auto_vocabulary.json"
MIN_FREQ = 2
MAX_TERMS = 200

# Known project abbreviations from meeting transcripts
KNOWN_ABBREVIATIONS = {
    "БГ", "НЗ", "РТ", "ЕАСИ", "ЗРДС", "ГПР", "ИД", "РД", "ВОР", "ПНР",
    "ТМЦ", "КС", "ДС", "РЦ", "УМТО", "УПП", "ФЭУ", "ГД", "ВКС", "ГАСН",
    "ПОС", "ТУ", "КС-6", "ЗРДС", "МЧС", "ППК", "ВСК", "РУЗКС", "ГМПИ",
    "АСУ", "СМР", "ЗОС", "ИД+ВОР", "Б-2", "ГСМ", "ОВГ", "ОВШ", "МИК",
    "ПДРЦ", "ВОЛС", "ОНЦК", "ТГС", "ТТиВГ", "ИС", "ИТР", "ЧТС",
    "АВТУ", "ГТН", "ШМР", "ПНР", "Шеф-монтаж",
}

# Common Russian words to exclude
STOPWORDS = {
    "что", "это", "как", "вот", "так", "было", "есть", "нет", "да", "нет",
    "он", "она", "они", "мы", "вы", "я", "ты", "оно", "этот", "эта", "эти",
    "тот", "та", "те", "мой", "твой", "наш", "ваш", "его", "её", "их",
    "весь", "вся", "все", "каждый", "другой", "который", "какой", "чей",
    "быть", "был", "была", "были", "будет", "будут", "может", "могут",
    "надо", "нужно", "можно", "нельзя", "очень", "тоже", "также", "ещё",
    "уже", "пока", "потом", "сейчас", "теперь", "затем", "поэтому",
    "потому", "однако", "хотя", "если", "когда", "где", "куда", "откуда",
    "зачем", "почему", "какой", "сколько", "какой", "каких", "каким",
    "говорил", "говорит", "сказал", "сказать", "делать", "делает", "сделал",
    "работать", "работает", "работать", "надо", "нужно", "вопрос", "вопросы",
    "сегодня", "завтра", "вчера", "неделя", "месяц", "год", "день", "время",
    "человек", "люди", "работа", "работы", "оплата", "оплаты", "сумма",
    "документ", "документы", "файл", "файлы", "данные", "информация",
}

# Pattern for abbreviations: 2+ uppercase letters
ABBREV_RE = re.compile(r"^[А-ЯЁ]{2,}(?:-[А-ЯЁ0-9]+)*$")
# Pattern for names: Фамилия И.О.
NAME_RE = re.compile(r"^[А-ЯЁ][а-яё]{2,}\s[А-ЯЁ]\.[А-ЯЁ]\.?$")
# Pattern for technical terms with hyphens
TECH_RE = re.compile(r"^[А-Яа-яЁё]{2,}-[А-Яа-яЁё]{2,}")


def extract_terms_from_transcript(transcript_path: Path) -> Counter:
    """Extract project-specific terms from a single transcript."""
    try:
        data = json.loads(transcript_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return Counter()

    words = Counter()
    for segment in data.get("segments", []):
        text = segment.get("text", "")
        for word in text.split():
            cleaned = re.sub(r"[^\wА-Яа-яЁё-]", "", word)
            if not cleaned or len(cleaned) < 2:
                continue
            lower = cleaned.lower()
            if lower in STOPWORDS:
                continue
            # Abbreviations (uppercase)
            if ABBREV_RE.match(cleaned) or cleaned in KNOWN_ABBREVIATIONS:
                words[cleaned] += 1
            # Names (Фамилия И.О.)
            elif NAME_RE.match(cleaned):
                words[cleaned] += 1
            # Technical compound terms
            elif TECH_RE.match(cleaned) and len(cleaned) >= 6:
                words[cleaned] += 1
    return words


def build_vocabulary(output_dir: Path) -> dict:
    """Build vocabulary from all transcripts in output/."""
    all_words = Counter()
    transcripts = list(output_dir.rglob("*_transcript.json"))
    for t in transcripts:
        all_words.update(extract_terms_from_transcript(t))

    # Filter by frequency and take top N
    terms = [
        word for word, count in all_words.most_common()
        if count >= MIN_FREQ
    ][:MAX_TERMS]

    # Group by type
    abbreviations = [t for t in terms if ABBREV_RE.match(t) or t in KNOWN_ABBREVIATIONS]
    names = [t for t in terms if NAME_RE.match(t)]
    tech_terms = [t for t in terms if TECH_RE.match(t)]

    return {
        "abbreviations": abbreviations,
        "names": names,
        "tech_terms": tech_terms,
        "all_terms": terms,
        "stats": {
            "transcripts_scanned": len(transcripts),
            "unique_terms": len(all_words),
            "selected_terms": len(terms),
        },
    }


def main():
    output_dir = config.voicevideo_root / "output"
    if not output_dir.exists():
        print(f"Output dir not found: {output_dir}", file=sys.stderr)
        sys.exit(1)

    vocab = build_vocabulary(output_dir)
    VOCAB_PATH.parent.mkdir(parents=True, exist_ok=True)
    VOCAB_PATH.write_text(
        json.dumps(vocab, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Vocabulary saved to {VOCAB_PATH}")
    print(f"  Abbreviations: {len(vocab['abbreviations'])}")
    print(f"  Names: {len(vocab['names'])}")
    print(f"  Tech terms: {len(vocab['tech_terms'])}")
    print(f"  Total: {vocab['stats']['selected_terms']} terms from {vocab['stats']['transcripts_scanned']} transcripts")
    print(f"\nSample abbreviations: {vocab['abbreviations'][:15]}")
    print(f"Sample names: {vocab['names'][:10]}")


if __name__ == "__main__":
    main()
