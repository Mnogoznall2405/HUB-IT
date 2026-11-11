from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.ad_users_service import (  # noqa: E402
    _is_person_password_account,
    is_hub_service_account_login,
)


def test_is_hub_service_account_login_adm_pam_svc():
    assert is_hub_service_account_login("adm_svs") is True
    assert is_hub_service_account_login("pam_svs") is True
    assert is_hub_service_account_login("ADM_EME") is True
    assert is_hub_service_account_login("svc_backup") is True
    assert is_hub_service_account_login(r"ZSGP\adm_svs") is True
    assert is_hub_service_account_login("adm_svs@zsgp.ru") is True


def test_is_hub_service_account_login_keeps_real_people():
    assert is_hub_service_account_login("samkov_vs") is False
    assert is_hub_service_account_login("petrov_ii") is False
    assert is_hub_service_account_login("ivanov") is False


def test_person_password_account_excludes_adm_pam_despite_underscore():
    # Underscore alone used to force "person"; adm_/pam_ must win.
    assert _is_person_password_account("adm_svs", "Самков В.С.") is False
    assert _is_person_password_account("pam_svs", "Самков_В.С.") is False
    assert _is_person_password_account("samkov_vs", "Самков Владимир") is True
