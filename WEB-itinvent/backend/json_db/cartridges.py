#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cartridge Database JSON operations.

Manages the cartridge compatibility database that maps printer models
to compatible cartridges.
"""

import logging
from typing import Dict, List, Optional, Any, Set
from dataclasses import dataclass
from difflib import SequenceMatcher

from backend.json_db.manager import JSONDataManager

logger = logging.getLogger(__name__)


@dataclass
class CartridgeInfo:
    """Information about a cartridge."""
    model: str
    description: str
    color: str
    page_yield: Optional[int] = None
    oem_part: Optional[str] = None


@dataclass
class PrinterCompatibility:
    """Information about printer cartridge compatibility."""
    oem_cartridge: str
    compatible_models: List[CartridgeInfo]
    is_color: bool = False
    components: List[str] = None
    fuser_models: List[str] = None
    photoconductor_models: List[str] = None
    waste_toner_models: List[str] = None
    transfer_belt_models: List[str] = None

    def __post_init__(self):
        if self.components is None:
            self.components = ['cartridge', 'fuser', 'photoconductor']
        if self.fuser_models is None:
            self.fuser_models = []
        if self.photoconductor_models is None:
            self.photoconductor_models = []
        if self.waste_toner_models is None:
            self.waste_toner_models = []
        if self.transfer_belt_models is None:
            self.transfer_belt_models = []


class CartridgeDatabase:
    """
    Cartridge database manager.

    Provides functionality for looking up compatible cartridges
    for printer models.
    """

    CARTRIDGE_DB_FILE = "cartridge_database.json"

    def __init__(self, data_manager: Optional[JSONDataManager] = None):
        """
        Initialize the cartridge database.

        Args:
            data_manager: Optional JSONDataManager instance
        """
        self.data_manager = data_manager or JSONDataManager()
        self._cache: Optional[Dict[str, PrinterCompatibility]] = None

    def _load_database(self) -> Dict[str, PrinterCompatibility]:
        """
        Load the cartridge database from JSON file.

        Returns:
            Dictionary mapping printer model names to compatibility info
        """
        if self._cache is not None:
            return self._cache

        try:
            data = self.data_manager.load_json(self.CARTRIDGE_DB_FILE, default_content={})

            if not isinstance(data, dict):
                logger.warning(f"Cartridge database is not a dict, using empty database")
                return {}

            result = {}
            for printer_name, printer_data in data.items():
                try:
                    compatible_models = []
                    for cart_data in printer_data.get('compatible_models', []):
                        compatible_models.append(CartridgeInfo(
                            model=cart_data.get('model', ''),
                            description=cart_data.get('description', ''),
                            color=cart_data.get('color', 'Черный'),
                            page_yield=cart_data.get('page_yield'),
                            oem_part=cart_data.get('oem_part')
                        ))

                    result[printer_name] = PrinterCompatibility(
                        oem_cartridge=printer_data.get('oem_cartridge', ''),
                        compatible_models=compatible_models,
                        is_color=printer_data.get('is_color', False),
                        components=printer_data.get('components', ['cartridge', 'fuser', 'photoconductor']),
                        fuser_models=printer_data.get('fuser_models', []),
                        photoconductor_models=printer_data.get('photoconductor_models', []),
                        waste_toner_models=printer_data.get('waste_toner_models', []),
                        transfer_belt_models=printer_data.get('transfer_belt_models', [])
                    )
                except Exception as e:
                    logger.error(f"Error loading printer {printer_name}: {e}")

            self._cache = result
            logger.info(f"Loaded cartridge database: {len(result)} printer models")
            return result

        except Exception as e:
            logger.error(f"Error loading cartridge database: {e}")
            return {}

    def _normalize_printer_name(self, printer_model: str) -> str:
        """
        Normalize printer model name for consistent lookup.

        Args:
            printer_model: Raw printer model name

        Returns:
            Normalized printer model name
        """
        if not printer_model:
            return ""

        normalized = printer_model.lower().strip()

        # Remove common prefixes and suffixes
        words_to_remove = ['the ', 'a ', 'an ']
        for word in words_to_remove:
            normalized = normalized.replace(word, '')

        # Replace multiple spaces with single space
        normalized = ' '.join(normalized.split())

        return normalized

    def find_printer_compatibility(self, printer_model: str) -> Optional[PrinterCompatibility]:
        """
        Find cartridge compatibility for a printer model.

        Supports fuzzy matching for similar model names.

        Args:
            printer_model: Printer model name

        Returns:
            PrinterCompatibility object or None if not found
        """
        db = self._load_database()
        normalized_model = self._normalize_printer_name(printer_model)

        # Direct match
        if normalized_model in db:
            return db[normalized_model]

        # Fuzzy matching - find best match above 80% similarity
        best_match = None
        best_ratio = 0.0

        for db_printer in db.keys():
            ratio = SequenceMatcher(None, normalized_model, db_printer).ratio()
            if ratio > best_ratio and ratio > 0.8:
                best_ratio = ratio
                best_match = db_printer

        if best_match:
            logger.info(f"Fuzzy match for '{printer_model}': '{best_match}' (ratio: {best_ratio:.2f})")
            return db[best_match]

        return None

    def get_cartridges_for_printer(self, printer_model: str) -> List[CartridgeInfo]:
        """
        Get all compatible cartridges for a printer model.

        Args:
            printer_model: Printer model name

        Returns:
            List of CartridgeInfo objects
        """
        compatibility = self.find_printer_compatibility(printer_model)
        return compatibility.compatible_models if compatibility else []

    def get_cartridge_colors(self, printer_model: str) -> List[str]:
        """
        Get available cartridge colors for a printer model.

        Args:
            printer_model: Printer model name

        Returns:
            Sorted list of color names
        """
        cartridges = self.get_cartridges_for_printer(printer_model)
        colors: Set[str] = set()

        for cartridge in cartridges:
            colors.add(cartridge.color)

        return sorted(list(colors))

    def get_printer_components(self, printer_model: str) -> List[str]:
        """
        Get available component types for a printer model.

        Args:
            printer_model: Printer model name

        Returns:
            List of component type names
        """
        compatibility = self.find_printer_compatibility(printer_model)
        return compatibility.components if compatibility else ['cartridge', 'fuser', 'photoconductor']

    def is_color_printer(self, printer_model: str) -> bool:
        """
        Check if a printer model is color.

        Args:
            printer_model: Printer model name

        Returns:
            True if color printer, False otherwise
        """
        compatibility = self.find_printer_compatibility(printer_model)
        return compatibility.is_color if compatibility else False

    def get_printers_for_cartridge(self, cartridge_model: str) -> List[str]:
        """
        Reverse lookup: printer models compatible with a cartridge model.

        Matches the cartridge against each printer's OEM cartridge and
        compatible_models entries using normalized containment, so short
        names like "CF283A" still match "HP CF283A".

        Args:
            cartridge_model: Cartridge model name

        Returns:
            Sorted list of printer model names
        """
        needle = self._normalize_printer_name(cartridge_model)
        if not needle:
            return []

        db = self._load_database()
        matches: List[str] = []
        for printer_name, compatibility in db.items():
            candidates = [compatibility.oem_cartridge]
            candidates.extend(cart.model for cart in compatibility.compatible_models)
            for candidate in candidates:
                normalized = self._normalize_printer_name(candidate)
                if normalized and (
                    normalized == needle
                    or needle in normalized
                    or normalized in needle
                ):
                    matches.append(printer_name)
                    break
        return sorted(matches, key=str.lower)

    def get_all_printer_models(self) -> List[str]:
        """
        Get all printer models in the database.

        Returns:
            List of printer model names
        """
        db = self._load_database()
        return sorted(db.keys(), key=lambda x: x.lower())

    def get_oem_cartridge(self, printer_model: str) -> str:
        """
        Get OEM cartridge model for a printer.

        Args:
            printer_model: Printer model name

        Returns:
            OEM cartridge model or empty string if not found
        """
        compatibility = self.find_printer_compatibility(printer_model)
        return compatibility.oem_cartridge if compatibility else ""

    def reload(self) -> None:
        """
        Reload the cartridge database from file.

        Clears the internal cache and forces a reload from disk.
        """
        self._cache = None
        logger.info("Cartridge database cache cleared, will reload on next access")

    def _load_raw_database(self) -> Dict[str, Any]:
        """Load the raw JSON dict for write operations (not the cached parse)."""
        data = self.data_manager.load_json(self.CARTRIDGE_DB_FILE, default_content={})
        return dict(data) if isinstance(data, dict) else {}

    def _save_raw_database(self, data: Dict[str, Any]) -> None:
        if not self.data_manager.save_json(self.CARTRIDGE_DB_FILE, data):
            raise RuntimeError("Failed to save cartridge database")
        self.reload()

    def list_entries(self) -> List[Dict[str, Any]]:
        """
        List all compatibility entries for the management table.

        Returns:
            Sorted list of {printer_model, oem_cartridge, compatible_models, is_color}
        """
        db = self._load_database()
        entries = []
        for printer_name, compatibility in db.items():
            entries.append({
                'printer_model': printer_name,
                'oem_cartridge': compatibility.oem_cartridge,
                'is_color': compatibility.is_color,
                'compatible_models': [
                    {
                        'model': cart.model,
                        'description': cart.description,
                        'color': cart.color,
                        'page_yield': cart.page_yield,
                        'oem_part': cart.oem_part,
                    }
                    for cart in compatibility.compatible_models
                ],
            })
        return sorted(entries, key=lambda item: item['printer_model'].lower())

    def upsert_entry(
        self,
        printer_model: str,
        *,
        oem_cartridge: Optional[str] = None,
        compatible_models: Optional[List[Dict[str, Any]]] = None,
        is_color: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """
        Create or update a printer compatibility entry.

        Merges into the existing raw entry so fields the API does not manage
        (components, fuser_models, ...) are preserved. When compatible_models
        is provided the list is replaced, but each still-present model keeps
        its previously stored extra fields (description, color, ...).

        Returns:
            The merged raw entry dict.
        """
        key = self._normalize_printer_name(printer_model)
        if not key:
            raise ValueError("Printer model is required")

        raw = self._load_raw_database()
        existing = raw.get(key)
        entry = dict(existing) if isinstance(existing, dict) else {}

        if oem_cartridge is not None:
            entry['oem_cartridge'] = str(oem_cartridge).strip()
        if is_color is not None:
            entry['is_color'] = bool(is_color)
        if compatible_models is not None:
            previous = {}
            for model_data in entry.get('compatible_models') or []:
                if not isinstance(model_data, dict):
                    continue
                model_key = self._normalize_printer_name(model_data.get('model', ''))
                if model_key:
                    previous[model_key] = model_data
            merged_models = []
            for model_data in compatible_models:
                if not isinstance(model_data, dict):
                    continue
                model = str(model_data.get('model') or '').strip()
                model_key = self._normalize_printer_name(model)
                if not model_key:
                    continue
                kept = dict(previous.get(model_key) or {})
                for field, value in model_data.items():
                    if value is not None:
                        kept[field] = value
                kept['model'] = model
                merged_models.append(kept)
            entry['compatible_models'] = merged_models

        raw[key] = entry
        self._save_raw_database(raw)
        return entry

    def delete_entry(self, printer_model: str) -> bool:
        """
        Remove a printer compatibility entry.

        Returns:
            True if the entry existed and was removed.
        """
        key = self._normalize_printer_name(printer_model)
        if not key:
            return False
        raw = self._load_raw_database()
        if key not in raw:
            return False
        del raw[key]
        self._save_raw_database(raw)
        return True
