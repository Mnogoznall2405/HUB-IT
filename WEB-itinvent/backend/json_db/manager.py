#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Compatibility JSON manager backed by app-db or legacy SQLite storage.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from backend.appdb.db import is_app_database_configured
from backend.appdb.json_store import AppJsonDataStore
from local_store import get_local_store

logger = logging.getLogger(__name__)


class JSONDataManager:
    def __init__(self, data_dir: str | Path | None = None, database_url: str | None = None):
        if data_dir is None:
            backend_dir = Path(__file__).parent.parent
            data_dir = backend_dir.parent.parent / "data"
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._database_url = str(database_url or "").strip() or None
        self._use_app_database = bool(self._database_url) or is_app_database_configured()
        self.store = None if self._use_app_database else get_local_store(data_dir=self.data_dir)
        self._app_store = AppJsonDataStore(database_url=self._database_url) if self._use_app_database else None
        if self._use_app_database:
            logger.info("JSONDataManager initialized with app-db backend")
        else:
            logger.info("JSONDataManager initialized with SQLite store at %s", self.store.db_path)

    def _get_file_path(self, filename: str) -> Path:
        return self.data_dir / Path(filename).name

    def _ensure_file_exists(self, file_path: Path, default_content: Any = None):
        # In SQLite mode bootstrap happens by loading with default.
        self.load_json(file_path.name, default_content=default_content)

    def load_json(self, filename: str, default_content: Any = None):
        normalized_name = Path(filename).name
        if self._use_app_database and self._app_store is not None:
            return self._app_store.load_json(normalized_name, default_content=default_content)
        return self.store.load_json(normalized_name, default_content=default_content)

    def save_json(self, filename: str, data: Any) -> bool:
        normalized_name = Path(filename).name
        if self._use_app_database and self._app_store is not None:
            return self._app_store.save_json(normalized_name, data)
        return self.store.save_json(normalized_name, data)

    def append_to_json(self, filename: str, record: Any) -> bool:
        normalized_name = Path(filename).name
        if self._use_app_database and self._app_store is not None:
            return self._app_store.append_to_json(normalized_name, record)
        return self.store.append_to_json(normalized_name, record)

    def update_json_array(self, filename: str, predicate, updater) -> int:
        normalized_name = Path(filename).name
        if self._use_app_database and self._app_store is not None:
            return self._app_store.update_json_array(normalized_name, predicate, updater)
        return self.store.update_json_array(normalized_name, predicate, updater)

    def get_json_files(self):
        if self._use_app_database and self._app_store is not None:
            return self._app_store.get_json_files()
        return self.store.get_json_files()
