"""DLP visit categories + deleted-file noise matcher.

Server-side classifier for ``app.browser_probe_visits`` / ``app.file_left_events``:
the agent-side classifier is intentionally thin, so categories are (re)computed here
at ingest and for display. Old rows keep their stored ``category``; readers should
prefer ``category_display`` computed by :func:`classify_visit`.
"""
from __future__ import annotations

import ipaddress
import re
from typing import Optional
from urllib.parse import urlsplit

# Category → UI hint (label + MUI chip color). Returned to the DLP page as-is.
CATEGORY_META = {
    "internal": {"label": "Внутренние", "color": "primary"},
    "work": {"label": "Работа", "color": "success"},
    "mail": {"label": "Почта", "color": "info"},
    "search": {"label": "Поиск", "color": "secondary"},
    "maps": {"label": "Карты", "color": "info"},
    "shopping": {"label": "Покупки", "color": "warning"},
    "social": {"label": "Соцсети", "color": "secondary"},
    "im": {"label": "Мессенджеры", "color": "info"},
    "news": {"label": "Новости", "color": "default"},
    "entertainment": {"label": "Развлечения", "color": "warning"},
    "other": {"label": "Прочее", "color": "default"},
}

CATEGORIES = tuple(CATEGORY_META.keys())

# Domain rules: the LONGEST matching suffix wins, so specific hosts always beat
# their parent domain regardless of group order (mail.yandex.ru → mail beats
# yandex.ru → search; go.mail.ru → search beats mail.ru → mail).
_DOMAIN_RULES = (
    ("internal", (
        "zsgp.corp",
        "zsgp.ru",
        "i-trailer.ru",
        "localhost",
    )),
    ("work", (
        "kontur.ru", "diadoc.ru", "sbis.ru", "1c.ru", "1c.eu",
        "bitrix24.ru", "bitrix24.com", "microsoftonline.com", "office.com",
        "sharepoint.com", "teams.microsoft.com", "atlassian.net", "jira.com",
        "confluence.com", "notion.so", "github.com", "gitlab.com",
        "disk.yandex.ru", "docviewer.yandex.ru", "disk.yandex.com",
        "drive.google.com", "docs.google.com", "dropbox.com", "zoom.us",
        "go.microsoft.com", "gosuslugi.ru", "esia.gosuslugi.ru",
        "nspd.gov.ru", "trudvsem.ru", "dellin.ru", "files.stroyinf.ru",
        "lk-b2b.mts.ru", "lk.ivc34.ru", "educon2.tyuiu.ru",
        "chatgpt.com", "chat.deepseek.com", "deepseek.com",
        "ilovepdf.com", "lovepdf.ru", "ecalc.ru",
    )),
    # news.mail.ru must outrank the generic mail.ru suffix below.
    ("news", ("news.mail.ru",)),
    ("mail", (
        "gmail.com", "mail.google.com", "mail.ru", "e.mail.ru", "bk.ru",
        "inbox.ru", "list.ru", "internet.ru",
        "mail.yandex.ru", "mail.yandex.com",
        "outlook.com", "outlook.live.com", "hotmail.com", "live.com",
        "mail.rambler.ru", "yahoo.com", "proton.me", "protonmail.com",
    )),
    ("maps", (
        "2gis.ru", "maps.yandex.ru", "maps.yandex.com", "maps.google.com",
        "earth.google.com", "openstreetmap.org", "windy.com",
    )),
    ("im", (
        "web.max.ru", "max.ru", "t.me", "telegram.org", "web.telegram.org",
        "wa.me", "whatsapp.com", "web.whatsapp.com", "vk.me", "signal.org",
        "viber.com", "discord.com", "discord.gg",
    )),
    ("social", (
        "vk.com", "vk.ru", "ok.ru", "odnoklassniki.ru", "facebook.com",
        "instagram.com", "twitter.com", "x.com", "linkedin.com",
        "reddit.com", "pinterest.com",
    )),
    ("shopping", (
        "ozon.ru", "wildberries.ru", "wb.ru", "dns-shop.ru", "lemanapro.ru",
        "vseinstrumenti.ru", "aliexpress.ru", "aliexpress.com", "avito.ru",
        "market.yandex.ru", "megamarket.ru", "sbermegamarket.ru",
        "aviasales.ru", "ostrovok.ru", "citilink.ru", "regard.ru",
        "petrovich.ru", "oldi.ru", "mvideo.ru", "eldorado.ru",
        "lamoda.ru", "ekonika.ru", "thepoizon.ru", "xcabel.ru", "trip.com",
    )),
    ("news", (
        "dzen.ru", "pikabu.ru", "lenta.ru", "ria.ru", "rbc.ru", "gazeta.ru",
        "kommersant.ru", "tass.ru", "vesti.ru", "news.ru", "aif.ru",
        "mk.ru", "iz.ru", "rg.ru", "ura.news", "news.yandex.ru",
        "72.ru", "aftershock.news", "sportbox.ru", "championat.com", "topwar.ru",
    )),
    ("entertainment", (
        "youtube.com", "youtu.be", "youtubekids.com", "music.youtube.com",
        "rutube.ru", "twitch.tv", "netflix.com", "kinopoisk.ru", "ivi.ru",
        "okko.tv", "premier.one", "more.tv", "wink.ru", "vkvideo.ru",
        "vimeo.com", "tiktok.com", "dtf.ru", "steamcommunity.com",
        "store.steampowered.com", "steampowered.com", "music.yandex.ru",
        "music.yandex.com",
    )),
    ("search", (
        "yandex.ru", "ya.ru", "yandex.com", "google.com", "bing.com",
        "duckduckgo.com", "go.mail.ru", "nigma.ru", "qwant.com",
        "rambler.ru", "startpage.com", "v-poiske24.com", "hh.ru",
    )),
)

_LOCAL_SUFFIXES = (".local", ".lan", ".internal", ".corp", ".intranet", ".home")

WORK_TITLE_RE = re.compile(
    r"("
    r"\bконтур\b|\bdiadoc\b|\bсбис\b|\b1[cс]\b|\bbitrix\b|"
    r"\bjira\b|\bconfluence\b|\boutlook\b|\bteams\b|"
    r"\bhub-?it\b|\bintranet\b|\bкорпоратив"
    r")",
    re.IGNORECASE,
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


def normalize_domain(domain: str) -> str:
    d = str(domain or "").lower().strip().strip(".")
    if d.startswith("www."):
        d = d[4:]
    return d


def is_internal_host(domain: str) -> bool:
    """Private IPs, bare hostnames and corporate zones → 'internal'."""
    d = normalize_domain(domain)
    if not d:
        return False
    if "." not in d:  # bare intranet hostname (tmn-srv-exch-01, print-01, ...)
        return True
    try:
        if ipaddress.ip_address(d).is_private:
            return True
    except ValueError:
        pass
    if any(d.endswith(suf) for suf in _LOCAL_SUFFIXES):
        return True
    return False


def _matches_suffix(domain: str, suffixes: tuple[str, ...]) -> bool:
    for suf in suffixes:
        if domain == suf or domain.endswith("." + suf):
            return True
    return False


def classify_domain(domain: str) -> str:
    d = normalize_domain(domain)
    if not d:
        return "other"
    if is_internal_host(d):
        return "internal"
    best_category = "other"
    best_len = -1
    for category, suffixes in _DOMAIN_RULES:
        for suf in suffixes:
            if len(suf) > best_len and (d == suf or d.endswith("." + suf)):
                best_category = category
                best_len = len(suf)
    return best_category


def classify_title(title: str) -> str:
    text = str(title or "").strip()
    if not text:
        return "other"
    if WORK_TITLE_RE.search(text):
        return "work"
    if ENTERTAINMENT_TITLE_RE.search(text):
        return "entertainment"
    return "other"


def domain_from_url(url: str) -> str:
    """Host part of a (possibly schemeless) URL, normalized for classification."""
    u = str(url or "").strip()
    if not u:
        return ""
    if u.lower().startswith("file:///"):
        return "localhost"  # local file opened in the browser → internal
    try:
        host = urlsplit(u if "://" in u else f"https://{u}").hostname or ""
    except ValueError:
        return ""
    return normalize_domain(host)


def classify_visit(domain: str = "", title: str = "", url: str = "") -> str:
    """Display category: domain rules first, title fallback for unmapped hosts.

    Rows stored without ``domain`` (older agent payloads) fall back to the host
    parsed from ``url`` before giving up to the title rules.
    """
    d = domain or domain_from_url(url)
    by_domain = classify_domain(d)
    if by_domain != "other":
        return by_domain
    return classify_title(title)


# --- deleted-file noise -------------------------------------------------------
# One shared regex; input is always lower(file_name). Used by Python
# (re.match on lowered name) and by SQL (lower(file_name) ~ / REGEXP pattern)
# in the fs-egress list endpoint and the history dedupe worker.
SERVICE_FILE_NAME_SQL_RE = (
    r"^~\$"                       # Office lock files ~$doc.docx
    r"|^~.*\.tmp$"                # Outlook ~name.pst.tmp style temp
    r"|.*\.pst\.tmp.*"            # *.pst.tmp / *.pst.tmp.tmp anywhere
    r"|.*\.tmp2?$"                # *.tmp, *.tmp2 (88% of 'deleted' volume)
    r"|.*\.bak$"
    r"|.*\.dwl2?$"                # AutoCAD autosave locks
    r"|.*\.rws$"
    r"|.*\.autosave$"
    r"|.*\.crdownload$"
    r"|.*\.part$"
    r"|.*\.partial$"
    r"|.*\.lock$"
    r"|^[0-9a-f]{8,}s?(\.tmp)?$"  # hex-only temp names (incl. <hex>s session files)
    r"|^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}"  # GUID-named temps
    r"|^as_.*\.tmp$"              # as_*.tmp autosave
    r"|^tmpf.*\.tmp$"             # tmpf*.tmp
    r"|.*\.db-journal$"           # Kontur/Diadoc SQLite journals
    r"|.*\.bin$"                  # Chromium sessionstore (tabs.bin, 0001.bin, ...)
    r"|.*\.os\$$"                 # Revit *.os$ lock files
    r"|^settingss$"               # browser settings artifact
    r"|^segments\.gen$"           # Chromium LevelDB segment
    r"|^acad\.dce$"               # AutoCAD exchange file
    r"|^atmp[0-9a-f]{6,}(\.(tmp|dwl2?|bak))?$"  # AutoCAD temp files next to drawings
    r"|.*\.[0-9]{3,4}(\.[0-9]{3,4})?\.dat$"  # SolidWorks backup segments (history.0447.dat, ...)
    r"|^(users|editingrequests|editingperms|worksetperms|editingdeltas)\.dat$"  # Revit worksharing
    r"|^(aborted-session-ping|telemetry-wal|telemetry-shm|opengl_crash_check|"
    r"permissioncache|prefs\.js|\.touch|versioncheck\.json)$"  # browser profile files
    r"|^activity-stream\."        # Firefox activity-stream caches
    r"|^~"                        # any other '~'-prefixed artifact
)

_SERVICE_FILE_NAME_RE = re.compile(SERVICE_FILE_NAME_SQL_RE)


def is_service_file_name(file_name: str) -> bool:
    """True for program temp/autosave artifacts logged as channel='deleted'."""
    name = str(file_name or "").strip().lower()
    if not name:
        return False
    return bool(_SERVICE_FILE_NAME_RE.search(name))


def category_meta(category: str) -> dict:
    return CATEGORY_META.get(str(category or "other"), CATEGORY_META["other"])
