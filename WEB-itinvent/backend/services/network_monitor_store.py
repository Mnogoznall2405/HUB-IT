"""Short transactions for monitoring configuration, samples and incidents."""
from __future__ import annotations

import math
import os
import threading
import time
from collections import OrderedDict
from concurrent.futures import Future
from datetime import datetime, timedelta, timezone
from uuid import uuid4, uuid5, NAMESPACE_URL

from sqlalchemy import delete, func, inspect, or_, select, update

from backend.appdb.db import app_session, get_app_engine
from backend.appdb.monitoring_models import (MonitoringAggregate, MonitoringEvent, MonitoringInterface,
                                           MonitoringProfile, MonitoringSample, MonitoringTarget, MonitoringWorkerState)
from backend.services.network_monitor_calculations import aggregate_values, chart_values, interface_rates, merge_aggregates, number, timestamp, utc
from backend.services.secret_crypto_service import decrypt_secret, encrypt_secret


# A change of any of these is written at once; the rest of a port row is only counters and poll timestamps.
INTERFACE_STATE_KEYS = ("admin", "oper", "speed_bps", "mac", "type", "last_change_ticks", "state_changed_at")
INTERFACE_WRITE_TOLERANCE_SECONDS = 15


def unpinned_write_seconds() -> int:
    """How often a port that the device card does not show is persisted (0 = on every poll)."""
    try:
        return max(0, min(900, int(os.getenv("MONITORING_UNPINNED_WRITE_SECONDS", "300"))))
    except ValueError:
        return 300


def summary_priority(interface):
    """Which port a device card shows: pinned, else WAN, else critical, else the first LAN port that is up."""
    settings, current = interface.settings or {}, interface.current or {}
    return (bool(settings.get("pinned")), settings.get("role") == "wan", bool(settings.get("critical")),
            current.get("oper") == 1 and current.get("type") == 6, current.get("oper") == 1)


def summary_interface(interfaces):
    chosen = None
    for item in interfaces:
        if chosen is None or summary_priority(item) > summary_priority(chosen):
            chosen = item
    return chosen


class MonitoringNotReady(RuntimeError):
    pass


class MonitoringStore:
    def __init__(self, database_url: str | None = None):
        self.database_url = database_url
        self._history_cache = OrderedDict()
        self._history_pending = {}
        self._history_lock = threading.Lock()

    def session(self):
        return app_session(self.database_url)

    def collection_limits(self):
        from backend.config import config
        engine = get_app_engine(self.database_url)
        budget = config.app_db.pool_size + config.app_db.max_overflow
        # Owner + four SNMP leases; retain at least six connections for writes/API.
        icmp = 12 if engine.dialect.name == "sqlite" else max(1, min(12, budget - 11))
        return {"icmp": icmp, "snmp": 4}

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
        return {"id": row.id, "network_device_id": row.network_device_id, "object_ref": row.object_ref, "name": row.name,
                "address": row.address, "port": row.port, "profile_id": row.profile_id,
                "enabled": row.enabled, "settings": row.settings, "current": row.current,
                "updated_at": utc(row.updated_at).isoformat()}

    @staticmethod
    def is_present(row):
        # A port the device stopped reporting stays stored (settings, history) but leaves lists and polling.
        return not (row.current or {}).get("absent_since")

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
            card_id = payload.get("network_device_id")
            if card_id is not None:
                conflict = session.scalar(select(MonitoringTarget).where(MonitoringTarget.network_device_id == card_id))
                if conflict is not None and conflict.id != target_id:
                    raise ValueError("Эта учётная карточка уже подключена")
                if row is not None and row.network_device_id is not None and row.network_device_id != card_id:
                    raise ValueError("Учётную карточку цели нельзя заменить: создайте отдельную цель")
            if row is None:
                row = MonitoringTarget(id=str(uuid4()), current={})
                session.add(row)
            elif row.enabled != payload["enabled"] and row.current:
                current = dict(row.current or {})
                pauses = [dict(pause) for pause in current.get("icmp_pauses", [])]
                changed_at = datetime.now(timezone.utc).isoformat()
                if not payload["enabled"]:
                    pauses.append({"from": changed_at, "until": None})
                elif pauses and pauses[-1].get("until") is None:
                    pauses[-1]["until"] = changed_at
                if len(pauses) > 256:
                    current["icmp_pause_history_since"] = pauses[-256]["from"]
                current["icmp_pauses"] = pauses[-256:]
                row.current = current
            reset = row.address is not None and (row.address != str(payload["address"]) or row.profile_id != payload["profile_id"] or row.port != payload["port"])
            for key in ("name", "profile_id", "port", "enabled", "settings"):
                setattr(row, key, payload[key])
            if "object_ref" in payload:
                row.object_ref = str(payload["object_ref"] or "").strip() or None
            if card_id is not None:
                row.network_device_id = card_id
            row.address = str(payload["address"])
            row.updated_at = datetime.now(timezone.utc)
            if reset:
                row.current = {}
                for interface in session.scalars(select(MonitoringInterface).where(MonitoringInterface.target_id == row.id)):
                    interface.current = {}
            session.flush()
            return self.target_data(row)

    def target_object_ref(self, target_id):
        with self.session() as session:
            return self.target_row(session, target_id).object_ref

    def unassigned_targets(self):
        """Devices that belong to no IT object yet: the pool an object manager may pick from."""
        with self.session() as session:
            rows = session.scalars(select(MonitoringTarget).where(MonitoringTarget.object_ref.is_(None)).order_by(MonitoringTarget.name))
            return [{"id": row.id, "name": row.name, "address": row.address} for row in rows]

    def move_target_object(self, target_id, object_ref, *, release=False):
        """Attach a free device to the object, or detach it from that same object, in one conditional UPDATE."""
        free_or_same = MonitoringTarget.object_ref == object_ref if release else or_(
            MonitoringTarget.object_ref.is_(None), MonitoringTarget.object_ref == object_ref)
        with self.session() as session:
            changed = session.execute(update(MonitoringTarget).where(MonitoringTarget.id == target_id, free_or_same)
                .values(object_ref=None if release else object_ref, updated_at=datetime.now(timezone.utc))).rowcount
            if changed:
                return
            row = self.target_row(session, target_id)
            if release and row.object_ref is None:
                return
            raise ValueError("Устройство привязано к другому объекту")

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

    def overview_targets(self, now, object_ref=None):
        """One bounded batch for real card sparklines, no per-card history requests."""
        now = utc(now)
        query = select(MonitoringTarget).order_by(MonitoringTarget.name)
        if object_ref is not None:
            query = query.where(MonitoringTarget.object_ref == object_ref)
        with self.session() as session:
            targets = [self.target_data(row) for row in session.scalars(query)]
            if not targets:
                return targets
            interfaces = list(session.scalars(select(MonitoringInterface).where(
                MonitoringInterface.target_id.in_([row["id"] for row in targets])).order_by(MonitoringInterface.snmp_index)))
            self._attach_outages(session, targets, interfaces)
            self._attach_summaries(session, targets, [row for row in interfaces if self.is_present(row)], now)
            return targets

    def _attach_summaries(self, session, targets, interfaces, now):
        chosen = {}
        for item in interfaces:
            previous = chosen.get(item.target_id)
            if previous is None or summary_priority(item) > summary_priority(previous):
                chosen[item.target_id] = item
        since = datetime.fromtimestamp(int((utc(now) - timedelta(hours=6)).timestamp()) // 300 * 300, timezone.utc)
        # target_id lets the planner use the (target, interface, resolution, bucket) index instead of scanning every interface's window.
        # Sparklines show only rx/tx: read three columns, not whole entities, and convert just those two series.
        rows = session.execute(select(MonitoringAggregate.interface_id, MonitoringAggregate.bucket_at,
            MonitoringAggregate.values.label("series")).where(
            MonitoringAggregate.target_id.in_([row.target_id for row in chosen.values()]),
            MonitoringAggregate.interface_id.in_([row.id for row in chosen.values()]),
            MonitoringAggregate.resolution == 300, MonitoringAggregate.bucket_at >= since,
            MonitoringAggregate.bucket_at <= now)).all() if chosen else []
        values = {(row.interface_id, utc(row.bucket_at)): chart_values({key: row.series[key] for key in ("rx_bps", "tx_bps") if key in row.series}, True)
                  for row in rows}
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
                select(MonitoringInterface).where(MonitoringInterface.target_id == target_id).order_by(MonitoringInterface.snmp_index)) if self.is_present(row)]
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

    def probe_target(self, target_id, *, include_interfaces=True):
        """Collector input without UI events, outage ranking or card sparklines."""
        with self.session() as session:
            result = self.target_data(self.target_row(session, target_id))
            result["interfaces"] = [self.interface_data(row) for row in session.scalars(
                select(MonitoringInterface).where(MonitoringInterface.target_id == target_id)) if self.is_present(row)] if include_interfaces else []
            return result

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
    def _samples(session, target_id, series, now, duration=60, *, merge_device=False):
        # Deterministic identifiers make sample retries and aggregate updates idempotent.
        sample_at = utc(now).replace(second=0, microsecond=0)
        if merge_device and "" in series:
            MonitoringStore._merge_device_sample(session, target_id, series[""], sample_at)
            series = {iid: values for iid, values in series.items() if iid}
            if not series:
                return
        new = []
        identifiers = {iid: str(uuid5(NAMESPACE_URL, f"monitor:{target_id}:{iid}:{sample_at.isoformat()}")) for iid in series}
        existing = set(session.scalars(select(MonitoringSample.id).where(MonitoringSample.id.in_(list(identifiers.values())))))
        for iid, values in series.items():
            if identifiers[iid] in existing:
                continue
            interval = number(values.get("rx_seconds")) or number(values.get("tx_seconds")) or duration
            interval = min(180, max(1, interval))
            stored = {**values, "_duration": interval} if merge_device else values
            session.add(MonitoringSample(id=identifiers[iid], target_id=target_id, interface_id=iid, observed_at=sample_at, values=stored))
            new.append((iid, values, interval))
        if not new:
            return
        buckets = {resolution: datetime.fromtimestamp(int(sample_at.timestamp()) // resolution * resolution, timezone.utc) for resolution in (300, 3600)}
        # Full unique-index key (target, interface, resolution, bucket): without interface/resolution Postgres scans
        # the whole target range of uq_monitoring_aggregate (~1/35 of a 400 MB index) on every recorded sample.
        aggregate_rows = list(session.scalars(select(MonitoringAggregate).where(
            MonitoringAggregate.target_id == target_id, MonitoringAggregate.interface_id.in_([iid for iid, _, _ in new]),
            MonitoringAggregate.resolution.in_(list(buckets)), MonitoringAggregate.bucket_at.in_(list(buckets.values())))))
        index = {(r.interface_id, r.resolution, utc(r.bucket_at)): r for r in aggregate_rows}
        for iid, values, interval in new:
            for resolution, bucket in buckets.items():
                key = (iid, resolution, bucket)
                row = index.get(key)
                if row is None:
                    row = MonitoringAggregate(id=str(uuid4()), target_id=target_id, interface_id=iid,
                                              resolution=resolution, bucket_at=bucket, values={})
                    session.add(row)
                    index[key] = row
                row.values = aggregate_values(row.values, values, interval)

    @staticmethod
    def _merge_device_sample(session, target_id, values, sample_at):
        """Replace one minute's rollup contribution; never add it a second time."""
        identifier = str(uuid5(NAMESPACE_URL, f"monitor:{target_id}::{sample_at.isoformat()}"))
        row = session.scalar(select(MonitoringSample).where(MonitoringSample.target_id == target_id,
            MonitoringSample.interface_id == "", MonitoringSample.observed_at == sample_at))
        if row is not None and "_stats" not in row.values:
            # Preserve the transition minute: the old writer did not save trustworthy packet counts/weights.
            return
        prior = (row.values.get("_stats") or aggregate_values({}, row.values)) if row else {}
        weights = values.get("_weights", {})
        stats = prior
        for key, value in values.items():
            if not key.startswith("_"):
                stats = merge_aggregates(stats, aggregate_values({}, {key: value}, weights.get(key, 60)))
        metrics = {key: value for key, value in chart_values(stats, True).items() if not key.endswith(("_min", "_max"))}
        if row is None:
            row = MonitoringSample(id=identifier, target_id=target_id, interface_id="", observed_at=sample_at, values={})
            session.add(row)
        row.values = {**(row.values or {}), **metrics, "_stats": stats}
        session.flush()
        hour = sample_at.replace(minute=0)
        minute5 = sample_at.replace(minute=sample_at.minute // 5 * 5)
        rollups = {(r.resolution, utc(r.bucket_at)): r for r in session.scalars(select(MonitoringAggregate).where(
            MonitoringAggregate.target_id == target_id, MonitoringAggregate.interface_id == "",
            MonitoringAggregate.resolution.in_((300, 3600)), MonitoringAggregate.bucket_at.in_((hour, minute5))))}
        for resolution, bucket in ((300, minute5), (3600, hour)):
            aggregate = rollups.get((resolution, bucket))
            if aggregate is None:
                # Rebuild only a missing bucket. Existing legacy weights stay untouched.
                combined = {}
                raw = session.scalars(select(MonitoringSample).where(MonitoringSample.target_id == target_id,
                    MonitoringSample.interface_id == "", MonitoringSample.observed_at >= bucket,
                    MonitoringSample.observed_at < bucket + timedelta(seconds=resolution)))
                for sample in raw:
                    combined = merge_aggregates(combined, sample.values.get("_stats") or aggregate_values({}, sample.values))
                aggregate = MonitoringAggregate(id=str(uuid4()), target_id=target_id, interface_id="", resolution=resolution, bucket_at=bucket, values={})
                session.add(aggregate)
                aggregate.values = combined
            else:
                combined = {key: dict(value) for key, value in aggregate.values.items()}
                for key, after in stats.items():
                    before = prior.get(key, {})
                    previous = combined.get(key, {})
                    combined[key] = {"sum": previous.get("sum", 0) + after["sum"] - before.get("sum", 0),
                        "weight": previous.get("weight", 0) + after["weight"] - before.get("weight", 0),
                        "count": previous.get("count", 0) + after["count"] - before.get("count", 0),
                        "min": min(previous.get("min", after["min"]), after["min"]),
                        "max": max(previous.get("max", after["max"]), after["max"])}
                aggregate.values = combined

    @staticmethod
    def _interface_write_needed(item, before, updated, shown, data, now):
        """Only the port the device card shows (pinned, else WAN/critical/first up) is persisted on every poll.

        Other ports are persisted when their state changes and otherwise every ``unpinned_write_seconds()``;
        their rates are then averaged over that period.
        """
        interval = unpinned_write_seconds()
        if shown or interval <= 0 or not before or item.snmp_index != data["snmp_index"]:
            return True
        if any(before.get(key) != updated.get(key) for key in INTERFACE_STATE_KEYS):
            return True
        stored_at = timestamp(before.get("checked_at"))
        return stored_at is None or (now - stored_at).total_seconds() >= interval - INTERFACE_WRITE_TOLERANCE_SECONDS

    @staticmethod
    def _icmp_sample(session, target_id, ping, now, scheduled_at=None, backoff_until=None):
        # Six bounded slots share the existing minute row; no new table or row rate.
        session.flush()
        scheduled = timestamp(scheduled_at)
        slot_time = scheduled if scheduled and scheduled <= now < scheduled + timedelta(seconds=10) else now
        minute = slot_time.replace(second=0, microsecond=0)
        row = session.scalar(select(MonitoringSample).where(MonitoringSample.target_id == target_id,
            MonitoringSample.interface_id == "", MonitoringSample.observed_at == minute))
        if row is None:
            row = MonitoringSample(id=str(uuid5(NAMESPACE_URL, f"monitor:{target_id}::{minute.isoformat()}")),
                target_id=target_id, interface_id="", observed_at=minute, values={"_stats": {}})
            session.add(row)
        slots = dict((row.values or {}).get("_icmp_10s") or {})
        key = str(slot_time.second // 10 * 10)
        prior = slots.get(key) or {}
        # Manual refresh must not erase the evidence of an automatic check.
        if not scheduled and prior.get("source") == "scheduled":
            return
        error = ping.get("error")
        error = error if error in {"collector_timeout", "process_error"} else ("collector_error" if error else None)
        slots[key] = {"observed_at": now.isoformat(), "started_at": ping.get("started_at") or now.isoformat(),
            "completed_at": ping.get("completed_at"), "scheduled_at": scheduled_at,
            "source": "scheduled" if scheduled else "manual", "status": ping.get("status", "unknown"),
            "error": error, "sent": number(ping.get("sent")), "received": number(ping.get("received")),
            "loss_pct": number(ping.get("loss_pct")) if not error else None,
            "latency_ms": number(ping.get("latency_ms")) if ping.get("status") == "online" and not error else None,
            "partial_latency_ms": number(ping.get("latency_ms")) if error else None,
            "backoff_until": backoff_until}
        row.values = {**(row.values or {}), "_icmp_10s": slots}

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

    def record(self, target, snapshot, now, *, return_current=False):
        now = utc(now)
        with self.session() as session:
            if session.bind.dialect.name == "sqlite":
                session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            row = self.target_row(session, target["id"], lock=True)
            if not row.enabled or utc(row.updated_at).isoformat() != target["updated_at"]:
                return False  # Configuration changed while the request was in flight.
            previous = dict(row.current or {})
            previous_at = timestamp(previous.get("checked_at"))
            protocol = snapshot.get("protocol")
            split = protocol in {"icmp", "snmp"}
            kinds = (protocol,) if split else ("icmp", "snmp")
            for kind in kinds:
                observed = timestamp(previous.get(f"{kind}_checked_at"))
                if observed is None and not any(previous.get(f"{key}_checked_at") for key in ("icmp", "snmp")):
                    observed = previous_at  # Legacy combined snapshot, before independent protocol clocks.
                if observed and now <= observed:
                    return False
            settings = row.settings or {}
            has_snmp, has_ping = "snmp" in kinds, "icmp" in kinds
            snmp_ok = has_snmp and snapshot.get("snmp_status") == "ok"
            full = has_snmp and snapshot.get("full", True)
            ping = snapshot.get("ping", {}) if has_ping else previous.get("ping", {})
            previous_success = previous.get("last_success_at")
            current = {**previous, "checked_at": max(now, previous_at or now).isoformat()}
            for kind in kinds:
                current[f"{kind}_checked_at"] = now.isoformat()
            if has_ping:
                current["ping"] = ping
            if has_snmp:
                current.update(snmp_status=snapshot.get("snmp_status", "error"), snmp_error=snapshot.get("error"),
                               snmp_quality=snapshot.get("snmp_quality"), last_success_at=now.isoformat() if snmp_ok else previous_success)
            reference = max(now, previous_at or now)
            ping_at = timestamp(current.get("icmp_checked_at"))
            snmp_at = timestamp(current.get("snmp_checked_at"))
            # Success expires quickly; confirmed failures remain usable during the bounded offline backoff.
            ping_fresh = 20 if ping.get("status") == "online" else 75
            snmp_fresh = 45 if current.get("snmp_status") == "ok" else 330
            ping_state = ping.get("status") if ping_at and (reference - ping_at).total_seconds() <= ping_fresh else None
            snmp_state = current.get("snmp_status") if snmp_at and (reference - snmp_at).total_seconds() <= snmp_fresh and current.get("snmp_quality") != "unknown" else None
            reachable = True if ping_state == "online" or snmp_state == "ok" else (False if ping_state == "offline" and snmp_state == "error" else None)
            failures = int(previous.get("failures", 0))
            if reachable is True:
                failures = 0
                current.pop("failure_checked_at", None)
            elif reachable is False:
                counted = timestamp(previous.get("failure_checked_at"))
                if counted is None or (reference - counted).total_seconds() >= 30:
                    failures += 1
                    current["failure_checked_at"] = reference.isoformat()
            elif failures < settings.get("failure_polls", 3):
                failures = 0  # Unknown collection cannot join two separate failure streaks.
                current.pop("failure_checked_at", None)
            current.update(failures=failures, status="online" if reachable is True else ("offline" if reachable is False and failures >= settings.get("failure_polls", 3) else "unknown"))
            if snapshot.get("timings"):
                current["probe_timings"] = {**previous.get("probe_timings", {}), protocol or "combined": snapshot["timings"]}
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
            if reachable is True:
                if availability.get("initial_state_known") and not availability.get("ever_reachable"):
                    availability["first_reachable_at"] = now.isoformat()
                last_reachable = timestamp(availability.get("last_reachable_at")) or now
                availability.update(ever_reachable=True, last_reachable_at=max(now, last_reachable).isoformat())
                availability.pop("unreachable_since", None)
            elif reachable is None and not failures and ":unreachable" not in opened:
                availability.pop("unreachable_since", None)
            elif reachable is False and not availability.get("unreachable_since"):
                existing = opened.get(":unreachable")
                availability["unreachable_since"] = utc(existing.opened_at).isoformat() if existing else now.isoformat()
            current["availability"] = availability
            event_now = reference
            rule = lambda iid, kind, condition, title, **kw: self._rule(session, opened, rules, row.id, iid, kind, condition, title, event_now, **kw)
            confirmed = True if reachable is False and failures >= settings.get("failure_polls", 3) else (False if reachable is True else None)
            rule("", "unreachable", confirmed, "Устройство недоступно из HUB", delay=0, severity="critical",
                 started_at=timestamp(availability.get("unreachable_since")))
            if has_snmp:
                rule("", "snmp", not snmp_ok if ping_state == "online" and snmp_state is not None else (False if snmp_ok else None), "Нет ответа SNMP")
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
                if has_ping:
                    rule("", key, value > threshold if value is not None else None, title, delay=300)
            uptime = device.get("hardware_uptime_ticks") or device.get("uptime_ticks")
            previous_device = previous.get("device") or {}
            old_uptime = previous_device.get("hardware_uptime_ticks") or previous_device.get("uptime_ticks")
            if number(uptime) is not None and number(old_uptime) is not None and uptime < old_uptime:
                event = MonitoringEvent(id=str(uuid4()), target_id=row.id, interface_id="", kind="restart",
                                        title="Изменился uptime устройства", severity="info", opened_at=now, closed_at=now)
                session.add(event)
            known = {item.name: item for item in session.scalars(select(MonitoringInterface).where(MonitoringInterface.target_id == row.id))} if has_snmp else {}
            shown_item = summary_interface(sorted((item for item in known.values() if self.is_present(item)), key=lambda interface: interface.snmp_index or 0))
            # Other ports are persisted rarely, so their counters are compared over that longer period.
            rate_window = max(180, unpinned_write_seconds() + 90)
            series = {"": {**{key: number(device.get(key)) for key in ("cpu_pct", "memory_pct", "temperature_c", "storage_pct")},
                           "latency_ms": number(ping.get("latency_ms")) if has_ping else None, "loss_pct": number(ping.get("loss_pct")) if has_ping else None,
                           "snmp_up": (1 if snmp_ok else (None if current.get("snmp_quality") == "unknown" else 0)) if has_snmp else None,
                           "ping_up": (1 if ping.get("status") == "online" else (0 if ping.get("status") == "offline" else None)) if has_ping else None}}
            if split and has_ping:
                values = series[""]
                sent, received = number(ping.get("sent")), number(ping.get("received"))
                values.update(icmp_checks=1, icmp_unknown_checks=int(ping.get("status") not in {"online", "offline"}),
                              icmp_sent_packets=sent, icmp_received_packets=received if sent is not None else None,
                              _weights={"latency_ms": max(1, received or 0), "loss_pct": max(1, sent or 0), "ping_up": 1})
            elif split:
                series[""]["_weights"] = {"snmp_up": 1}
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
                updated.pop("absent_since", None)
                changed = (before.get("snmp_index") != data.get("snmp_index") or before.get("oper") != data.get("oper")
                           or (before.get("last_change_ticks") is not None and data.get("last_change_ticks") is not None and before["last_change_ticks"] != data["last_change_ticks"]))
                if not full and (changed or data.get("oper") != 1):
                    updated.update({key: None for key in ("counter_uptime", "rx_bps", "tx_bps", "rx_bytes", "tx_bytes", "rx_seconds", "tx_seconds", "rx_errors_pps", "tx_errors_pps", "rx_discards_pps", "tx_discards_pps")})
                if full:
                    updated.update(interface_rates(before, data, now, uptime, before.get("counter_uptime", old_uptime),
                                                   max_elapsed=180 if item is shown_item else rate_window))
                    updated.update(counter_checked_at=now.isoformat(), counter_uptime=uptime)
                reference = number(before.get("reference_speed_bps")) or number(before.get("speed_bps")) or 0
                updated["reference_speed_bps"] = max(reference, number(data.get("speed_bps")) or 0)
                for direction in ("rx", "tx"):
                    capacity = number(config.get(f"capacity_{direction}_bps")) or number(data.get("speed_bps"))
                    traffic = updated.get(f"{direction}_bps")
                    updated[f"{direction}_util_pct"] = 100 * traffic / capacity if capacity and traffic is not None else None
                valid_state = data.get("oper") is not None and data.get("admin") is not None
                critical = config.get("critical", False)
                changes = [at for at in before.get("link_changes", []) if timestamp(at) and (now - timestamp(at)).total_seconds() <= 300]
                if before.get("oper") in (1, 2) and data.get("oper") in (1, 2) and before["oper"] != data["oper"]:
                    changes.append(now.isoformat())
                    updated["state_changed_at"] = now.isoformat()
                updated["link_changes"] = changes[-20:]
                persisted = bool(before.get("absent_since")) or self._interface_write_needed(item, before, updated, item is shown_item, data, now)
                if persisted:
                    item.snmp_index, item.current = data["snmp_index"], updated
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
                # A history point is the persisted row, so a port written rarely gets a point per write.
                if full and persisted and config.get("history_enabled", True) and (data.get("oper") == 1 or critical):
                    series[item.id] = {key: number(updated.get(key)) for key in ("rx_bps", "tx_bps", "rx_bytes", "tx_bytes", "rx_seconds", "tx_seconds", "rx_util_pct", "tx_util_pct", "speed_bps", "rx_errors_pps", "tx_errors_pps", "rx_discards_pps", "tx_discards_pps", "oper")}
            if snmp_ok and snapshot.get("discovered_at"):
                # A complete port discovery is authoritative: ports it no longer lists stop being shown, polled and alerted.
                reported = {str(data.get("name") or "").strip() for data in snapshot.get("interfaces", [])}
                for name, item in known.items():
                    if name in reported or not self.is_present(item):
                        continue
                    item.current = {**(item.current or {}), "absent_since": now.isoformat()}
                    for key in [key for key in opened if key.startswith(f"{item.id}:")]:
                        opened.pop(key).closed_at = now
                    for key in [key for key in rules if key.startswith(f"{item.id}:")]:
                        rules.pop(key)
            current["rules"] = rules
            current["open_events"] = len(opened)
            sample_age = (now - (timestamp(previous.get("sample_at")) or datetime.min.replace(tzinfo=timezone.utc))).total_seconds()
            if split or (full and sample_age >= 55):
                self._samples(session, row.id, series, now, min(sample_age, 60), merge_device=split)
            if has_ping:
                scheduled = timestamp(snapshot.get("scheduled_at"))
                first_check = scheduled if scheduled and scheduled <= now < scheduled + timedelta(seconds=10) else now
                current.setdefault("icmp_history_since", first_check.replace(microsecond=0, second=first_check.second // 10 * 10).isoformat())
                if scheduled:
                    current["icmp_schedule_phase"] = scheduled.timestamp() % 10
                backoff = (now + timedelta(seconds=min(60, 30 * failures))).isoformat() if current["status"] == "offline" else None
                self._icmp_sample(session, row.id, ping, now, snapshot.get("scheduled_at"), backoff)
            if split or has_ping or (full and sample_age >= 55):
                current["sample_at"] = max(now, timestamp(previous.get("sample_at")) or now).isoformat()
                current["history_revision"] = current["sample_at"][:16]
                current["history_data_revision"] = str(uuid4())
            # Minute merge flushes samples: assign JSON only after all revision fields are complete.
            row.current = current
            return current if return_current else True

    @staticmethod
    def _history_period(hours, now, start, end):
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
        return since, now, hours

    def history(self, target_id, interface_id, hours, now, *, start=None, end=None):
        since, now, hours = self._history_period(hours, now, start, end)
        resolution = 60 if hours <= 168 else (300 if hours <= 720 else 3600)
        step = resolution * max(1, math.ceil(hours * 3600 / resolution / 1400))
        with self.session() as session:
            target = self.target_row(session, target_id)
            if interface_id:
                interface = session.get(MonitoringInterface, interface_id)
                if interface is None or interface.target_id != target_id:
                    raise LookupError("Интерфейс не найден")
            current = target.current or {}
            lower = int(since.timestamp()) // 60 if resolution == 60 else math.ceil(since.timestamp() / resolution)
            key = (target_id, interface_id, resolution, step, lower, int(now.timestamp()) // resolution,
                   int(since.timestamp()) // step, int(now.timestamp()) // step, utc(target.updated_at).isoformat(),
                   ((interface.current or {}).get("counter_checked_at") or current.get("sample_at")) if interface_id
                   else current.get("history_data_revision") or current.get("sample_at"))
        # A waiting follower never occupies a database connection. Auth is checked by the route,
        # and target/interface existence and ownership were checked above, including cache hits.
        return self._cached_history(key, lambda: self._history_points(target_id, interface_id, since, now, resolution, step))

    def latency_history(self, target_id, hours, now, *, start=None, end=None, after=None):
        since, until, duration = self._history_period(hours, now, start, end)
        if after is not None and (after.tzinfo is None or utc(after) > until + timedelta(minutes=1)):
            raise ValueError("Для обновления истории нужна дата с часовым поясом внутри прошедшего периода")
        # Long windows retain bounded aggregation. Ten-second detail is available
        # in any selected window up to one day within existing raw retention.
        if duration > 24:
            history = self.history(target_id, "", hours, now, start=start, end=end)
            step = history["resolution_seconds"]
            first = int(since.timestamp()) // step * step
            replace = max(first, int(utc(after).timestamp()) // step * step) if after else first
            points = [{key: value for key, value in point.items() if key == "at" or key.startswith("latency_ms")}
                      | {"source_resolution_seconds": step} for point in history["points"] if timestamp(point["at"]).timestamp() >= replace]
            return {**history, "points": points, "window_start": datetime.fromtimestamp(first, timezone.utc).isoformat(),
                    "replace_from": datetime.fromtimestamp(replace, timezone.utc).isoformat()}
        first = int(since.timestamp()) // 10 * 10
        last = int(until.timestamp()) // 10 * 10
        replace = max(first, int(utc(after).timestamp()) // 10 * 10) if after else first
        with self.session() as session:
            target = self.target_row(session, target_id)
            current = target.current or {}
            quality_since = current.get("icmp_history_since")
            phase = current.get("icmp_schedule_phase", 0)
            pauses = current.get("icmp_pauses", [])
            pause_history_since = current.get("icmp_pause_history_since")
            key = ("latency", target_id, first, last, replace, utc(target.updated_at).isoformat(),
                   current.get("icmp_checked_at"), int(utc(now).timestamp()) // 10)
        return self._cached_history(key, lambda: self._latency_points(target_id, first, last, replace,
            utc(now).timestamp(), quality_since, phase, pauses, pause_history_since))

    def _latency_points(self, target_id, first, last, replace, as_of, quality_since, phase, pauses, pause_history_since):
        lower = datetime.fromtimestamp(replace // 60 * 60 - 60, timezone.utc)
        upper = datetime.fromtimestamp(last, timezone.utc)
        with self.session() as session:
            rows = {int(utc(row.observed_at).timestamp()): row.values for row in session.scalars(select(MonitoringSample).where(
                MonitoringSample.target_id == target_id, MonitoringSample.interface_id == "",
                MonitoringSample.observed_at >= lower, MonitoringSample.observed_at <= upper))}
        points = []
        known_since = timestamp(quality_since)
        pause_since = timestamp(pause_history_since)
        pause_windows = [(timestamp(pause.get("from")), timestamp(pause.get("until"))) for pause in pauses]
        backoff_until = 0
        for minute, values in rows.items():
            for offset, sample in (values.get("_icmp_10s") or {}).items():
                until = timestamp(sample.get("backoff_until"))
                if minute + int(offset) < replace and until:
                    backoff_until = max(backoff_until, until.timestamp())
        for minute in range(replace // 60 * 60, last + 1, 60):
            values = rows.get(minute)
            slots = (values or {}).get("_icmp_10s")
            if values is not None and not slots and ("_stats" not in values or known_since is None or minute + 60 <= known_since.timestamp()):
                if replace <= minute <= last:
                    legacy = chart_values(values.get("_stats") or aggregate_values({}, values), True)
                    points.append({"at": datetime.fromtimestamp(minute, timezone.utc).isoformat(),
                        **{key: value for key, value in legacy.items() if key.startswith("latency_ms")},
                        "quality_status": "legacy", "source_resolution_seconds": 60})
                continue
            for bucket in range(max(minute, replace), min(minute + 50, last) + 1, 10):
                sample = (slots or {}).get(str(bucket - minute), {})
                state = sample.get("status")
                if sample:
                    if sample.get("error") or state == "unknown":
                        quality = "collector_error"
                    elif state in {"online", "offline"}:
                        quality = "partial" if state == "online" and (sample.get("loss_pct") or 0) > 0 else state
                    else:
                        quality = "legacy"  # Old latency-only slots do not prove packet counts.
                elif known_since is None or bucket < known_since.timestamp() or (pause_since and bucket < pause_since.timestamp()):
                    quality = "unobserved"
                elif any(a and a.timestamp() <= bucket + phase and (b is None or bucket + phase < b.timestamp()) for a, b in pause_windows):
                    quality = "paused"
                elif bucket + phase + 10 > as_of:
                    quality = "pending"
                elif bucket + phase < backoff_until:
                    quality = "backoff"
                else:
                    quality = "missing"
                points.append({"at": datetime.fromtimestamp(bucket, timezone.utc).isoformat(),
                    **sample, "latency_ms": sample.get("latency_ms"), "observed_at": sample.get("observed_at"),
                    "quality_status": quality, "source_resolution_seconds": 10})
                until = timestamp(sample.get("backoff_until"))
                if until:
                    backoff_until = max(backoff_until, until.timestamp())
        return {"points": points, "totals": {}, "resolution_seconds": 10, "has_data": any(number(p.get("latency_ms")) is not None for p in points),
            "interface_id": "", "window_start": datetime.fromtimestamp(first, timezone.utc).isoformat(),
            "replace_from": datetime.fromtimestamp(replace, timezone.utc).isoformat(), "quality_since": quality_since}

    def _cached_history(self, key, build):
        with self._history_lock:
            entry = self._history_cache.get(key)
            if entry and time.monotonic() - entry[0] < 30:
                self._history_cache.move_to_end(key)
                return entry[1]
            pending = self._history_pending.get(key)
            owner = pending is None
            if owner:
                pending = Future()
                self._history_pending[key] = pending
        if not owner:
            try:
                return pending.result(timeout=30)
            except TimeoutError:
                raise MonitoringNotReady("Подготовка истории задерживается") from None
        try:
            result = build()
            with self._history_lock:
                self._history_cache[key] = (time.monotonic(), result)
                self._history_cache.move_to_end(key)
                while len(self._history_cache) > 32:
                    self._history_cache.popitem(last=False)
            pending.set_result(result)
            return result
        except BaseException as exc:
            pending.set_exception(exc)
            raise
        finally:
            with self._history_lock:
                self._history_pending.pop(key, None)

    def _history_points(self, target_id, interface_id, since, now, resolution, step):
        with self.session() as session:
            if resolution == 60:
                query = select(MonitoringSample).where(MonitoringSample.target_id == target_id, MonitoringSample.interface_id == interface_id,
                                                       MonitoringSample.observed_at > since, MonitoringSample.observed_at <= now).order_by(MonitoringSample.observed_at)
                source = [(utc(r.observed_at), r.values.get("_stats") or aggregate_values({}, r.values, r.values.get("_duration", 60))) for r in session.scalars(query)]
            else:
                query = select(MonitoringAggregate).where(MonitoringAggregate.target_id == target_id, MonitoringAggregate.interface_id == interface_id,
                    MonitoringAggregate.resolution == resolution, MonitoringAggregate.bucket_at >= since,
                    MonitoringAggregate.bucket_at < datetime.fromtimestamp(int(now.timestamp()) // resolution * resolution, timezone.utc)).order_by(MonitoringAggregate.bucket_at)
                source = [(utc(r.bucket_at), r.values) for r in session.scalars(query)]
        # Gap-aware resampling, with a strict output bound even for a full year.
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
                    raw_stats = row.values.get("_stats") or aggregate_values({}, row.values)
                    covered &= stats is not None and all(key in stats and stats[key]["min"] <= value["min"] <= value["max"] <= stats[key]["max"]
                        and stats[key]["count"] >= value["count"] for key, value in raw_stats.items())
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
