"""USB-учёт агента: разбор записей USBSTOR, время подключения из реестра и пометка «подключено сейчас».

Не воспроизводится через границу: реестр USBSTOR есть только на машине с подключавшимися устройствами,
а ошибка в разборе серийного номера или FILETIME тихо даёт неверную историю, поэтому логика проверяется напрямую.
"""
from __future__ import annotations

import agent
from fs_egress import roots


def test_filetime_is_converted_to_unix_seconds_and_garbage_is_zero():
    # 2024-01-01 00:00:00 UTC
    filetime = (1_704_067_200 + 11_644_473_600) * 10_000_000
    assert agent.filetime_to_epoch(filetime.to_bytes(8, "little")) == 1_704_067_200
    assert agent.filetime_to_epoch(b"") == 0
    assert agent.filetime_to_epoch((0).to_bytes(8, "little")) == 0
    assert agent.filetime_to_epoch("not bytes") == 0


def test_usbstor_ids_split_vendor_product_and_flag_windows_generated_serials():
    real = agent.parse_usbstor_ids("Disk&Ven_SanDisk&Prod_Ultra_Fit&Rev_1.00", "4C530001230612109083&0")
    assert real["vendor"] == "SanDisk"
    assert real["product"] == "Ultra Fit"
    assert real["revision"] == "1.00"
    assert real["serial"] == "4C530001230612109083"
    assert real["has_unique_serial"] is True

    # Device without its own serial: Windows makes up "6&<hash>&0", valid on this computer only.
    invented = agent.parse_usbstor_ids("Disk&Ven_Generic&Prod_Flash_Disk&Rev_8.07", "6&1f4a2b3c&0")
    assert invented["has_unique_serial"] is False


def test_collect_usb_devices_marks_devices_plugged_in_now(monkeypatch):
    history = [
        {**agent.parse_usbstor_ids("Disk&Ven_Kingston&Prod_DataTraveler&Rev_1.0", "AAA111&0"),
         "kind": "storage", "friendly_name": "Kingston DataTraveler", "first_connected_at": 100,
         "last_connected_at": 200, "last_removed_at": 300, "present": False, "size_gb": None,
         "pnp_device_id": "USBSTOR\\Disk&Ven_Kingston&Prod_DataTraveler&Rev_1.0\\AAA111&0"},
        {**agent.parse_usbstor_ids("Disk&Ven_WD&Prod_Elements&Rev_1.0", "BBB222&0"),
         "kind": "storage", "friendly_name": "WD Elements", "first_connected_at": 50,
         "last_connected_at": 400, "last_removed_at": 450, "present": False, "size_gb": None,
         "pnp_device_id": "USBSTOR\\Disk&Ven_WD&Prod_Elements&Rev_1.0\\BBB222&0"},
    ]
    monkeypatch.setattr(agent, "_iter_usbstor_history", lambda: [dict(row) for row in history])
    monkeypatch.setattr(
        agent,
        "_powershell_json",
        lambda command, timeout_sec=None: {
            "disks": [{"pnp": "USBSTOR\\DISK&VEN_KINGSTON&PROD_DATATRAVELER&REV_1.0\\AAA111&0", "size": 32 * 1024 ** 3}],
            "portable": [{"pnp": "USB\\VID_18D1&PID_4EE1\\PIXEL7", "name": "Pixel 7", "cls": "WPD", "mfr": "Google"}],
        },
    )

    result = agent.collect_usb_devices()
    by_name = {row["friendly_name"]: row for row in result["items"]}

    assert by_name["Kingston DataTraveler"]["present"] is True
    assert by_name["Kingston DataTraveler"]["size_gb"] == 32.0
    assert by_name["WD Elements"]["present"] is False
    assert by_name["Pixel 7"]["kind"] == "portable"
    # connected-now devices go first, then the most recently used
    assert [row["friendly_name"] for row in result["items"]] == ["Kingston DataTraveler", "Pixel 7", "WD Elements"]


def test_files_on_a_usb_bus_disk_count_as_usb_even_when_windows_calls_it_fixed(monkeypatch):
    monkeypatch.setattr(roots, "_get_drive_type", lambda root: roots.DRIVE_FIXED)
    monkeypatch.setattr(roots, "usb_bus_drive_letters", lambda: frozenset({"F"}))

    assert roots.classify_path(r"F:\reports\q2.xlsx") == "usb"
    assert roots.classify_path(r"C:\reports\q2.xlsx") == "local"
