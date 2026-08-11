from browser_probe.classify import (
    classify_domain,
    classify_title,
    classify_url,
    classify_visit,
    extract_domain,
    is_noise_visit,
)


def test_extract_domain_strips_www():
    assert extract_domain("https://www.youtube.com/watch?v=1") == "youtube.com"


def test_entertainment_youtube():
    assert classify_domain("youtube.com") == "entertainment"
    assert classify_domain("m.youtube.com") == "entertainment"


def test_default_work_kontur():
    assert classify_domain("kontur.ru") == "work"
    assert classify_domain("cabinet.kontur.ru") == "work"


def test_work_domains_from_env(monkeypatch):
    monkeypatch.setenv("ITINV_BROWSER_WORK_DOMAINS", "intranet.local, wiki.corp")
    assert classify_domain("intranet.local") == "work"
    assert classify_domain("wiki.corp") == "work"
    assert classify_domain("example.com") == "other"


def test_classify_url():
    domain, category = classify_url("https://kinopoisk.ru/film/1")
    assert domain == "kinopoisk.ru"
    assert category == "entertainment"


def test_title_entertainment_film():
    assert classify_title("КАРАНТИН - Minecraft Фильм") == "entertainment"
    assert classify_title("Смотреть сериал онлайн") == "entertainment"


def test_title_work_kontur():
    assert classify_title("Контур — экосистема для бизнеса") == "work"


def test_classify_visit_title_fallback():
    domain, category = classify_visit("", "RUTUBE - смотрите видео онлайн")
    assert domain == ""
    assert category == "entertainment"


def test_classify_visit_domain_wins_over_title():
    domain, category = classify_visit("https://kontur.ru/", "Смотреть фильм")
    assert domain == "kontur.ru"
    assert category == "work"


def test_noise_new_tab():
    assert is_noise_visit("chrome://newtab/", "Новая вкладка")
    assert is_noise_visit("", "Новая вкладка")
    assert is_noise_visit("about:blank", "")
    assert is_noise_visit("edge://newtab/", "New Tab")
    assert not is_noise_visit("https://kontur.ru/", "Контур")
