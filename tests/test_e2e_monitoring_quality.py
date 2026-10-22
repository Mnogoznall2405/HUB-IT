"""Quality is exposed through the real history HTTP boundary on fixture SQLite."""
from datetime import datetime, timedelta, timezone
import asyncio

from test_e2e_monitoring import environment, create_target


def test_history_distinguishes_no_reply_collector_error_missing_and_open_window(environment):
    client, svc, device, now, _ = environment
    target = create_target(client)
    start = now[0]
    for seconds, status, sent, received, error in [(0, 'online', 3, 3, None), (10, 'offline', 3, 0, None),
                                                  (20, 'online', None, 1, 'collector_timeout')]:
        now[0] = start + timedelta(seconds=seconds)
        device.value = {'protocol': 'icmp', 'ping': {'status': status, 'sent': sent, 'received': received,
            'latency_ms': 7 if received else None, 'loss_pct': 0 if received else 100, 'error': error}}
        assert client.post(f"/api/v1/monitoring/targets/{target['id']}/probe").status_code == 200
    now[0] = start + timedelta(seconds=45)
    path = f"/api/v1/monitoring/targets/{target['id']}/latency-history"
    data = client.get(path, params={'hours': 1}).json()
    recent = [p for p in data['points'] if p['at'] >= start.isoformat()]
    assert [p['quality_status'] for p in recent] == ['online', 'offline', 'collector_error', 'missing', 'pending']
    assert recent[1]['received'] == 0 and recent[1]['sent'] == 3
    assert recent[2]['latency_ms'] is None and recent[2]['partial_latency_ms'] == 7
    assert recent[2]['loss_pct'] is None and recent[2]['error'] == 'collector_timeout'
    assert data['quality_since'] == start.isoformat()
    assert all(p['quality_status'] == 'unobserved' for p in data['points'] if p['at'] < start.isoformat())
    delta = client.get(path, params={'hours': 1, 'after': (start + timedelta(seconds=10)).isoformat()}).json()
    assert delta['points'] == recent[1:]
    # The uncertainty survives replacement of the store and loss of its memory cache.
    svc.store = type(svc.store)(svc.store.database_url)
    assert client.get(path, params={'hours': 1}).json()['points'] == data['points']


def test_manual_refresh_does_not_erase_a_scheduled_failure(environment):
    client, svc, _, now, _ = environment
    target = create_target(client)
    start = now[0]

    class Probe:
        async def ping(self, target):
            return {'status': 'offline', 'latency_ms': None, 'sent': 3, 'received': 0, 'loss_pct': 100}

        async def read(self, target, community, **kwargs):
            return {'protocol': 'icmp', 'ping': {'status': 'online', 'latency_ms': 1, 'sent': 3, 'received': 3, 'loss_pct': 0}}

    svc.probe = Probe()
    asyncio.run(svc.collect(target['id'], protocol='icmp', detail=False, scheduled_at=start))
    now[0] += timedelta(seconds=3)
    assert client.post(f"/api/v1/monitoring/targets/{target['id']}/probe").status_code == 200
    result = client.get(f"/api/v1/monitoring/targets/{target['id']}/latency-history", params={'hours': 1}).json()
    point = result['points'][-1]
    assert point['quality_status'] == 'offline' and point['received'] == 0
    assert point['source'] == 'scheduled' and point['scheduled_at'] == start.isoformat()


def test_schedule_boundary_and_snmp_only_minute_do_not_hide_missing_checks(environment):
    client, svc, device, now, _ = environment
    target = create_target(client)
    start = now[0]
    # A delayed start across a clock bucket is still the scheduled probe for that window.
    now[0] = start + timedelta(seconds=10.2)
    row = svc.store.probe_target(target['id'])
    svc.store.record(row, {'protocol': 'icmp', 'scheduled_at': (start + timedelta(seconds=9.8)).isoformat(),
        'ping': {'status': 'online', 'latency_ms': 2, 'sent': 3, 'received': 3, 'loss_pct': 0}}, now[0])
    now[0] = start + timedelta(seconds=65)
    device.value = {'protocol': 'snmp', 'snmp_status': 'ok', 'device': {'cpu_pct': 1}, 'interfaces': []}
    assert client.post(f"/api/v1/monitoring/targets/{target['id']}/probe").status_code == 200
    now[0] = start + timedelta(seconds=130)
    result = client.get(f"/api/v1/monitoring/targets/{target['id']}/latency-history", params={'hours': 1}).json()
    points = {p['at']: p for p in result['points']}
    assert points[start.isoformat()]['quality_status'] == 'online'
    assert points[(start + timedelta(seconds=60)).isoformat()]['quality_status'] == 'missing'
    assert points[(start + timedelta(seconds=110)).isoformat()]['quality_status'] == 'missing'
    assert result['quality_since'] == start.isoformat()


def test_explicit_pause_is_preserved_after_resume_without_inventing_success(environment, monkeypatch):
    from backend.services import network_monitor_store as storage
    client, svc, device, now, _ = environment

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now[0].astimezone(tz or timezone.utc)

    monkeypatch.setattr(storage, 'datetime', Clock)
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    start = now[0]
    device.value = {'protocol': 'icmp', 'ping': {'status': 'online', 'latency_ms': 1, 'sent': 3, 'received': 3}}
    assert client.post(path + '/probe').status_code == 200
    payload = {k: target[k] for k in ['network_device_id', 'name', 'address', 'profile_id', 'port', 'settings', 'enabled']}
    now[0] = start + timedelta(seconds=10)
    assert client.put(path, json={**payload, 'enabled': False}).status_code == 200
    now[0] = start + timedelta(seconds=40)
    assert client.put(path, json={**payload, 'enabled': True}).status_code == 200
    now[0] = start + timedelta(seconds=60)
    result = client.get(path + '/latency-history', params={'hours': 1}).json()
    recent = [p for p in result['points'] if p['at'] >= start.isoformat()]
    assert [p['quality_status'] for p in recent] == ['online', 'paused', 'paused', 'paused', 'missing', 'missing', 'pending']


def test_confirmed_outage_backoff_is_distinct_from_a_missed_recovery_check(environment):
    client, svc, device, now, _ = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    start = now[0]
    device.value = {'snmp_status': 'error', 'error': 'timeout', 'interfaces': [],
        'ping': {'status': 'offline', 'sent': 3, 'received': 0, 'loss_pct': 100, 'latency_ms': None}}
    for seconds in (0, 30, 60):
        now[0] = start + timedelta(seconds=seconds)
        assert client.post(path + '/probe').status_code == 200
    now[0] = start + timedelta(seconds=135)
    result = client.get(path + '/latency-history', params={'hours': 1}).json()
    points = {p['at']: p for p in result['points']}
    assert points[(start + timedelta(seconds=60)).isoformat()]['quality_status'] == 'offline'
    assert points[(start + timedelta(seconds=70)).isoformat()]['quality_status'] == 'backoff'
    assert points[(start + timedelta(seconds=120)).isoformat()]['quality_status'] == 'missing'
    assert points[(start + timedelta(seconds=130)).isoformat()]['quality_status'] == 'pending'
