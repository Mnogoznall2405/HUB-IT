from __future__ import annotations

from types import SimpleNamespace

from scan_server.system_metrics import SystemMetricsCollector


class _FakePsutil:
    def __init__(self) -> None:
        self.disk = SimpleNamespace(read_bytes=100, write_bytes=200)
        self.network = SimpleNamespace(bytes_sent=300, bytes_recv=400)

    def cpu_percent(self, interval=None):
        return 42.5

    def virtual_memory(self):
        return SimpleNamespace(percent=62.5, used=1000, available=600)

    def disk_io_counters(self):
        return self.disk

    def net_io_counters(self):
        return self.network


def test_system_metrics_collector_calculates_five_second_io_rates():
    fake = _FakePsutil()
    collector = SystemMetricsCollector(psutil_module=fake, process_rss_provider=lambda: 777)

    first = collector.collect(captured_at=100, monotonic_at=10.0)
    fake.disk = SimpleNamespace(read_bytes=200, write_bytes=400)
    fake.network = SimpleNamespace(bytes_sent=500, bytes_recv=700)
    second = collector.collect(captured_at=105, monotonic_at=15.0)

    assert first["disk_read_bps"] == 0.0
    assert second["cpu_percent"] == 42.5
    assert second["memory_percent"] == 62.5
    assert second["disk_read_bps"] == 20.0
    assert second["disk_write_bps"] == 40.0
    assert second["network_sent_bps"] == 40.0
    assert second["network_received_bps"] == 60.0
    assert second["process_rss_bytes"] == 777
