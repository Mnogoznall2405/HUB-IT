#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Модуль для управления JSON-данными о перемещениях оборудования между сотрудниками.
"""

import csv
import os
import html
from datetime import datetime
from typing import Dict, List, Optional, Any
import logging

from bot.services.validation import validate_serial_number
from bot.local_json_store import load_json_data, save_json_data

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class EquipmentDataManager:
    """Управление JSON-данными о перемещениях оборудования."""

    def __init__(
        self,
        transfers_file: str = "data/equipment_transfers.json",
        export_state_file: str = "data/export_state.json",
    ):
        self.transfers_file = transfers_file
        self.export_state_file = export_state_file
        self.transfers_name = os.path.basename(self.transfers_file)
        self.export_state_name = os.path.basename(self.export_state_file)
        self._ensure_files_exist()

    def _ensure_files_exist(self):
        load_json_data(self.transfers_name, default_content=[])
        load_json_data(self.export_state_name, default_content={})

    def _load_data(self, file_path: str) -> List[Dict[str, Any]]:
        try:
            data = load_json_data(os.path.basename(file_path), default_content=[])
            return data if isinstance(data, list) else []
        except Exception as e:
            logger.error(f"Error loading data from {file_path}: {e}")
            return []

    def _save_data(self, file_path: str, data: List[Dict[str, Any]]):
        try:
            save_json_data(os.path.basename(file_path), data)
            logger.info(f"Data saved to {file_path}")
        except Exception as e:
            logger.error(f"Error saving data to {file_path}: {e}")
            raise

    def validate_employee_name(self, name: str) -> bool:
        """
        Валидация ФИО сотрудника.
        
        Args:
            name: ФИО сотрудника
            
        Returns:
            bool: True если ФИО валидно
        """
        if not name or not isinstance(name, str):
            return False
        
        # Удаляем лишние пробелы
        name = name.strip()
        
        # Проверяем длину
        if len(name) < 2 or len(name) > 100:
            return False
        
        # Проверяем на опасные символы
        dangerous_chars = ['<', '>', '"', "'", '&', ';', '|', '`', '$']
        if any(char in name for char in dangerous_chars):
            return False
        
        # Проверяем на SQL ключевые слова
        sql_keywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'UNION', 'EXEC']
        name_upper = name.upper()
        if any(keyword in name_upper for keyword in sql_keywords):
            return False
        
        return True

    def validate_ip_address(self, ip: str) -> bool:
        """
        Валидация IP адреса.
        
        Args:
            ip: IP адрес
            
        Returns:
            bool: True если IP адрес валиден
        """
        if not ip or not isinstance(ip, str):
            return False
        
        ip = ip.strip()
        
        # Проверяем формат IPv4
        import re
        ipv4_pattern = r'^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$'
        if re.match(ipv4_pattern, ip):
            return True
        
        # Проверяем формат IPv6 (упрощенная проверка)
        ipv6_pattern = r'^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$'
        if re.match(ipv6_pattern, ip):
            return True
        
        return False
    
    def validate_inventory_number(self, inv_num: str) -> bool:
        """
        Валидация инвентарного номера.
        """
        if not inv_num or not isinstance(inv_num, str):
            return False
        inv_num = inv_num.strip()
        if len(inv_num) < 1 or len(inv_num) > 30:
            return False
        # Убрана проверка на символы - разрешаем кириллицу и любые символы
        # Проверяем только на опасные символы
        dangerous_chars = ['<', '>', '"', "'", '&', ';', '|', '`', '\n', '\r']
        if any(char in inv_num for char in dangerous_chars):
            return False
        return True
    
    def extract_serial_value(self, serial_input: str) -> str:
        """
        Приводит сырой ввод к «чистому» серийному номеру:
        удаляет типовые префиксы (Serial Number, S/N, SN, Service Tag, Серийный номер и т.п.).
        """
        import re
        if not serial_input or not isinstance(serial_input, str):
            return ''
        s = serial_input.strip()
        prefix_re = re.compile(
            r'^\s*(?:serial\s*number|serial\s*no\.?|serial\s*#|s/?n|sn|service\s*tag|серийный\s*номер|серийный)\s*[:#\-]?\s*',
            re.IGNORECASE
        )
        s = prefix_re.sub('', s)
        return s.strip()
    
    def add_equipment_transfer(self, 
                             serial_number: str, 
                             new_employee: str,
                             old_employee: Optional[str] = None,
                             additional_data: Optional[Dict] = None,
                             act_pdf_path: Optional[str] = None) -> bool:
        """
        Добавляет запись о перемещении оборудования.
        
        Args:
            serial_number: Серийный номер
            new_employee: ФИО нового сотрудника
            old_employee: ФИО предыдущего сотрудника
            additional_data: Дополнительные данные
            act_pdf_path: Путь к PDF-акту приема-передачи (опционально)
            
        Returns:
            bool: True если запись добавлена успешно
        """
        # Валидация входных данных
        cleaned_serial = self.extract_serial_value(serial_number)
        if not validate_serial_number(cleaned_serial):
            logger.error(f"Невалидный серийный номер: {serial_number}")
            return False
        
        if not self.validate_employee_name(new_employee):
            logger.error(f"Невалидное ФИО нового сотрудника: {new_employee}")
            return False
        
        if old_employee and not self.validate_employee_name(old_employee):
            logger.error(f"Невалидное ФИО предыдущего сотрудника: {old_employee}")
            return False
        
        # Загружаем существующие данные
        data = self._load_data(self.transfers_file)
        
        # Создаем новую запись
        new_record = {
            'serial_number': cleaned_serial.strip(),
            'new_employee': new_employee.strip(),
            'old_employee': old_employee.strip() if old_employee else None,
            'timestamp': datetime.now().isoformat(),
            'additional_data': additional_data or {},
            'db_name': (additional_data or {}).get('db_name', ''),
            'act_pdf_path': act_pdf_path if act_pdf_path else None
        }
        
        # Добавляем запись
        data.append(new_record)
        
        # Сохраняем данные
        self._save_data(self.transfers_file, data)
        
        logger.info(f"Добавлена запись о перемещении оборудования: {serial_number} -> {new_employee}" + 
                   (f" (акт: {act_pdf_path})" if act_pdf_path else ""))
        return True
    
    def get_equipment_transfers(self) -> List[Dict[str, Any]]:
        """Возвращает список перемещений оборудования."""
        return self._load_data(self.transfers_file)
    
    def export_transfers_to_text(self, output_dir: str = "exports", date_filter: str = None, db_filter: Optional[str] = None, only_new: bool = False) -> str:
        """
        Экспортирует данные о перемещениях в текстовый файл.
        
        Args:
            output_dir: Директория для сохранения файлов
            date_filter: Фильтр по дате в формате YYYY-MM-DD (только для текущего дня)
            db_filter: Имя базы для фильтрации
            only_new: Экспортировать только новые записи (с момента последней выгрузки)
            
        Returns:
            str: Путь к созданному файлу
        """
        # Создаем директорию, если она не существует
        os.makedirs(output_dir, exist_ok=True)
        
        # Загружаем данные о перемещениях
        transfers_data = self.get_equipment_transfers()
        
        # Фильтруем данные по дате, если указан фильтр
        if date_filter and transfers_data:
            transfers_data = [r for r in transfers_data if r.get('timestamp', '').startswith(date_filter)]
        # Фильтр по базе
        if db_filter:
            transfers_data = [r for r in transfers_data if r.get('db_name') == db_filter]
        # Экспорт только новых записей, если указано
        if only_new:
            last_ts = self._get_last_export_ts('transfers', db_filter)
            if last_ts:
                try:
                    from datetime import datetime as dt
                    last_dt = dt.fromisoformat(last_ts)
                    transfers_data = [r for r in transfers_data if r.get('timestamp') and dt.fromisoformat(r['timestamp']) > last_dt]
                except Exception:
                    # В случае ошибки парсинга даты не фильтруем
                    pass
        
        if not transfers_data:
            logger.warning("Нет данных о перемещениях для экспорта")
            return ""
        
        # Формируем имя файла
        current_date = datetime.now().strftime("%Y-%m-%d")
        suffix = f"_{db_filter}" if db_filter else ""
        output_file = os.path.join(output_dir, f"transfers_{current_date}{suffix}.txt")
        
        # Создаем текстовый файл
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write("Отчет о перемещении оборудования\n")
            f.write("=" * 50 + "\n\n")
            for record in transfers_data:
                serial_number = record.get('serial_number', 'Неизвестно')
                new_employee = record.get('new_employee', 'Неизвестно')
                old_employee = record.get('old_employee', 'Неизвестно')
                timestamp = record.get('timestamp', '')
                formatted_date = timestamp
                try:
                    dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00')) if timestamp else None
                    if dt:
                        formatted_date = dt.strftime("%d.%m.%Y %H:%M")
                except Exception:
                    pass
                f.write(f"Серийный номер: {serial_number}\n")
                f.write(f"Новый сотрудник: {new_employee}\n")
                f.write(f"Предыдущий сотрудник: {old_employee}\n")

                # Добавляем филиал и локацию, если они есть
                additional_data = record.get('additional_data', {})
                branch = additional_data.get('branch', '') if isinstance(additional_data, dict) else ''
                location = additional_data.get('location', '') if isinstance(additional_data, dict) else ''

                if branch:
                    f.write(f"Филиал: {branch}\n")
                if location:
                    f.write(f"Локация: {location}\n")

                f.write(f"Дата: {formatted_date}\n")
                f.write("-" * 40 + "\n")
        
        # Фиксируем последнюю выгрузку
        try:
            latest_ts = max((r.get('timestamp') or '') for r in transfers_data)
            if latest_ts:
                self._set_last_export_ts('transfers', db_filter, latest_ts)
        except Exception:
            pass
        
        logger.info(f"Текстовый отчет о перемещениях создан: {output_file}")
        return output_file
    
    def get_statistics(self) -> Dict[str, Any]:
        """
        Возвращает статистику по данным.
        
        Returns:
            Dict со статистикой
        """
        transfers_data = self.get_equipment_transfers()

        return {
            'transfers_count': len(transfers_data),
            'total_records': len(transfers_data),
            'last_transfer': transfers_data[-1]['timestamp'] if transfers_data else None
        }
    def _load_export_state(self) -> Dict[str, Any]:
        """Load export checkpoint state from local store."""
        try:
            data = load_json_data(self.export_state_name, default_content={})
            return data if isinstance(data, dict) else {}
        except Exception:
            # Return empty state for missing/corrupted storage
            return {}


    def _save_export_state(self, state: Dict[str, Any]) -> None:
        """Save export checkpoint state to local store."""
        try:
            save_json_data(self.export_state_name, state)
        except Exception as e:
            logger.error(f"Error saving export checkpoint state: {e}")


    def _get_last_export_ts(self, data_type: str, db_name: Optional[str]) -> Optional[str]:
        """Вернуть ISO‑timestamp последней выгрузки для типа данных и базы."""
        state = self._load_export_state()
        bucket = state.get(data_type, {})
        key = db_name or '__all__'
        return bucket.get(key)

    def _set_last_export_ts(self, data_type: str, db_name: Optional[str], ts: str) -> None:
        """Записать ISO‑timestamp последней выгрузки для типа данных и базы."""
        state = self._load_export_state()
        bucket = state.get(data_type, {})
        key = db_name or '__all__'
        bucket[key] = ts
        state[data_type] = bucket
        self._save_export_state(state)

def add_transfer_record(serial: str, new_employee: str, old_employee: str = None,
                       data_file: str = "data/equipment_transfers.json",
                       act_pdf_path: str = None) -> bool:
    """
    Удобная функция для добавления записи о перемещении.
    
    Args:
        serial: Серийный номер
        new_employee: ФИО нового сотрудника
        old_employee: ФИО предыдущего сотрудника
        data_file: Путь к файлу данных
        act_pdf_path: Путь к PDF-акту приема-передачи (опционально)
        
    Returns:
        bool: True если запись добавлена успешно
    """
    manager = EquipmentDataManager(transfers_file=data_file)
    return manager.add_equipment_transfer(serial, new_employee, old_employee, act_pdf_path=act_pdf_path)

# Пример использования
if __name__ == "__main__":
    manager = EquipmentDataManager()
    success = manager.add_equipment_transfer(
        serial_number="XYZ789",
        new_employee="Петров Петр Петрович",
        old_employee="Сидоров Сидор Сидорович"
    )
    print(f"Добавление перемещения: {success}")
    print(f"Статистика: {manager.get_statistics()}")

