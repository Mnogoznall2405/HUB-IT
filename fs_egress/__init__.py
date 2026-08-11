"""Lightweight monitor: files leaving the PC via USB / network shares."""

from .service import run_fs_egress_forever

__all__ = ["run_fs_egress_forever"]
