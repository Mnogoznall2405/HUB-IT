#!/usr/bin/env python3
"""Package CLI wrapper for the canonical launcher."""

from importlib import import_module


def main():
    """Delegate CLI execution to the root launcher."""
    return import_module("run").main()


if __name__ == "__main__":
    raise SystemExit(main())
