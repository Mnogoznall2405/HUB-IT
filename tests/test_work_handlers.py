#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Модульные тесты для хендлеров работ

Тестируют:
- work_component_serial_input
- show_component_selection_pc
- handle_pc_component_selection
- save_component_replacement_pc
"""
import pytest
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from datetime import datetime
from pathlib import Path
import json

# Настройка пути для импортов
import sys
sys.path.insert(0, '.')

from bot.config import States


# ============================================================================
# FIXTURES
# ============================================================================

@pytest.fixture
def update():
    """Mock Telegram Update"""
    update = AsyncMock()
    update.effective_user = Mock()
    update.effective_user.id = 123456
    update.message = AsyncMock()
    update.message.photo = None
    update.message.text = ""
    return update


@pytest.fixture
def context():
    """Mock Telegram Context"""
    context = AsyncMock()
    context.user_data = {}
    context._user_id = 123456
    context.bot = AsyncMock()
    return context


@pytest.fixture
def equipment_mock():
    """Мок оборудования"""
    return {
        'ID': 123,
        'SERIAL_NO': 'PF12345',
        'HW_SERIAL_NO': '',
        'MODEL_NAME': 'Dell OptiPlex 7090',
        'BRANCH_NAME': 'Офис Москва',
        'LOCATION': 'Офис 301',
        'EMPLOYEE_NAME': 'Иванов И.И.',
        'DESCRIPTION': 'Test description'
    }


@pytest.fixture
def temp_json_file(tmp_path):
    """Временный JSON файл для тестов"""
    return tmp_path / "test_component_replacements.json"


# ============================================================================
# ТЕСТЫ ДЛЯ work_component_serial_input
# ============================================================================

@pytest.mark.asyncio
async def test_work_component_serial_input_valid_serial(update, context):
    """Тест валидного серийного номера"""
    from bot.handlers.work import work_component_serial_input
    from bot.services.ocr_service import validate_serial_format

    # Мокаем текстовый ввод
    update.message.text = "PF12345"
    update.message.photo = None

    # Патчим на уровне модуля, где импортируется database_manager
    with patch('bot.handlers.work.database_manager') as mock_db:
        mock_db.get_user_database = Mock(return_value='ITINVENT')
        mock_db.get_database_config = Mock(return_value={'host': 'localhost'})

        mock_equipment = {
            'ID': 123,
            'SERIAL_NO': 'PF12345',
            'MODEL_NAME': 'Dell OptiPlex 7090'
        }

        with patch('bot.handlers.work.UniversalInventoryDB') as mock_univ_db:
            mock_univ_db.return_value.find_by_serial_number = Mock(return_value=[mock_equipment])

            # Результат не важен для этого теста, главное что не падает
            # Просто проверим что функция вызывается без ошибок
            try:
                result = await work_component_serial_input(update, context)
                # Должна вернуть следующее состояние или ошибку если ПК не найден
                assert result in [States.WORK_COMPONENT_SERIAL_INPUT, States.WORK_COMPONENT_SELECTION]
            except Exception as e:
                pytest.fail(f"Функция упала с ошибкой: {e}")


@pytest.mark.asyncio
async def test_work_component_serial_input_invalid_serial(update, context):
    """Тест невалидного серийного номера"""
    from bot.handlers.work import work_component_serial_input

    # Неверный формат (слишком короткий)
    update.message.text = "ABC"
    update.message.photo = None

    with patch('bot.services.ocr_service.validate_serial_format', return_value=False):
        result = await work_component_serial_input(update, context)

        # Должна остаться в том же состоянии
        assert result == States.WORK_COMPONENT_SERIAL_INPUT


# ============================================================================
# ТЕСТЫ ДЛЯ show_component_selection_pc
# ============================================================================

@pytest.mark.asyncio
async def test_show_component_selection_pc_callback(update, context, equipment_mock):
    """Тест отображения меню выбора компонентов (callback)"""
    from bot.handlers.work import show_component_selection_pc

    update.callback_query = AsyncMock()
    update.callback_query.message = AsyncMock()
    update.callback_query.message.reply_text = AsyncMock()

    result = await show_component_selection_pc(update, context, equipment_mock)

    # Проверка состояния
    assert result == States.WORK_COMPONENT_SELECTION

    # Проверка что сообщение было отправлено с правильными параметрами
    update.callback_query.message.reply_text.assert_called_once()

    # Проверка parse_mode
    call_args = update.callback_query.message.reply_text.call_args
    assert 'parse_mode' in call_args.kwargs
    assert call_args.kwargs['parse_mode'] == 'HTML'

    # Проверка клавиатуры
    reply_markup = call_args.kwargs.get('reply_markup')
    assert reply_markup is not None
    assert hasattr(reply_markup, 'inline_keyboard')
    # Должно быть 8 кнопок (7 компонентов + отмена)
    assert len(reply_markup.inline_keyboard) == 8


@pytest.mark.asyncio
async def test_show_component_selection_pc_message(update, context, equipment_mock):
    """Тест отображения меню выбора компонентов (message)"""
    from bot.handlers.work import show_component_selection_pc

    update.callback_query = None
    update.message.reply_text = AsyncMock()

    result = await show_component_selection_pc(update, context, equipment_mock)

    # Проверка состояния
    assert result == States.WORK_COMPONENT_SELECTION

    # Проверка parse_mode
    call_args = update.message.reply_text.call_args
    assert 'parse_mode' in call_args.kwargs
    assert call_args.kwargs['parse_mode'] == 'HTML'


# ============================================================================
# ТЕСТЫ ДЛЯ save_component_replacement_pc
# ============================================================================

@pytest.mark.asyncio
async def test_save_component_replacement_pc_new_record(context, equipment_mock, temp_json_file):
    """Тест сохранения новой замены компонента"""
    from bot.handlers.work import save_component_replacement_pc

    # Настраиваем контекст
    context.user_data['component_replacement_serial_no'] = 'PF12345'
    context.user_data['component_replacement_equipment'] = equipment_mock
    context.user_data['pc_component_type'] = 'hdd_ssd'
    context.user_data['pc_component_name'] = 'HDD/SSD (Накопитель)'

    # Патчим на уровне модуля
    with patch('bot.handlers.work.database_manager') as mock_db:
        mock_db.get_user_database = Mock(return_value='ITINVENT')
        mock_db.get_database_config = Mock(return_value={'host': 'localhost'})

        # Мокаем подключение к БД
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__ = Mock(return_value=mock_cursor)
        mock_conn.__exit__ = Mock(return_value=None)
        mock_conn.cursor.return_value = mock_conn

        with patch('bot.handlers.work.UniversalInventoryDB') as mock_univ_db:
            mock_univ_db.return_value._get_connection.return_value = mock_conn

            # Выполняем сохранение
            result = await save_component_replacement_pc(context)

            # Проверка результата (JSON будет записан в реальный файл data/component_replacements.json)
            assert result is True


@pytest.mark.asyncio
async def test_save_component_replacement_pc_update_existing(context, equipment_mock, temp_json_file):
    """Тест обновления существующей записи в описании"""
    from bot.handlers.work import save_component_replacement_pc

    # Оборудование с существующим описанием
    equipment_mock['DESCRIPTION'] = 'Старое описание\r\nЗамена HDD/SSD (Накопитель): 01.01.2024 10:00 (IT-BOT)'

    context.user_data['component_replacement_serial_no'] = 'PF12345'
    context.user_data['component_replacement_equipment'] = equipment_mock
    context.user_data['pc_component_type'] = 'hdd_ssd'
    context.user_data['pc_component_name'] = 'HDD/SSD (Накопитель)'

    with patch('bot.handlers.work.database_manager') as mock_db:
        mock_db.get_user_database = Mock(return_value='ITINVENT')
        mock_db.get_database_config = Mock(return_value={'host': 'localhost'})

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__ = Mock(return_value=mock_cursor)
        mock_conn.__exit__ = Mock(return_value=None)
        mock_conn.cursor.return_value = mock_conn

        with patch('bot.handlers.work.UniversalInventoryDB') as mock_univ_db:
            mock_univ_db.return_value._get_connection.return_value = mock_conn

            result = await save_component_replacement_pc(context)

            # Проверка результата (JSON будет записан в реальный файл)
            assert result is True


# ============================================================================
# ТЕСТЫ ДЛЯ очистки временных файлов
# ============================================================================

@pytest.mark.asyncio
async def test_temp_file_cleanup_on_photo_processing(update, context):
    """Тест удаления временного файла после обработки фото"""
    from bot.handlers.work import work_component_serial_input
    import os

    update.message.photo = [AsyncMock()]  # Мок фото
    update.message.photo[-1].file_id = "test_file"

    # Мокаем загрузку файла
    temp_file = "temp_component_replacement_123456.jpg"

    with patch('bot.handlers.work.extract_serial_from_image', return_value="PF12345"):
        with patch('builtins.open', create=True):
            with patch('os.path.exists', return_value=True):
                with patch('os.remove') as mock_remove:
                    update.message.reply_text = AsyncMock()

                    # Мокаем удаление статусного сообщения
                    status_msg = AsyncMock()
                    update.message.reply_text.return_value = status_msg
                    status_msg.delete = AsyncMock()

                    result = await work_component_serial_input(update, context)

                    # Проверяем что временный файл был удален
                    mock_remove.assert_called_once_with(temp_file)


# ============================================================================
# ПАРАМЕТРИЗИРОВАННЫЕ ТЕСТЫ (примеры)
# ============================================================================

@pytest.mark.parametrize("serial_number,expected_result", [
    ("PF12345", True),      # Валидный
    ("ABC-12345", True),    # Валидный
    ("12345", True),        # Только цифры (валидно - серийные номера могут быть цифровыми)
    ("", False),           # Пустая строка
])
def test_validate_serial_format(serial_number, expected_result):
    """Параметризованный тест валидации серийного номера"""
    from bot.services.ocr_service import validate_serial_format
    assert validate_serial_format(serial_number) == expected_result


# ============================================================================
# ТЕСТЫ ИНТЕГРАЦИИ (примеры)
# ============================================================================

@pytest.mark.asyncio
async def test_full_component_replacement_flow(context, equipment_mock, temp_json_file):
    """Тест полного потока замены компонента"""
    from bot.handlers.work import (
        work_component_serial_input,
        show_component_selection_pc,
        handle_pc_component_selection,
        save_component_replacement_pc
    )

    # Шаг 1: Ввод серийного номера
    update = AsyncMock()
    update.effective_user = Mock()
    update.effective_user.id = 123456
    update.message = AsyncMock()
    update.message.text = "PF12345"

    with patch('bot.handlers.work.database_manager') as mock_db:
        mock_db.get_user_database = Mock(return_value='ITINVENT')
        mock_db.get_database_config = Mock(return_value={'host': 'localhost'})

        with patch('bot.handlers.work.UniversalInventoryDB') as mock_univ_db:
            mock_univ_db.return_value.find_by_serial_number = Mock(return_value=[equipment_mock])

            # Шаг 2: Показ меню выбора компонентов
            result = await show_component_selection_pc(update, context, equipment_mock)
            assert result == States.WORK_COMPONENT_SELECTION

            # Шаг 3: Выбор компонента
            update.callback_query = AsyncMock()
            update.callback_query.data = "pc_component:hdd_ssd"
            update.callback_query.answer = AsyncMock()

            result = await handle_pc_component_selection(update, context)

            # Проверяем что данные сохранены в контексте
            assert context.user_data['pc_component_type'] == 'hdd_ssd'
            assert context.user_data['pc_component_name'] == 'HDD/SSD (Накопитель)'

            # Шаг 4: Сохранение
            context.user_data['component_replacement_equipment'] = equipment_mock

            mock_conn = MagicMock()
            mock_cursor = MagicMock()
            mock_conn.__enter__ = Mock(return_value=mock_cursor)
            mock_conn.__exit__ = Mock(return_value=None)
            mock_conn.cursor.return_value = mock_conn

            with patch('bot.handlers.work.UniversalInventoryDB') as mock_univ_db2:
                mock_univ_db2.return_value._get_connection.return_value = mock_conn

                result = await save_component_replacement_pc(context)

                # Проверка успешного сохранения (JSON будет записан в реальный файл)
                assert result is True


# ============================================================================
# ЗАПУСК ТЕСТОВ
# ============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
