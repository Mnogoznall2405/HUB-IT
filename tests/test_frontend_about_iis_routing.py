from pathlib import Path
from xml.etree import ElementTree


WEB_CONFIG = (
    Path(__file__).resolve().parents[1]
    / "WEB-itinvent"
    / "frontend"
    / "public"
    / "web.config"
)


def test_about_directory_is_rewritten_to_the_spa_before_the_generic_fallback():
    root = ElementTree.parse(WEB_CONFIG).getroot()
    rules = root.findall("./system.webServer/rewrite/rules/rule")
    names = [rule.get("name") for rule in rules]

    about_rule = next(rule for rule in rules if rule.get("name") == "Public About SPA Entry")
    match = about_rule.find("match")
    action = about_rule.find("action")

    assert names.index("Public About SPA Entry") < names.index("React Router Fallback")
    assert about_rule.get("stopProcessing") == "true"
    assert match is not None and match.get("url") == r"^about/?$"
    assert action is not None and action.attrib == {
        "type": "Rewrite",
        "url": "index.html",
    }
