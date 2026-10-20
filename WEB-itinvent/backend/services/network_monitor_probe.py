"""Bounded ICMP and read-only IF-MIB/MikroTik SNMPv2c collection."""
from __future__ import annotations

import asyncio
import platform
import re
import subprocess
from datetime import datetime, timezone

from backend.services.network_monitor_calculations import timestamp

DEVICE_OIDS = {
    "sys_name": "1.3.6.1.2.1.1.5.0", "description": "1.3.6.1.2.1.1.1.0",
    "object_id": "1.3.6.1.2.1.1.2.0", "uptime_ticks": "1.3.6.1.2.1.1.3.0",
    "hardware_uptime_ticks": "1.3.6.1.2.1.25.1.1.0", "serial": "1.3.6.1.4.1.14988.1.1.7.3.0",
}
STATE_OIDS = {"admin": "1.3.6.1.2.1.2.2.1.7", "oper": "1.3.6.1.2.1.2.2.1.8", "last_change_ticks": "1.3.6.1.2.1.2.2.1.9", "speed_mbps": "1.3.6.1.2.1.31.1.1.1.15"}
COUNTER_OIDS = {"rx_octets": "1.3.6.1.2.1.31.1.1.1.6", "tx_octets": "1.3.6.1.2.1.31.1.1.1.10",
                "rx_errors": "1.3.6.1.2.1.2.2.1.14", "tx_errors": "1.3.6.1.2.1.2.2.1.20",
                "rx_discards": "1.3.6.1.2.1.2.2.1.13", "tx_discards": "1.3.6.1.2.1.2.2.1.19",
                "discontinuity": "1.3.6.1.2.1.31.1.1.1.19"}
NAME_BASE = "1.3.6.1.2.1.31.1.1.1.1"


def _ping(address):
    windows = platform.system().lower() == "windows"
    command = ["ping", "-n", "3", "-w", "800", address] if windows else ["ping", "-n", "-c", "3", "-W", "1", address]
    try:
        result = subprocess.run(command, capture_output=True, timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if windows else 0)
        output = result.stdout.decode("oem" if windows else "utf-8", errors="replace")
        replies = len(re.findall(r"ttl=\d+", output, re.I))
        times = [float(v) for line in output.splitlines() if re.search(r"ttl=\d+", line, re.I)
                 for v in re.findall(r"[=<]\s*([\d.]+)\s*(?:ms|мс)", line, re.I)]
        online = replies > 0 or result.returncode == 0
        return {"status": "online" if online else "offline", "loss_pct": 100 * (3 - min(3, replies)) / 3 if replies or not online else None,
                "latency_ms": sum(times) / len(times) if times else None}
    except subprocess.TimeoutExpired:
        return {"status": "offline", "loss_pct": 100, "latency_ms": None}
    except OSError:
        return {"status": "unknown", "loss_pct": None, "latency_ms": None}


class NetworkMonitorProbe:
    async def read(self, target, community, *, full=True):
        ping_task = asyncio.create_task(asyncio.to_thread(_ping, target["address"]))
        result = {"full": full, "snmp_status": "error", "error": "timeout", "device": {}, "interfaces": []}
        engine = None
        try:
            from pysnmp.hlapi.asyncio import (CommunityData, ContextData, ObjectIdentity, ObjectType,
                                             SnmpEngine, UdpTransportTarget, bulk_cmd, get_cmd)
            from pyasn1.type.univ import Integer
            engine = SnmpEngine()
            transport = await UdpTransportTarget.create((target["address"], target["port"]), timeout=1.5, retries=0)
            auth, context = CommunityData(community, mpModel=1), ContextData()

            def oid_text(identity):
                return ".".join(map(str, identity.get_oid() if hasattr(identity, "get_oid") else identity))

            def value(raw):
                if raw.__class__.__name__ in {"NoSuchObject", "NoSuchInstance", "EndOfMibView"}:
                    return None
                return int(raw) if isinstance(raw, Integer) else raw.prettyPrint().replace(community, "[redacted]")

            async def get(oids):
                values = {}
                for offset in range(0, len(oids), 20):
                    batch = oids[offset:offset + 20]
                    error, status, _, bindings = await get_cmd(engine, auth, transport, context,
                        *(ObjectType(ObjectIdentity(oid)) for oid in batch))
                    if error or status:
                        continue
                    values.update({oid_text(oid): value(raw) for oid, raw in bindings})
                return values

            async def walk(base, maximum=128):
                rows, cursor = {}, base
                for _ in range((maximum + 11) // 12):
                    error, status, _, bindings = await bulk_cmd(engine, auth, transport, context, 0, 12, ObjectType(ObjectIdentity(cursor)))
                    if error or status:
                        return rows, False
                    previous = cursor
                    for oid, raw in bindings:
                        key = oid_text(oid)
                        if not key.startswith(base + ".") or value(raw) is None:
                            return rows, True
                        rows[key[len(base) + 1:]] = value(raw)
                        cursor = key
                    if cursor == previous or len(rows) >= maximum:
                        return rows, False
                return rows, False

            async with asyncio.timeout(12 if full else 8):
                basic = await get(list(DEVICE_OIDS.values()))
                if not basic:
                    return {**result, "ping": await ping_task}
                result.update(snmp_status="ok", error=None)
                result["device"] = {key: basic.get(oid) for key, oid in DEVICE_OIDS.items()}
                now = datetime.now(timezone.utc)
                last_discovery = timestamp(target.get("current", {}).get("discovered_at"))
                interfaces = [{**row["current"], "name": row["name"], "snmp_index": row["snmp_index"], "settings": row["settings"]}
                              for row in target.get("interfaces", [])]
                discovery = full and (not interfaces or not last_discovery or (now - last_discovery).total_seconds() >= 900)
                if discovery:
                    names, complete = await walk(NAME_BASE)
                    # Incomplete discovery never prunes or pretends a device has zero ports.
                    if names:
                        previous = {r["name"]: r for r in interfaces}
                        interfaces = [{**previous.get(str(name), {}), "name": str(name), "snmp_index": int(idx)} for idx, name in names.items() if idx.isdigit()]
                        meta = {"alias": "1.3.6.1.2.1.31.1.1.1.18", "type": "1.3.6.1.2.1.2.2.1.3", "mac": "1.3.6.1.2.1.2.2.1.6"}
                        metadata = await get([f"{base}.{row['snmp_index']}" for row in interfaces for base in meta.values()])
                        for row in interfaces:
                            row.update({key: metadata.get(f"{base}.{row['snmp_index']}") for key, base in meta.items()})
                        if complete:
                            result["discovered_at"] = now.isoformat()
                result["interfaces"] = interfaces
                for row in interfaces:
                    row.update({key: None for key in STATE_OIDS})
                    row["speed_bps"] = None
                    if full:
                        row.update({key: None for key in COUNTER_OIDS})
                states = await get([f"{base}.{row['snmp_index']}" for row in interfaces for base in STATE_OIDS.values()])
                for row in interfaces:
                    state = {key: states.get(f"{base}.{row['snmp_index']}") for key, base in STATE_OIDS.items()}
                    row.update(state)
                    row["speed_bps"] = state.pop("speed_mbps") * 1_000_000 if isinstance(state.get("speed_mbps"), int) else None
                result["interfaces"] = interfaces
                if full:
                    monitored = [r for r in interfaces if r.get("oper") == 1 or r.get("settings", {}).get("critical")]
                    counters = await get([f"{base}.{row['snmp_index']}" for row in monitored for base in COUNTER_OIDS.values()])
                    for row in monitored:
                        row.update({key: counters.get(f"{base}.{row['snmp_index']}") for key, base in COUNTER_OIDS.items()})
                    previous_device = target.get("current", {}).get("device") or {}
                    storage_indexes = previous_device.get("storage_indexes")
                    if discovery or storage_indexes is None:
                        types, complete = await walk("1.3.6.1.2.1.25.2.3.1.2", 32)
                        if complete:
                            storage_indexes = [int(index) for index, kind in types.items() if index.isdigit() and str(kind) == "1.3.6.1.2.1.25.2.1.4"]
                            result["device"]["storage_indexes"] = storage_indexes
                    storage_oids = [f"1.3.6.1.2.1.25.2.3.1.{column}.{index}" for index in storage_indexes or [] for column in (4, 5, 6)]
                    resources = {"allocation": "1.3.6.1.2.1.25.2.3.1.4.65536", "total": "1.3.6.1.2.1.25.2.3.1.5.65536",
                                 "used": "1.3.6.1.2.1.25.2.3.1.6.65536", "temperature": "1.3.6.1.4.1.14988.1.1.3.10.0",
                                 "cpu_temperature": "1.3.6.1.4.1.14988.1.1.3.11.0"}
                    if not discovery and previous_device.get("cpu_temperature_supported") is False:
                        resources.pop("cpu_temperature")
                    all_resources = await get(list(resources.values()) + storage_oids)
                    resource_values = all_resources
                    resource_values = {key: resource_values.get(oid) for key, oid in resources.items()}
                    cpu, _ = await walk("1.3.6.1.2.1.25.3.3.1.2", 16)
                    temperatures = resource_values.get("temperature")
                    total, used = resource_values.get("total"), resource_values.get("used")
                    disks = [{column: all_resources.get(f"1.3.6.1.2.1.25.2.3.1.{column}.{index}") for column in (4, 5, 6)} for index in storage_indexes or []]
                    valid_disks = bool(disks) and all(all(isinstance(d[c], int) for c in (4, 5, 6)) and d[4] > 0 and d[5] > 0 for d in disks)
                    disk_total = sum(d[4] * d[5] for d in disks) if valid_disks else None
                    disk_used = sum(d[4] * d[6] for d in disks) if valid_disks else None
                    result["device"].update(cpu_pct=sum(cpu.values()) / len(cpu) if cpu and all(isinstance(v, int) for v in cpu.values()) else None,
                        memory_pct=100 * used / total if isinstance(total, int) and total > 0 and isinstance(used, int) else None,
                        memory_total_bytes=total * resource_values["allocation"] if isinstance(total, int) and isinstance(resource_values.get("allocation"), int) else None,
                        temperature_c=temperatures / 10 if isinstance(temperatures, int) else None,
                        cpu_temperature_c=resource_values["cpu_temperature"] / 10 if isinstance(resource_values.get("cpu_temperature"), int) else None,
                        storage_pct=100 * disk_used / disk_total if disk_total else None,
                        storage_total_bytes=disk_total, storage_used_bytes=disk_used, resources_at=now.isoformat())
                    if "cpu_temperature" in resources:
                        result["device"]["cpu_temperature_supported"] = isinstance(resource_values.get("cpu_temperature"), int)
                result["interfaces"] = [{key: value for key, value in row.items() if key != "settings"} for row in interfaces]
        except ImportError:
            result["error"] = "SNMP-клиент недоступен"
        except TimeoutError:
            result["error"] = "Неполный опрос" if result["snmp_status"] == "ok" else "timeout"
        except Exception:
            # Do not expose library exceptions: they may contain authentication data.
            result["error"] = "Ошибка SNMP-клиента"
        finally:
            if engine:
                engine.close_dispatcher()
            result["ping"] = await ping_task
        return result
