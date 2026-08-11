"""Domain / title → work / entertainment / other."""

from __future__ import annotations

import os
import re
from urllib.parse import urlparse

ENTERTAINMENT_SUFFIXES = (
    "youtube.com",
    "youtu.be",
    "rutube.ru",
    "twitch.tv",
    "netflix.com",
    "kinopoisk.ru",
    "ivi.ru",
    "okko.tv",
    "premier.one",
    "more.tv",
    "wink.ru",
    "vkvideo.ru",
    "vimeo.com",
    "tiktok.com",
    "instagram.com",
    "pornhub.com",
    "xvideos.com",
    "reddit.com",
    "pikabu.ru",
    "dtf.ru",
    "steamcommunity.com",
    "store.steampowered.com",
    "youtubekids.com",
    "music.yandex.ru",
    "music.youtube.com",
)

# Built-in corporate / SaaS allowlist; extend via ITINV_BROWSER_WORK_DOMAINS.
DEFAULT_WORK_SUFFIXES = (
    "kontur.ru",
    "diadoc.ru",
    "sbis.ru",
    "1c.ru",
    "1c.eu",
    "bitrix24.ru",
    "bitrix24.com",
    "microsoftonline.com",
    "office.com",
    "sharepoint.com",
    "teams.microsoft.com",
    "atlassian.net",
    "jira.com",
    "confluence.com",
    "notion.so",
    "github.com",
    "gitlab.com",
    "hubit.zsgp.ru",
    "zsgp.ru",
)

ENTERTAINMENT_TITLE_RE = re.compile(
    r"("
    r"\bфильм\b|\bкино\b|\bсериал\b|\bсмотреть\b|\bonline\s*cinema\b|"
    r"\byoutube\b|\brutube\b|\btwitch\b|\bnetflix\b|\bkinopoisk\b|"
    r"\bminecraft\s*фильм\b|\btrailer\b|\bклип\b|\bстрим\b|"
    r"\bигра(ть|ю|ем)?\b.*\b(смотр|фильм|трейлер)\b"
    r")",
    re.IGNORECASE,
)

WORK_TITLE_RE = re.compile(
    r"("
    r"\bконтур\b|\bdiadoc\b|\bсбис\b|\b1[cс]\b|\bbitrix\b|"
    r"\bjira\b|\bconfluence\b|\boutlook\b|\bteams\b|"
    r"\bhub-?it\b|\bintranet\b|\bкорпоратив"
    r")",
    re.IGNORECASE,
)


def extract_domain(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    try:
        host = urlparse(raw if "://" in raw else f"https://{raw}").hostname or ""
    except Exception:
        host = ""
    host = host.lower().strip(".")
    if host.startswith("www."):
        host = host[4:]
    return host


def _parse_domain_list(raw: str) -> set[str]:
    out: set[str] = set()
    for part in re.split(r"[,;\s]+", str(raw or "")):
        d = part.strip().lower().lstrip(".")
        if d.startswith("www."):
            d = d[4:]
        if d:
            out.add(d)
    return out


def _work_domains() -> set[str]:
    out = set(DEFAULT_WORK_SUFFIXES)
    out |= _parse_domain_list(os.getenv("ITINV_BROWSER_WORK_DOMAINS", "") or "")
    return out


def _matches_suffix(domain: str, suffixes: tuple[str, ...] | set[str]) -> bool:
    for suf in suffixes:
        if domain == suf or domain.endswith("." + suf):
            return True
    return False


def classify_domain(domain: str) -> str:
    d = (domain or "").lower().strip(".")
    if not d:
        return "other"
    if _matches_suffix(d, _work_domains()):
        return "work"
    if _matches_suffix(d, ENTERTAINMENT_SUFFIXES):
        return "entertainment"
    return "other"


def classify_title(title: str) -> str:
    text = str(title or "").strip()
    if not text:
        return "other"
    if WORK_TITLE_RE.search(text):
        return "work"
    if ENTERTAINMENT_TITLE_RE.search(text):
        return "entertainment"
    return "other"


def classify_visit(url: str = "", title: str = "") -> tuple[str, str]:
    """Return (domain, category). Domain from URL; category: domain first, then title."""
    domain = extract_domain(url)
    by_domain = classify_domain(domain) if domain else "other"
    if by_domain != "other":
        return domain, by_domain
    by_title = classify_title(title)
    return domain, by_title


def classify_url(url: str) -> tuple[str, str]:
    return classify_visit(url, "")


_NOISE_TITLE_RE = re.compile(
    r"^(новая вкладка|new tab|новая вкладка — .+|start page|домашняя страница|"
    r"page d['’]accueil|nueva pestaña|nouvel onglet)\s*$",
    re.IGNORECASE,
)

_NOISE_URL_PREFIXES = (
    "chrome://",
    "chrome-extension://",
    "chrome-search://",
    "chrome-devtools://",
    "edge://",
    "devtools://",
    "about:blank",
    "about:newtab",
    "about:home",
    "browser://",
    "yandexbrowser://",
    "view-source:",
)


def is_noise_visit(url: str = "", title: str = "") -> bool:
    """Drop empty/new-tab/internal browser chrome — no DLP value."""
    raw_url = str(url or "").strip()
    raw_title = str(title or "").strip()
    lower_url = raw_url.lower()
    if not raw_url and not raw_title:
        return True
    if any(lower_url.startswith(p) for p in _NOISE_URL_PREFIXES):
        return True
    if lower_url in {"", "about:blank"}:
        # Title-only focus: still noise if new-tab wording.
        if not raw_title or _NOISE_TITLE_RE.match(raw_title):
            return True
    if _NOISE_TITLE_RE.match(raw_title):
        return True
    # NTP without scheme sometimes stored as bare path.
    if "newtab" in lower_url or "/_/chrome/newtab" in lower_url:
        return True
    return False
