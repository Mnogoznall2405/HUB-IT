"""Validated, bounded monitoring configuration. Secrets are write-only."""
from ipaddress import IPv4Address
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)


class ProfileCreate(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    community: SecretStr = Field(min_length=1, max_length=128)


class ProfileUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    community: SecretStr | None = Field(default=None, min_length=1, max_length=128)


class TargetSettings(StrictModel):
    failure_polls: int = Field(default=3, ge=2, le=10)
    icmp_timeout_ms: int = Field(default=800, ge=200, le=5000)
    cpu_warn: float = Field(default=85, ge=1, le=100)
    memory_warn: float = Field(default=90, ge=1, le=100)
    temperature_warn: float = Field(default=75, ge=1, le=150)
    latency_warn_ms: float = Field(default=150, ge=1, le=30000)
    loss_warn_pct: float = Field(default=20, ge=1, le=100)


class TargetCreate(StrictModel):
    # Optional legacy link to a «Сети» registry card; new devices are connected by name and address only.
    network_device_id: int | None = Field(default=None, gt=0)
    # IT object the device belongs to (shown on the object's «Мониторинг» tab); null - not assigned.
    object_ref: str | None = Field(default=None, max_length=128)
    name: str = Field(min_length=1, max_length=160)
    address: IPv4Address
    port: int = Field(default=161, ge=1, le=65535)
    profile_id: str = Field(min_length=1, max_length=36)
    enabled: bool = True
    settings: TargetSettings = Field(default_factory=TargetSettings)

    @field_validator("address")
    @classmethod
    def address_is_unicast(cls, address):
        if address.is_loopback or address.is_link_local or address.is_multicast or address.is_unspecified or address == IPv4Address("255.255.255.255"):
            raise ValueError("Нужен адрес сетевого устройства")
        return address


class TargetUpdate(TargetCreate):
    # Full validated configuration avoids ambiguous null/partial nested updates.
    pass


class InterfaceSettings(StrictModel):
    pinned: bool = False
    role: Literal["lan", "wan", "uplink", "wifi", "vpn", "other"] = "lan"
    critical: bool = False
    history_enabled: bool = True
    expected_link_bps: float | None = Field(default=None, gt=0, le=1e13)
    capacity_rx_bps: float | None = Field(default=None, gt=0, le=1e13)
    capacity_tx_bps: float | None = Field(default=None, gt=0, le=1e13)
    utilization_warn: float = Field(default=85, ge=1, le=100)
    errors_warn_pps: float = Field(default=2, gt=0, le=1e9)


