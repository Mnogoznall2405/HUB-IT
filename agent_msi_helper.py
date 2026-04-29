from __future__ import annotations

import argparse
import logging
from logging.handlers import RotatingFileHandler
import sys

import agent_installer


def _setup_logging() -> None:
    log_path = agent_installer.get_msi_helper_log_path()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(log_path, maxBytes=2 * 1024 * 1024, backupCount=2, encoding="utf-8")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[handler],
        force=True,
    )


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="IT-Invent MSI helper")
    agent_installer.add_msi_args(parser)
    return parser.parse_args(argv)


def main(argv=None) -> int:
    _setup_logging()
    args = parse_args(argv)
    if not agent_installer.is_msi_mode(args):
        logging.error("MSI helper was started without installer mode arguments")
        return 2
    try:
        if args.msi_install:
            return agent_installer.run_msi_install(args, logging)
        if args.msi_full_uninstall_cleanup:
            return agent_installer.run_msi_full_uninstall_cleanup(args, logging)
        return agent_installer.run_msi_uninstall_cleanup(args, logging)
    except Exception as exc:
        logging.exception("MSI helper failed: %s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
