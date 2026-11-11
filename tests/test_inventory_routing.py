from __future__ import annotations

from pathlib import Path


def test_web_config_routes_exact_inventory_ingest_to_dedicated_backend():
    config_path = Path(__file__).resolve().parents[1] / "WEB-itinvent" / "frontend" / "public" / "web.config"
    content = config_path.read_text(encoding="utf-8")

    inventory_rule = '<match url="^api/v1/inventory$" />'
    generic_rule = '<match url="^api/(.*)" />'

    assert inventory_rule in content
    assert generic_rule in content
    assert content.index(inventory_rule) < content.index(generic_rule)
    assert "http://127.0.0.1:8012/api/v1/inventory" in content
