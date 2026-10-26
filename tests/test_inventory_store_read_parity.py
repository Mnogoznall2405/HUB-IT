"""Идентичность Core-выборок AppInventoryStore прежним ORM-путям (app-db sqlite).

Оракул: тот же запрос через ORM-сущности и тот же построитель payload (_row_payload), а для
list_sql_contexts — прежняя ORM-выборка с построением словаря контекста. Сценарии: скрытые хосты,
hidden_only, хосты без MAC (ключ по hostname), контексты без inv_no (не привязка), контексты
другой БД и выборка по набору хостов.
"""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import or_, select

from backend.appdb.db import app_session
from backend.appdb.inventory_store import AppInventoryStore, _normalize_mac, _normalize_text
from backend.appdb.models import AppInventoryHost, AppInventoryHostSqlContext


def _host_payload(index: int, *, mac: str, hostname: str) -> dict:
    return {
        "mac_address": mac,
        "hostname": hostname,
        "user_login": f"user{index}",
        "user_full_name": f"Сотрудник {index}",
        "ip_primary": f"10.0.0.{index}",
        "report_type": "full_snapshot",
        "last_seen_at": 1_710_000_000 + index,
        "os_name": "Windows 11 Pro",
        "hardware": {"cpu": f"CPU{index}"},
    }


def _seed(store: AppInventoryStore) -> None:
    for index in range(1, 5):
        store.upsert_host(_host_payload(index, mac=f"AA-BB-CC-DD-EE-0{index}", hostname=f"PC-0{index}"))
    store.upsert_host(_host_payload(9, mac="", hostname="NOMAC-PC"))
    store.set_host_hidden("AA-BB-CC-DD-EE-02", hidden=True, hidden_by="admin")

    store.bind_sql_context_row(
        mac_address="AA-BB-CC-DD-EE-01",
        hostname="PC-01",
        db_id="DB1",
        context={"inv_no": "INV-1", "branch_name": "Tyumen", "branch_no": "101", "employee_name": "Иванов"},
    )
    store.bind_sql_context_row(
        mac_address="AA-BB-CC-DD-EE-02",
        hostname="PC-02",
        db_id="DB1",
        context={"inv_no": "INV-2", "branch_name": "Moscow"},
    )
    store.bind_sql_context_row(
        mac_address="AA-BB-CC-DD-EE-03",
        hostname="PC-03",
        db_id="DB2",
        context={"inv_no": "INV-3", "branch_name": "Kazan", "model_name": "HP"},
    )
    # Контекст без inv_no: строка есть, но привязкой не считается.
    store.upsert_sql_context(
        mac_address="AA-BB-CC-DD-EE-04",
        hostname="PC-04",
        db_id="DB1",
        context={"branch_name": "Tyumen"},
    )


def _oracle_hosts(url: str, *, host_keys=None, include_hidden=False, hidden_only=False) -> list[dict]:
    with app_session(url) as session:
        stmt = select(AppInventoryHost).order_by(AppInventoryHost.mac_address.asc())
        if host_keys is not None:
            normalized = [_normalize_mac(item) or str(item or "").strip().lower() for item in host_keys]
            normalized = [item for item in normalized if item]
            if not normalized:
                return []
            stmt = stmt.where(AppInventoryHost.mac_address.in_(normalized))
        if hidden_only:
            stmt = stmt.where(AppInventoryHost.hidden_at.is_not(None))
        elif not include_hidden:
            stmt = stmt.where(AppInventoryHost.hidden_at.is_(None))
        rows = session.scalars(stmt).all()
        return [AppInventoryStore._row_payload(row) for row in rows]


def _oracle_sql_contexts(url: str, *, hosts: list[dict], db_ids: list[str]) -> dict:
    normalized_db_ids = [_normalize_text(item) for item in db_ids if _normalize_text(item)]
    macs: list[str] = []
    hostnames: list[str] = []
    for host in hosts:
        mac = _normalize_mac(host.get("mac_address"))
        hostname = _normalize_text(host.get("hostname")).lower()
        if mac and mac not in macs:
            macs.append(mac)
        if hostname and hostname not in hostnames:
            hostnames.append(hostname)
    filters = []
    if macs:
        filters.append(AppInventoryHostSqlContext.mac_address.in_(macs))
    if hostnames:
        filters.append(AppInventoryHostSqlContext.hostname.in_(hostnames))
    with app_session(url) as session:
        rows = session.scalars(
            select(AppInventoryHostSqlContext)
            .where(AppInventoryHostSqlContext.db_id.in_(normalized_db_ids))
            .where(AppInventoryHostSqlContext.inventory_inv_no.isnot(None))
            .where(AppInventoryHostSqlContext.inventory_inv_no != "")
            .where(or_(*filters))
            .order_by(AppInventoryHostSqlContext.updated_at.desc())
        ).all()
    contexts: dict = {}
    for row in rows:
        mac = _normalize_mac(row.mac_address)
        hostname = _normalize_text(row.hostname).lower()
        db_id = _normalize_text(row.db_id)
        if not db_id:
            continue
        payload = {
            "branch_no": row.branch_no,
            "branch_name": row.branch_name,
            "location_name": row.location_name,
            "employee_name": row.employee_name,
            "inv_no": row.inventory_inv_no,
            "model_name": row.inventory_model_name,
            "ip_address": row.ip_address,
        }
        for key in ((mac, hostname, db_id), (mac, "", db_id), ("", hostname, db_id)):
            if (key[0] or key[1]) and key not in contexts:
                contexts[key] = payload
    return contexts


def test_list_hosts_core_select_matches_orm_rows_for_visibility_modes(temp_dir):
    url = f"sqlite:///{(Path(temp_dir) / 'parity_hosts.db').as_posix()}"
    store = AppInventoryStore(database_url=url)
    _seed(store)

    assert store.list_hosts() == _oracle_hosts(url)
    assert store.list_hosts(include_hidden=True) == _oracle_hosts(url, include_hidden=True)
    assert store.list_hosts(hidden_only=True) == _oracle_hosts(url, hidden_only=True)
    keys = ["aa-bb-cc-dd-ee-03", "AA-BB-CC-DD-EE-02", "missing"]
    assert store.list_hosts(keys, include_hidden=True) == _oracle_hosts(url, host_keys=keys, include_hidden=True)
    hidden_row = store.list_hosts(hidden_only=True)[0]
    assert hidden_row["is_hidden"] is True and hidden_row["hidden_by"] == "admin"


def test_list_sql_contexts_core_select_matches_orm_for_bound_rows_only(temp_dir):
    url = f"sqlite:///{(Path(temp_dir) / 'parity_contexts.db').as_posix()}"
    store = AppInventoryStore(database_url=url)
    _seed(store)
    hosts = store.list_hosts(include_hidden=True) + [{"mac_address": "", "hostname": "pc-04"}]

    for db_ids in (["DB1"], ["DB1", "DB2"], ["DB2"]):
        actual = store.list_sql_contexts(hosts=hosts, db_ids=db_ids)
        assert actual == _oracle_sql_contexts(url, hosts=hosts, db_ids=db_ids), db_ids

    contexts = store.list_sql_contexts(hosts=hosts, db_ids=["DB1"])
    assert ("AABBCCDDEE01", "pc-01", "DB1") in contexts
    assert ("AABBCCDDEE04", "pc-04", "DB1") not in contexts, "контекст без inv_no не привязка"
