"""Synthetic monitoring history in the isolated Playwright DB. No network IO."""
import math
import os
from copy import deepcopy
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet
from pydantic import SecretStr
from sqlalchemy import select


def seed_monitoring():
    from backend.appdb.db import app_session
    from backend.appdb.models import AppUser
    from backend.models.monitoring import TargetCreate
    from backend.services.network_service import network_service
    from backend.services.network_monitor_store import MonitoringStore
    from backend.services.secret_crypto_service import _build_fernet

    if not os.environ["APP_DATABASE_URL"].startswith("sqlite:///") or network_service._database_url != os.environ["APP_DATABASE_URL"]:
        raise RuntimeError("Monitoring fixtures require the isolated E2E SQLite database")

    os.environ["MAIL_CREDENTIALS_KEY"] = Fernet.generate_key().decode()
    _build_fernet.cache_clear()
    branch = network_service.create_branch_with_profile(city_code="E2E", branch_code="MON", name="Тестовый филиал", actor_user_id=None, actor_role="admin")["branch"]
    devices = [network_service.create_device(branch_id=branch["id"], payload={"device_code": name, "model": "MikroTik CRS125", "mgmt_ip": f"192.0.2.{10 + i}"}, actor_user_id=None, actor_role="admin")
               for i, name in enumerate(("Mozhaisk_MikroTik-CRS125-24G-1S-2HnD", "Склад · коммутатор", "Новый коммутатор"))]
    store = MonitoringStore()
    profile = store.save_profile({"name": "Тестовый SNMP", "community": SecretStr("test-only-network-profile")})
    targets = [store.save_target(TargetCreate(network_device_id=d["id"], name=d["device_code"], address=d["mgmt_ip"], profile_id=profile["id"]).model_dump()) for d in devices[:2]]
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    counter = 0
    for minute in range(76):
        at = now - timedelta(minutes=75-minute)
        counter += int((20 + 12 * math.sin(minute / 6)) * 1e6 * 60 / 8)
        snap = {"full": True, "snmp_status": "ok", "error": None, "ping": {"status": "online", "latency_ms": 35 + 5 * math.sin(minute / 3), "loss_pct": 0},
            "device": {"sys_name": "Mozhaisk", "description": "MikroTik CRS125 · RouterOS", "serial": "synthetic-fixture", "hardware_uptime_ticks": 1000000 + minute * 6000,
                       "uptime_ticks": 1000000 + minute * 6000, "cpu_pct": 25 + 15 * math.sin(minute / 8), "memory_pct": 47, "temperature_c": 32},
            "interfaces": [{"name": "ether1_wan", "snmp_index": 2, "type": 6, "admin": 1, "oper": 1, "speed_bps": 1_000_000_000,
                "rx_octets": counter, "tx_octets": counter // 3, "rx_errors": 0, "tx_errors": 0, "rx_discards": 0, "tx_discards": 0},
                {"name": "ether24_uplink", "snmp_index": 25, "type": 6, "admin": 1, "oper": 1, "speed_bps": 1_000_000_000,
                 "rx_octets": counter // 2, "tx_octets": counter // 4, "rx_errors": 0, "tx_errors": 0, "rx_discards": 0, "tx_discards": 0},
                {"name": "ether8", "snmp_index": 9, "type": 6, "admin": 2, "oper": 2, "speed_bps": 0}]}
        if minute in (35, 36):
            snap = {"full": True, "snmp_status": "error", "error": "timeout", "ping": {"status": "online", "latency_ms": 40, "loss_pct": 0}}
        if 10 <= minute < 28:
            snap = {"full": True, "snmp_status": "error", "error": "timeout", "ping": {"status": "offline", "loss_pct": 100}}
        store.record(targets[0], snap, at)
    interface = next(row for row in store.detail(targets[0]["id"])["interfaces"] if row["name"] == "ether1_wan")
    from backend.models.monitoring import InterfaceSettings
    store.save_interface(targets[0]["id"], interface["id"], InterfaceSettings(role="wan", critical=True, expected_link_bps=1e9, capacity_rx_bps=100e6, capacity_tx_bps=100e6).model_dump())
    for minute in range(3):
        store.record(targets[1], {"full": True, "snmp_status": "error", "error": "timeout", "ping": {"status": "offline", "loss_pct": 100}}, now - timedelta(minutes=2-minute))
    # Twenty synthetic devices exercise the card grid at the agreed initial scale.
    # No address is polled; all time series below are explicit test fixtures.
    from uuid import uuid4
    from backend.appdb.monitoring_models import MonitoringAggregate
    from backend.services.network_monitor_calculations import aggregate_values, utc
    priority_names = (
        "Kotelny_Island_MikroTik-CRS125-24G-1S-2HnD", "Tiksi_MikroTik-RB951Ui-2HnD",
        "SPB_MikroTik-CCR2116-12G-4S (резерв)", "Центральный_MikroTik-CCR2116-12G-4S+",
        "MSK_MikroTik-RB4011iGS (резерв)", "SPB_MikroTik-CCR2116-12G-4S", "MSK_MikroTik-RB4011iGS",
    )
    for index in range(18):
        name = priority_names[index] if index < len(priority_names) else f"Филиал {index + 3:02d} · MikroTik"
        device = network_service.create_device(branch_id=branch["id"], payload={"device_code": name, "model": "MikroTik CRS125", "mgmt_ip": f"192.0.2.{index + 13}"}, actor_user_id=None, actor_role="admin")
        target = store.save_target(TargetCreate(network_device_id=device["id"], name=device["device_code"], address=device["mgmt_ip"], profile_id=profile["id"]).model_dump())
        for step in range(2):
            data = deepcopy(snap)
            data["device"].update(sys_name=device["device_code"], cpu_pct=10 + index, serial=f"synthetic-{index}", uptime_ticks=1000000 + step * 6000, hardware_uptime_ticks=1000000 + step * 6000)
            data["interfaces"] = data["interfaces"][:1]
            data["interfaces"][0].update(rx_octets=(step + 1) * (index + 1) * 7_500_000, tx_octets=(step + 1) * (index + 1) * 2_500_000)
            store.record(target, data, now - timedelta(minutes=21-step if index == 0 else 4-step if index == 1 else 1-step))
        interface = store.detail(target["id"])["interfaces"][0]
        if index == 0:
            for minute in (18, 17, 16, 0):
                store.record(target, {"full": True, "snmp_status": "error", "error": "timeout",
                    "ping": {"status": "offline", "loss_pct": 100}}, now - timedelta(minutes=minute))
        if index == 1:
            store.save_interface(target["id"], interface["id"], InterfaceSettings(role="wan", critical=True).model_dump())
            # The device is reachable while its important WAN port has no link.
            for minute in (2, 1, 0):
                data = deepcopy(data)
                data["interfaces"][0]["oper"] = 2
                store.record(target, data, now - timedelta(minutes=minute))
        with store.session() as session:
            existing = {utc(at) for at in session.scalars(select(MonitoringAggregate.bucket_at).where(MonitoringAggregate.target_id == target["id"], MonitoringAggregate.interface_id == interface["id"], MonitoringAggregate.resolution == 300))}
            end = now.replace(minute=now.minute // 5 * 5)
            for bucket in range(72):
                at = end - timedelta(minutes=5 * bucket)
                if at in existing:
                    continue
                rx = (index + 1) * 1e6 * (1 + 0.5 * math.sin(bucket / 4 + index))
                session.add(MonitoringAggregate(id=str(uuid4()), target_id=target["id"], interface_id=interface["id"], resolution=300, bucket_at=at, values=aggregate_values({}, {"rx_bps": rx, "tx_bps": rx / 3}, 300)))
    with app_session() as session:
        row = session.scalar(select(AppUser).where(AppUser.username == "e2e_user"))
        row.use_custom_permissions = True
        row.custom_permissions_json = '["monitoring.read"]'
