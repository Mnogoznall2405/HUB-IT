"""Short transactions for monitoring configuration, samples and incidents."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from uuid import uuid4, uuid5, NAMESPACE_URL

from sqlalchemy import delete, func, inspect, or_, select

from backend.appdb.db import app_session, get_app_engine
from backend.appdb.monitoring_models import (MonitoringAggregate, MonitoringEvent, MonitoringInterface,
                                           MonitoringProfile, MonitoringSample, MonitoringTarget, MonitoringWorkerState)
from backend.services.network_monitor_calculations import aggregate_values, chart_values, interface_rates, merge_aggregates, number, timestamp, utc
from backend.services.secret_crypto_service import decrypt_secret, encrypt_secret


class MonitoringNotReady(RuntimeError):
    pass


class MonitoringStore:
    def __init__(self, database_url: str | None = None):
        self.database_url = database_url

    def session(self):
        return app_session(self.database_url)

    def ready(self):
        engine = get_app_engine(self.database_url)
        schema = "app" if engine.dialect.name == "postgresql" else None
        if not inspect(engine).has_table("monitoring_targets", schema=schema):
            raise MonitoringNotReady("Нужна миграция раздела «Мониторинг»")

    @staticmethod
    def target_row(session, target_id, *, lock=False):
        query = select(MonitoringTarget).where(MonitoringTarget.id == target_id)
        row = session.scalar(query.with_for_update() if lock else query)
        if row is None:
            raise LookupError("Устройство не найдено")
        return row

    @staticmethod
    def target_data(row):
        return {"id": row.id, "network_device_id": row.network_device_id, "name": row.name,
                "address": row.address, "port": row.port, "profile_id": row.profile_id,
                "enabled": row.enabled, "settings": row.settings, "current": row.current,
                "updated_at": utc(row.updated_at).isoformat()}

    @staticmethod
    def interface_data(row):
        return {"id": row.id, "name": row.name, "snmp_index": row.snmp_index,
                "settings": row.settings, "current": row.current}

    @staticmethod
    def event_data(row):
        return {"id": row.id, "target_id": row.target_id, "interface_id": row.interface_id,
                "kind": row.kind, "title": row.title, "severity": row.severity,
                "opened_at": utc(row.opened_at).isoformat(),
                "closed_at": utc(row.closed_at).isoformat() if row.closed_at else None}

    def profiles(self):
        with self.session() as session:
            return [{"id": row.id, "name": row.name, "configured": bool(row.community_enc)}
                    for row in session.scalars(select(MonitoringProfile).order_by(MonitoringProfile.name))]

    def save_profile(self, payload, profile_id=None):
        secret = payload.pop("community", None)
        encrypted = encrypt_secret(secret.get_secret_value()) if secret is not None else None
        with self.session() as session:
            row = session.get(MonitoringProfile, profile_id) if profile_id else None
            if profile_id and row is None:
                raise LookupError("Профиль не найден")
            if row is None:
                row = MonitoringProfile(id=str(uuid4()), name=payload["name"], community_enc=encrypted)
                session.add(row)
            if payload.get("name") is not None:
                row.name = payload["name"].strip()
            if encrypted is not None:
                row.community_enc = encrypted
            row.updated_at = datetime.now(timezone.utc)
            return {"id": row.id, "name": row.name, "configured": True}

    def save_target(self, payload, target_id=None):
        with self.session() as session:
            if session.get(MonitoringProfile, payload["profile_id"]) is None:
                raise ValueError("Выберите существующий профиль SNMP")
            row = self.target_row(session, target_id, lock=True) if target_id else None
            conflict = session.scalar(select(MonitoringTarget).where(MonitoringTarget.network_device_id == payload["network_device_id"]))
            if conflict is not None and conflict.id != target_id:
                raise ValueError("Эта учётная карточка уже подключена")
            if row is not None and row.network_device_id != payload["network_device_id"]:
                raise ValueError("Учётную карточку цели нельзя заменить: создайте отдельную цель")
            if row is None:
                row = MonitoringTarget(id=str(uuid4()), current={})
                session.add(row)
            reset = row.address is not None and (row.address != str(payload["address"]) or row.profile_id != payload["profile_id"] or row.port != payload["port"])
            for key in ("network_device_id", "name", "profile_id", "port", "enabled", "settings"):
                setattr(row, key, payload[key])
            row.address = str(payload["address"])
            row.updated_at = datetime.now(timezone.utc)
            if reset:
                row.current = {}
                for interface in session.scalars(select(MonitoringInterface).where(MonitoringInterface.target_id == row.id)):
                    interface.current = {}
            session.flush()
            return self.target_data(row)

    def targets(self):
        with self.session() as session:
            return [self.target_data(row) for row in session.scalars(select(MonitoringTarget).order_by(MonitoringTarget.name))]

    def delete_target(self, target_id):
        # Record/configuration take the same parent row lock. An in-flight
        # probe cannot write samples after this transaction removes its target.
        with self.session() as session:
            self.target_row(session, target_id, lock=True)
            for model in (MonitoringSample, MonitoringAggregate, MonitoringEvent, MonitoringInterface):
                session.execute(delete(model).where(model.target_id == target_id))
            session.execute(delete(MonitoringTarget).where(MonitoringTarget.id == target_id))

    def _attach_outages(self, session, targets, interfaces=None):
        """Latest connection episodes and every open episode, in one bounded batch."""
        if not targets:
            return
        ranked = select(MonitoringEvent.id, func.row_number().over(
            partition_by=MonitoringEvent.target_id,
            order_by=(MonitoringEvent.opened_at.desc(), MonitoringEvent.id.desc())).label("position")).where(
                MonitoringEvent.target_id.in_([row["id"] for row in targets]),
                MonitoringEvent.kind.in_(("unreachable", "link"))).subquery()
        events = list(session.scalars(select(MonitoringEvent).join(ranked, ranked.c.id == MonitoringEvent.id).where(
            or_(ranked.c.position <= 3, MonitoringEvent.closed_at.is_(None))).order_by(MonitoringEvent.opened_at.desc())))
        if interfaces is None:
            ids = {event.interface_id for event in events if event.interface_id}
            interfaces = list(session.scalars(select(MonitoringInterface).where(MonitoringInterface.id.in_(ids)))) if ids else []
        names = {row.id: row.name for row in interfaces}
        roles = {row.id: (row.settings or {}).get("role") for row in interfaces}
        grouped = {row["id"]: [] for row in targets}
        for event in events:
            grouped[event.target_id].append({**self.event_data(event), "interface_name": names.get(event.interface_id), "interface_role": roles.get(event.interface_id)})
        for target in targets:
            target["outages"] = grouped[target["id"]]

    def overview_targets(self, now):
        """One bounded batch for real card sparklines, no per-card history requests."""
        now = utc(now)
        with self.session() as session:
            targets = [self.target_data(row) for row in session.scalars(select(MonitoringTarget).order_by(MonitoringTarget.name))]
            if not targets:
                return targets
            interfaces = list(session.scalars(select(MonitoringInterface).where(
                MonitoringInterface.target_id.in_([row["id"] for row in targets])).order_by(MonitoringInterface.snmp_index)))
            self._attach_outages(session, targets, interfaces)
            self._attach_summaries(session, targets, interfaces, now)
            return targets

    def _attach_summaries(self, session, targets, interfaces, now):
        chosen = {}
        for item in interfaces:
            def priority(interface):
                settings, current = interface.settings or {}, interface.current or {}
                return (bool(settings.get("pinned")), settings.get("role") == "wan", bool(settings.get("critical")),
                        current.get("oper") == 1 and current.get("type") == 6, current.get("oper") == 1)
            previous = chosen.get(item.target_id)
            if previous is None or priority(item) > priority(previous):
                chosen[item.target_id] = item
        since = datetime.fromtimestamp(int((utc(now) - timedelta(hours=6)).timestamp()) // 300 * 300, timezone.utc)
        rows = list(session.scalars(select(MonitoringAggregate).where(
            MonitoringAggregate.interface_id.in_([row.id for row in chosen.values()]),
            MonitoringAggregate.resolution == 300, MonitoringAggregate.bucket_at >= since,
            MonitoringAggregate.bucket_at <= now))) if chosen else []
        values = {(row.interface_id, utc(row.bucket_at)): chart_values(row.values, True) for row in rows}
        for target in targets:
            item = chosen.get(target["id"])
            target["summary"] = None
            if item is None:
                continue
            target["summary"] = {"interface_id": item.id, "name": item.name, "pinned": bool((item.settings or {}).get("pinned")), **{
                key: (item.current or {}).get(key) for key in ("checked_at", "rx_bps", "tx_bps", "speed_bps")}, "points": []}
            at = since
            while at <= now:
                metrics = values.get((item.id, at), {})
                target["summary"]["points"].append({"at": at.isoformat(), "rx_bps": metrics.get("rx_bps"), "tx_bps": metrics.get("tx_bps")})
                at += timedelta(minutes=5)

    def detail(self, target_id):
        with self.session() as session:
            result = self.target_data(self.target_row(session, target_id))
            result["interfaces"] = [self.interface_data(row) for row in session.scalars(
                select(MonitoringInterface).where(MonitoringInterface.target_id == target_id).order_by(MonitoringInterface.snmp_index))]
            result["events"] = [self.event_data(row) for row in session.scalars(
                select(MonitoringEvent).where(MonitoringEvent.target_id == target_id).order_by(MonitoringEvent.opened_at.desc()).limit(50))]
            self._attach_outages(session, [result])
            return result

    def credential(self, profile_id):
        with self.session() as session:
            row = session.get(MonitoringProfile, profile_id)
            if row is None:
                raise ValueError("Профиль SNMP не найден")
            encrypted = row.community_enc
        return decrypt_secret(encrypted)

    def save_interface(self, target_id, interface_id, settings, now=None):
        with self.session() as session:
            if session.bind.dialect.name == "sqlite":
                # SQLite has no FOR UPDATE: serialize this read/modify/write
                # transaction too, so two successful pins cannot coexist.
                session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            target = self.target_row(session, target_id, lock=True)
            interfaces = list(session.scalars(select(MonitoringInterface).where(
                MonitoringInterface.target_id == target_id).order_by(MonitoringInterface.snmp_index)))
            row = next((item for item in interfaces if item.id == interface_id), None)
            if row is None:
                raise LookupError("Интерфейс не найден")
            pinned = settings.get("pinned", bool((row.settings or {}).get("pinned")))
            row.settings = {**settings, "pinned": pinned}
            if pinned:
                for other in interfaces:
                    if other.id != interface_id and (other.settings or {}).get("pinned"):
                        other.settings = {**other.settings, "pinned": False}
            session.flush()
            card = self.target_data(target)
            self._attach_summaries(session, [card], interfaces, utc(now or datetime.now(timezone.utc)))
            return {**self.interface_data(row), "target_summary": card["summary"]}

    def events(self, target_id=None, limit=100):
        with self.session() as session:
            query = select(MonitoringEvent)
            if target_id:
                self.target_row(session, target_id)
                query = query.where(MonitoringEvent.target_id == target_id)
            return [self.event_data(row) for row in session.scalars(query.order_by(MonitoringEvent.opened_at.desc()).limit(limit))]

    @staticmethod
    def _samples(session, target_id, series, now, duration=60):
        # Deterministic identifiers make sample retries and aggregate updates idempotent.
        sample_at = utc(now).replace(second=0, microsecond=0)
        new = []
        identifiers = {iid: str(uuid5(NAMESPACE_URL, f"monitor:{target_id}:{iid}:{sample_at.isoformat()}")) for iid in series}
        existing = set(session.scalars(select(MonitoringSample.id).where(MonitoringSample.id.in_(list(identifiers.values())))))
        for iid, values in series.items():
            if identifiers[iid] in existing:
                continue
            session.add(MonitoringSample(id=identifiers[iid], target_id=target_id, interface_id=iid, observed_at=sample_at, values=values))
            new.append((iid, values))
        if not new:
            return
        buckets = {resolution: datetime.fromtimestamp(int(sample_at.timestamp()) // resolution * resolution, timezone.utc) for resolution in (300, 3600)}
        aggregate_rows = list(session.scalars(select(MonitoringAggregate).where(
            MonitoringAggregate.target_id == target_id, MonitoringAggregate.bucket_at.in_(list(buckets.values())))))
        index = {(r.interface_id, r.resolution, utc(r.bucket_at)): r for r in aggregate_rows}
        for iid, values in new:
            for resolution, bucket in buckets.items():
                key = (iid, resolution, bucket)
                row = index.get(key)
                if row is None:
                    row = MonitoringAggregate(id=str(uuid4()), target_id=target_id, interface_id=iid,
                                              resolution=resolution, bucket_at=bucket, values={})
                    session.add(row)
                    index[key] = row
                row.values = aggregate_values(row.values, values, min(180, max(1, duration)))

    @staticmethod
    def _rule(session, opened, state, target_id, iid, kind, condition, title, now, delay=60, severity="warning", started_at=None):
        key = f"{iid}:{kind}"
        rule = dict(state.get(key) or {})
        if condition is None:
            rule.pop("since", None)
        elif condition:
            since = timestamp(rule.get("since")) or now
            rule["since"] = since.isoformat()
            if (now - since).total_seconds() >= delay and key not in opened:
                event = MonitoringEvent(id=str(uuid4()), target_id=target_id, interface_id=iid, kind=kind,
                                        title=title, severity=severity, opened_at=started_at or (since if kind == "link" else now))
                session.add(event)
                opened[key] = event
        else:
            rule = {}
            event = opened.pop(key, None)
            if event is not None:
                event.closed_at = now
        state[key] = rule

    def record(self, target, snapshot, now):
        now = utc(now)
        with self.session() as session:
            row = self.target_row(session, target["id"], lock=True)
            if not row.enabled or utc(row.updated_at).isoformat() != target["updated_at"]:
                return False  # Configuration changed while the request was in flight.
            previous = dict(row.current or {})
            previous_at = timestamp(previous.get("checked_at"))
            if previous_at and now <= previous_at:
                return False
            settings = row.settings or {}
            snmp_ok = snapshot.get("snmp_status") == "ok"
            full = snapshot.get("full", True)
            ping = snapshot.get("ping", {})
            reachable = snmp_ok or ping.get("status") == "online"
            previous_success = previous.get("last_success_at")
            failures = 0 if reachable else int(previous.get("failures", 0)) + 1
            current = {**previous, "checked_at": now.isoformat(), "ping": ping, "snmp_status": snapshot.get("snmp_status", "error"),
                       "snmp_error": snapshot.get("error"), "last_success_at": now.isoformat() if snmp_ok else previous_success,
                       "failures": failures, "status": "online" if reachable else ("offline" if failures >= settings.get("failure_polls", 3) else "unknown")}
            if snmp_ok:
                current["device"] = {**(previous.get("device") or {}), **snapshot.get("device", {})}
                if snapshot.get("discovered_at"):
                    current["discovered_at"] = snapshot["discovered_at"]
            rules = dict(previous.get("rules") or {})
            opened = {f"{e.interface_id}:{e.kind}": e for e in session.scalars(select(MonitoringEvent).where(
                MonitoringEvent.target_id == row.id, MonitoringEvent.closed_at.is_(None)))}
            availability = dict(previous.get("availability") or {})
            if not availability:
                availability = {"initial_state_known": not bool(previous_at),
                                "observed_since": now.isoformat() if previous_at is None else None,
                                "ever_reachable": bool(previous_success)}
            if reachable:
                if availability.get("initial_state_known") and not availability.get("ever_reachable"):
                    availability["first_reachable_at"] = now.isoformat()
                availability.update(ever_reachable=True, last_reachable_at=now.isoformat())
                availability.pop("unreachable_since", None)
            elif not availability.get("unreachable_since"):
                existing = opened.get(":unreachable")
                availability["unreachable_since"] = utc(existing.opened_at).isoformat() if existing else now.isoformat()
            current["availability"] = availability
            rule = lambda iid, kind, condition, title, **kw: self._rule(session, opened, rules, row.id, iid, kind, condition, title, now, **kw)
            rule("", "unreachable", failures >= settings.get("failure_polls", 3), "Устройство недоступно из HUB", delay=0, severity="critical",
                 started_at=timestamp(availability.get("unreachable_since")))
            rule("", "snmp", not snmp_ok if ping.get("status") == "online" else (False if snmp_ok else None), "Нет ответа SNMP")
            device = snapshot.get("device", {}) if snmp_ok else {}
            for key, limit, title in (("cpu_pct", settings.get("cpu_warn", 85), "Высокая загрузка CPU"),
                                      ("memory_pct", settings.get("memory_warn", 90), "Высокая загрузка памяти"),
                                      ("temperature_c", settings.get("temperature_warn", 75), "Высокая температура")):
                value = number(device.get(key))
                if full:
                    rule("", key, value > limit if value is not None else None, title, delay=300)
            for key, metric, threshold, title in (("latency", "latency_ms", settings.get("latency_warn_ms", 150), "Высокая задержка от HUB"),
                                                  ("loss", "loss_pct", settings.get("loss_warn_pct", 20), "Потери ICMP от HUB")):
                value = number(ping.get(metric))
                rule("", key, value > threshold if value is not None else None, title, delay=300)
            uptime = device.get("hardware_uptime_ticks") or device.get("uptime_ticks")
            previous_device = previous.get("device") or {}
            old_uptime = previous_device.get("hardware_uptime_ticks") or previous_device.get("uptime_ticks")
            if number(uptime) is not None and number(old_uptime) is not None and uptime < old_uptime:
                event = MonitoringEvent(id=str(uuid4()), target_id=row.id, interface_id="", kind="restart",
                                        title="Изменился uptime устройства", severity="info", opened_at=now, closed_at=now)
                session.add(event)
            known = {item.name: item for item in session.scalars(select(MonitoringInterface).where(MonitoringInterface.target_id == row.id))}
            series = {"": {**{key: number(device.get(key)) for key in ("cpu_pct", "memory_pct", "temperature_c", "storage_pct")},
                           "latency_ms": number(ping.get("latency_ms")), "loss_pct": number(ping.get("loss_pct")),
                           "snmp_up": 1 if snmp_ok else 0, "ping_up": 1 if ping.get("status") == "online" else (0 if ping.get("status") == "offline" else None)}}
            for data in snapshot.get("interfaces", []) if snmp_ok else []:
                name = str(data.get("name") or "").strip()
                if not name:
                    continue
                item = known.get(name)
                if item is None:
                    item = MonitoringInterface(id=str(uuid4()), target_id=row.id, name=name, snmp_index=data["snmp_index"],
                                               settings={"history_enabled": True, "role": "wifi" if data.get("type") == 71 else ("lan" if data.get("type") == 6 else "other"), "critical": False}, current={})
                    session.add(item)
                    known[name] = item
                config = item.settings or {}
                before = dict(item.current or {})
                if before.get("mac") and data.get("mac") and before["mac"] != data["mac"]:
                    rule(item.id, "identity", True, f"{name}: изменился MAC, нужна проверка привязки", delay=0)
                    continue
                rule(item.id, "identity", False if data.get("mac") else None, f"{name}: изменился MAC, нужна проверка привязки", delay=0)
                updated = {**before, **data, "checked_at": now.isoformat()}
                changed = (before.get("snmp_index") != data.get("snmp_index") or before.get("oper") != data.get("oper")
                           or (before.get("last_change_ticks") is not None and data.get("last_change_ticks") is not None and before["last_change_ticks"] != data["last_change_ticks"]))
                if not full and (changed or data.get("oper") != 1):
                    updated.update({key: None for key in ("counter_uptime", "rx_bps", "tx_bps", "rx_bytes", "tx_bytes", "rx_seconds", "tx_seconds", "rx_errors_pps", "tx_errors_pps", "rx_discards_pps", "tx_discards_pps")})
                if full:
                    updated.update(interface_rates(before, data, now, uptime, before.get("counter_uptime", old_uptime)))
                    updated.update(counter_checked_at=now.isoformat(), counter_uptime=uptime)
                reference = number(before.get("reference_speed_bps")) or number(before.get("speed_bps")) or 0
                updated["reference_speed_bps"] = max(reference, number(data.get("speed_bps")) or 0)
                for direction in ("rx", "tx"):
                    capacity = number(config.get(f"capacity_{direction}_bps")) or number(data.get("speed_bps"))
                    traffic = updated.get(f"{direction}_bps")
                    updated[f"{direction}_util_pct"] = 100 * traffic / capacity if capacity and traffic is not None else None
                item.snmp_index, item.current = data["snmp_index"], updated
                valid_state = data.get("oper") is not None and data.get("admin") is not None
                critical = config.get("critical", False)
                changes = [at for at in before.get("link_changes", []) if timestamp(at) and (now - timestamp(at)).total_seconds() <= 300]
                if before.get("oper") in (1, 2) and data.get("oper") in (1, 2) and before["oper"] != data["oper"]:
                    changes.append(now.isoformat())
                    updated["state_changed_at"] = now.isoformat()
                updated["link_changes"] = changes[-20:]
                rule(item.id, "flapping", len(changes) >= 5 if valid_state and critical and data.get("admin") == 1 else (False if valid_state else None), f"{name}: частые изменения состояния линка", delay=0)
                rule(item.id, "link", data["oper"] == 2 and data["admin"] == 1 if valid_state and critical else (False if valid_state else None), f"{name}: потеря линка", delay=30, severity="critical")
                expected = number(config.get("expected_link_bps")) or reference
                speed = number(data.get("speed_bps"))
                low_speed = bool(speed < expected) if expected and speed and data.get("oper") == 1 and critical else (False if valid_state else None)
                rule(item.id, "speed", low_speed, f"{name}: снизилась скорость соединения", delay=30)
                utilizations = [updated[k] for k in ("rx_util_pct", "tx_util_pct") if updated.get(k) is not None]
                if full:
                    rule(item.id, "utilization", max(utilizations) > config.get("utilization_warn", 85) if utilizations else None, f"{name}: высокая загрузка канала", delay=300)
                errors = [updated[k] for k in ("rx_errors_pps", "tx_errors_pps", "rx_discards_pps", "tx_discards_pps") if updated.get(k) is not None]
                if full:
                    rule(item.id, "errors", max(errors) > config.get("errors_warn_pps", 2) if errors else None, f"{name}: ошибки или отбрасывания пакетов", delay=300)
                if config.get("history_enabled", True) and (data.get("oper") == 1 or critical):
                    series[item.id] = {key: number(updated.get(key)) for key in ("rx_bps", "tx_bps", "rx_bytes", "tx_bytes", "rx_seconds", "tx_seconds", "rx_util_pct", "tx_util_pct", "speed_bps", "rx_errors_pps", "tx_errors_pps", "rx_discards_pps", "tx_discards_pps", "oper")}
            current["rules"] = rules
            current["open_events"] = len(opened)
            row.current = current
            sample_age = (now - (timestamp(previous.get("sample_at")) or datetime.min.replace(tzinfo=timezone.utc))).total_seconds()
            if full and sample_age >= 55:
                self._samples(session, row.id, series, now, min(sample_age, 60))
                current["sample_at"] = now.isoformat()
                row.current = dict(current)
            return True

    def history(self, target_id, interface_id, hours, now, *, start=None, end=None):
        now = utc(now)
        if (start is None) != (end is None):
            raise ValueError("Укажите начало и конец периода")
        if start is not None:
            if start.tzinfo is None or end.tzinfo is None:
                raise ValueError("В датах периода нужен часовой пояс")
            since, until = utc(start), utc(end)
            if since >= until or until > now + timedelta(minutes=1) or until - since > timedelta(days=365):
                raise ValueError("Нужен прошедший период продолжительностью не более года")
            now, hours = until, (until - since).total_seconds() / 3600
        else:
            since = now - timedelta(hours=hours)
        resolution = 60 if hours <= 168 else (300 if hours <= 720 else 3600)
        with self.session() as session:
            self.target_row(session, target_id)
            if interface_id:
                interface = session.get(MonitoringInterface, interface_id)
                if interface is None or interface.target_id != target_id:
                    raise LookupError("Интерфейс не найден")
            if resolution == 60:
                query = select(MonitoringSample).where(MonitoringSample.target_id == target_id, MonitoringSample.interface_id == interface_id,
                                                       MonitoringSample.observed_at > since, MonitoringSample.observed_at <= now).order_by(MonitoringSample.observed_at)
                source = [(utc(r.observed_at), aggregate_values({}, r.values)) for r in session.scalars(query)]
            else:
                query = select(MonitoringAggregate).where(MonitoringAggregate.target_id == target_id, MonitoringAggregate.interface_id == interface_id,
                    MonitoringAggregate.resolution == resolution, MonitoringAggregate.bucket_at >= since,
                    MonitoringAggregate.bucket_at < datetime.fromtimestamp(int(now.timestamp()) // resolution * resolution, timezone.utc)).order_by(MonitoringAggregate.bucket_at)
                source = [(utc(r.bucket_at), r.values) for r in session.scalars(query)]
        # Gap-aware resampling, with a strict output bound even for a full year.
        step = resolution * max(1, math.ceil(hours * 3600 / resolution / 1400))
        groups = {}
        for at, values in source:
            bucket = int(at.timestamp()) // step * step
            groups[bucket] = merge_aggregates(groups.get(bucket, {}), values)
        points = []
        first = int(since.timestamp()) // step * step
        last = int(now.timestamp()) // step * step
        for bucket in range(first, last + 1, step):
            values = chart_values(groups.get(bucket, {}), True)
            points.append({"at": datetime.fromtimestamp(bucket, timezone.utc).isoformat(), **values})
        combined = {}
        for _, values in source:
            combined = merge_aggregates(combined, values)
        totals = {key: value for key, value in chart_values(combined, True).items() if key.endswith(("_bytes", "_seconds"))}
        return {"points": points, "totals": totals, "resolution_seconds": step, "has_data": bool(source), "interface_id": interface_id}

    def retention(self, now, *, apply=False, batch_size=1000):
        """Bounded cleanup; default is dry-run, raw data requires both rollups."""
        now = utc(now)
        batch_size = max(1, min(1000, batch_size))
        with self.session() as session:
            raw = list(session.scalars(select(MonitoringSample).where(
                MonitoringSample.observed_at < now - timedelta(days=7)).order_by(MonitoringSample.observed_at).limit(batch_size)))
            buckets = {resolution: {datetime.fromtimestamp(int(utc(row.observed_at).timestamp()) // resolution * resolution, timezone.utc) for row in raw} for resolution in (300, 3600)}
            rollups = list(session.scalars(select(MonitoringAggregate).where(
                MonitoringAggregate.target_id.in_({row.target_id for row in raw}),
                MonitoringAggregate.bucket_at.in_(buckets[300] | buckets[3600])))) if raw else []
            coverage = {(r.target_id, r.interface_id, r.resolution, utc(r.bucket_at)): r.values for r in rollups}
            safe = []
            for row in raw:
                covered = True
                for resolution in (300, 3600):
                    bucket = datetime.fromtimestamp(int(utc(row.observed_at).timestamp()) // resolution * resolution, timezone.utc)
                    stats = coverage.get((row.target_id, row.interface_id, resolution, bucket))
                    covered &= stats is not None and all(key in stats and stats[key]["min"] <= value <= stats[key]["max"]
                        for key, value in row.values.items() if number(value) is not None)
                if covered:
                    safe.append(row.id)
            # Keep rollups while any raw data in their time window is retained.
            oldest = session.scalar(select(func.min(MonitoringSample.observed_at)))
            raw_boundary = utc(oldest).replace(minute=0, second=0, microsecond=0) if oldest else now
            aggregates = list(session.scalars(select(MonitoringAggregate.id).where(
                ((MonitoringAggregate.resolution == 300) & (MonitoringAggregate.bucket_at < min(raw_boundary, now - timedelta(days=30)))) |
                ((MonitoringAggregate.resolution == 3600) & (MonitoringAggregate.bucket_at < min(raw_boundary, now - timedelta(days=365))))
            ).limit(batch_size)))
            if apply:
                if safe:
                    session.execute(delete(MonitoringSample).where(MonitoringSample.id.in_(safe)))
                if aggregates:
                    session.execute(delete(MonitoringAggregate).where(MonitoringAggregate.id.in_(aggregates)))
            return {"dry_run": not apply, "raw_eligible": len(safe), "raw_without_rollups": len(raw) - len(safe), "aggregates_eligible": len(aggregates)}

    def heartbeat(self, duration=None):
        with self.session() as session:
            row = session.get(MonitoringWorkerState, 1)
            if row is None:
                row = MonitoringWorkerState(id=1)
                session.add(row)
            row.heartbeat_at = datetime.now(timezone.utc)
            row.cycle_seconds = duration

    def worker_state(self):
        with self.session() as session:
            row = session.get(MonitoringWorkerState, 1)
            return {"heartbeat_at": utc(row.heartbeat_at).isoformat() if row and row.heartbeat_at else None,
                    "cycle_seconds": row.cycle_seconds if row else None}
