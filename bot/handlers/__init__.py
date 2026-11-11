"""
Обработчики команд и событий для IT-invent Bot
"""

from .start import start, help_command, cancel, return_to_main_menu
from .search import ask_find_equipment, find_by_serial_input
from .employee import (
    ask_find_by_employee,
    find_by_employee_input,
    handle_employee_pagination
)
from .location import (
    show_location_buttons,
    handle_location_navigation_universal,
    _transfer_location_pagination_handler,
)
from .transfer import (
    start_transfer,
    receive_transfer_photos,
    receive_new_employee,
    receive_transfer_branch,
    receive_transfer_location,
    handle_transfer_branch_callback,
    handle_transfer_location_callback,
    handle_transfer_confirmation,
    handle_employee_suggestion_callback
)
from .database import (
    show_database_menu,
    handle_database_callback,
    show_equipment_types_menu,
    handle_equipment_pagination,
    show_export_database_menu,
    handle_export_database_callback
)
from .export import (
    show_export_menu,
    handle_export_type,
    handle_export_period,
    handle_export_database,
    handle_delivery,
    handle_email_input
)
from .work import (
    work_battery_serial_input,
    show_battery_confirmation,
    save_battery_replacement,
    work_pc_cleaning_serial_input,
    show_pc_cleaning_confirmation,
    save_pc_cleaning,
    work_component_serial_input,
    show_component_selection_pc,
    handle_pc_component_selection,
    save_component_replacement_pc,
    handle_restart_work,
    handle_back_to_main_external,
    handle_work_success_action
)

__all__ = [
    'start',
    'help_command',
    'cancel',
    'return_to_main_menu',
    'ask_find_equipment',
    'find_by_serial_input',
    'ask_find_by_employee',
    'find_by_employee_input',
    'handle_employee_pagination',
    'show_location_buttons',
    'handle_location_navigation_universal',
    '_transfer_location_pagination_handler',
    'start_transfer',
    'receive_transfer_photos',
    'receive_new_employee',
    'receive_transfer_branch',
    'receive_transfer_location',
    'handle_transfer_branch_callback',
    'handle_transfer_location_callback',
    'handle_transfer_confirmation',
    'handle_employee_suggestion_callback',
    'show_database_menu',
    'handle_database_callback',
    'show_equipment_types_menu',
    'handle_equipment_pagination',
    'show_export_database_menu',
    'handle_export_database_callback',
    'show_export_menu',
    'handle_export_type',
    'handle_export_period',
    'handle_export_database',
    'handle_delivery',
    'handle_email_input',
    'work_battery_serial_input',
    'show_battery_confirmation',
    'save_battery_replacement',
    'work_pc_cleaning_serial_input',
    'show_pc_cleaning_confirmation',
    'save_pc_cleaning',
    'work_component_serial_input',
    'show_component_selection_pc',
    'handle_pc_component_selection',
    'save_component_replacement_pc',
    'handle_restart_work',
    'handle_back_to_main_external',
    'handle_work_success_action',
]
