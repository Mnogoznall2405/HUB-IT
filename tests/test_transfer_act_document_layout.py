from __future__ import annotations

import importlib
import re
import shutil
from pathlib import Path

import pytest
from docx import Document
from docx.oxml.ns import qn


PROJECT_ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_PATH = PROJECT_ROOT / "templates" / "docx_transfer_act.docx"
EXPECTED_HEADERS = [
    "ID",
    "Тип оборудования",
    "Модель оборудования",
    "Серийный номер",
    "Номер партий",
    "Инвентарный номер",
]
EXPECTED_GRID_WIDTHS = [500, 1900, 2664, 2600, 1500, 1750]
TEXT_AREA_WIDTH = 10914  # 11908 - left 720 - right 274 twips
TO_EMPLOYEE = "Козловский Анатолий Максимович"
FROM_EMPLOYEE = "Козловский Максим Евгеньевич"
DEPARTMENT = "Отдел по защите информации"

# Обязательства из исходной печатной формы — текст не должен меняться.
EXPECTED_OBLIGATIONS_TEXT = """\
Сотрудник принимает на себя следующие обязательства:
1. Полную материальную ответственность за недостачу вверенного ему Работодателем имущества, а также за ущерб, возникший у Работодателя, в связи с изложенным обязуется:
1.1 бережно относиться к переданному ему для осуществления возложенных на него обязанностей имуществу Работодателя и принимать меры к предотвращению ущерба;
1.2 своевременно сообщать Работодателю либо непосредственному руководителю о всех обстоятельствах, угрожающих обеспечению сохранности вверенного ему имущества.
2. Использовать оборудование исключительно для ведения производственной деятельности в соответствии с должностными обязанностями. Не передавать принятое оборудование другим лицам, в том числе коллегам и руководителям.
3. Считать имя пользователя, пароль, PIN-код, QR-код конфиденциальной информацией и не передавать ее другим лицам (коллегам, руководителям или иным лицам).
4. Во время сессии удаленного доступа никто, кроме работника, не должен иметь доступ к компьютеру, а сам компьютер должен быть подключен к другой локальной сети.
5. Всегда фиксировать переносной ПК на рабочем месте с целью предотвращения кражи.
6. Хранить токены, аппаратные ключи доступа, учетные данные для удаленного доступа только в безопасных местах.
7. В случае утраты токена, аппаратного токен-ключа, переносного ПК, и других выданных Работодателем ТМЦ незамедлительно уведомить сотрудников технической поддержки пользователей управления связи и
автоматизации.
8. В случае удаленного доступа с оборудования, принадлежащего третьим сторонам (например, в интернет-кафе), обеспечить, чтобы никто другой не имел доступ к этому оборудованию во время рабочей сессии.
9. Использовать вышеуказанное оборудование с должной аккуратностью и вернуть его в Компанию при отсутствии производственной необходимости, при увольнении либо по требованию Работодателя.
10.Пользователю запрещено подключать к ПК любые USB-устройства (мобильные устройства, вентиляторы, воздухоочистители и т.д.).
11.Работнику необходимо содержать рабочее место в чистоте.
12.В случае покидания рабочего места блокировать компьютер (сочетанием клавиш Win + L).
13.Работник обязуется соблюдать Инструкцию по охране труда при работе на персональном компьютере (ИОТВ № 85-25).
14.При работе с информационными ресурсами Компании работник обязуется соблюдать все действующие
корпоративные документы по информационной безопасности согласно приказа ГФ/ОЗИ-254/ПП от 04.12.2024 Об утверждении Требований к созданию паролей, обращению с компьютером, недопустимости использования программного обеспечения, порядке использования публичных информационных ресурсов, ограничению подключения к компьютерам.
Материальные ценности проверены в присутствии сторон, замечания отсутствуют.
Настоящий акт составлен в 2 экземплярах, по одному для каждой стороны."""


def _assert_transfer_act_layout(path: Path) -> None:
    document = Document(path)

    equipment_table = document.tables[0]
    assert len(equipment_table.columns) == 6
    assert [cell.text for cell in equipment_table.rows[0].cells] == EXPECTED_HEADERS
    assert [cell.text for cell in equipment_table.rows[1].cells] == [
        "1",
        "Системный блок",
        "Lenovo ThinkCentre M720q",
        "PC1L9HLE",
        "ЦБ-00087978",
        "101646",
    ]
    grid_widths = [
        int(grid_column.get(qn("w:w")))
        for grid_column in equipment_table._tbl.tblGrid.gridCol_lst
    ]
    assert grid_widths == EXPECTED_GRID_WIDTHS
    assert sum(grid_widths) <= TEXT_AREA_WIDTH

    # Компактная вёрстка: рамок с абсолютными координатами быть не должно.
    assert not list(document.element.iter(qn("w:framePr")))

    # Шапка таблицы повторяется на каждой странице, строки не разрываются.
    header_trPr = equipment_table.rows[0]._tr.find(qn("w:trPr"))
    assert header_trPr is not None
    assert header_trPr.find(qn("w:tblHeader")) is not None
    for row in equipment_table.rows[1:]:
        trPr = row._tr.find(qn("w:trPr"))
        assert trPr is not None
        assert trPr.find(qn("w:cantSplit")) is not None

    # Завершающие абзацы держатся вместе с блоком подписей.
    closing_paragraphs = [
        paragraph
        for paragraph in document.paragraphs
        if paragraph.text.strip().startswith(
            ("Материальные ценности проверены", "Настоящий акт составлен")
        )
    ]
    assert len(closing_paragraphs) == 2
    for paragraph in closing_paragraphs:
        pPr = paragraph._p.find(qn("w:pPr"))
        assert pPr is not None
        assert pPr.find(qn("w:keepNext")) is not None

    # Текст обязательств не меняется.
    obligations_start = next(
        i
        for i, paragraph in enumerate(document.paragraphs)
        if paragraph.text.strip().startswith("Сотрудник принимает")
    )
    obligations_end = next(
        i
        for i, paragraph in enumerate(document.paragraphs)
        if paragraph.text.strip().startswith("Настоящий акт составлен")
    )
    actual_obligations = [
        re.sub(r"\s+", " ", paragraph.text).strip()
        for paragraph in document.paragraphs[obligations_start : obligations_end + 1]
    ]
    actual_obligations = [line for line in actual_obligations if line]
    assert actual_obligations == EXPECTED_OBLIGATIONS_TEXT.splitlines()

    # Нижний колонтитул: «Акт от <дата>» и поля PAGE/NUMPAGES.
    footer = document.sections[0].footer
    assert not footer.is_linked_to_previous
    footer_text = "\n".join(
        paragraph.text
        for table in footer.tables
        for row in table.rows
        for cell in row.cells
        for paragraph in cell.paragraphs
    ) + "\n" + "\n".join(paragraph.text for paragraph in footer.paragraphs)
    assert "{{" not in footer_text
    assert "HUB-IT" in footer_text
    assert "Акт от" in footer_text
    assert re.search(r"Акт от \d{2}\.\d{2}\.\d{4}", footer_text)
    # PAGE и NUMPAGES — отдельные поля, проверяются точно.
    instr_values = {
        (el.text or "").strip()
        for el in footer.part.element.iter(qn("w:instrText"))
    }
    assert {"PAGE", "NUMPAGES"} <= instr_values
    # Все run'ы колонтитула серые (808080).
    footer_runs = list(footer.part.element.iter(qn("w:r")))
    assert footer_runs
    for run in footer_runs:
        run_pr = run.find(qn("w:rPr"))
        color = run_pr.find(qn("w:color")) if run_pr is not None else None
        assert color is not None
        assert color.get(qn("w:val")) == "808080"

    document_text = "\n".join(
        paragraph.text for paragraph in document.paragraphs
    )
    document_text += "\n" + "\n".join(
        cell.text
        for table in document.tables
        for row in table.rows
        for cell in row.cells
    )
    assert DEPARTMENT not in document_text
    assert "IT Invent" not in document_text
    assert "IT Invent" not in footer_text
    assert "{{TO_EMPLOYEE}}" not in document_text
    assert "{{FROM_EMPLOYEE}}" not in document_text

    signature_container = document.tables[1]
    assert len(signature_container.rows) == 1
    assert len(signature_container.columns) == 1
    assert signature_container.rows[0]._tr.get_or_add_trPr().find(qn("w:cantSplit")) is not None

    signature_grid = signature_container.cell(0, 0).tables[0]
    assert len(signature_grid.rows) == 4
    assert len(signature_grid.columns) == 3
    assert [cell.text for cell in signature_grid.rows[0].cells] == [
        "С условиями ознакомлен:",
        "",
        "Выдал:",
    ]
    assert [cell.text for cell in signature_grid.rows[1].cells] == [
        TO_EMPLOYEE,
        "",
        FROM_EMPLOYEE,
    ]
    assert [cell.text for cell in signature_grid.rows[3].cells] == [
        "(подпись)",
        "",
        "(подпись)",
    ]


def test_web_transfer_act_has_six_columns_and_atomic_signature_block(tmp_path, monkeypatch):
    transfer_service = importlib.import_module("backend.services.transfer_service")
    monkeypatch.setattr(transfer_service, "DEFAULT_ACTS_DIR", tmp_path)

    path, file_type = transfer_service._build_docx_act(
        old_employee=FROM_EMPLOYEE,
        new_employee=TO_EMPLOYEE,
        new_employee_dept=DEPARTMENT,
        items=[
            {
                "type_name": "Системный блок",
                "model_name": "Lenovo ThinkCentre M720q",
                "serial_no": "PC1L9HLE",
                "part_no": "ЦБ-00087978",
                "inv_no": "101646",
            }
        ],
        deterministic_act_id="layout-regression-web",
    )

    assert file_type == "docx"
    _assert_transfer_act_layout(path)


@pytest.mark.asyncio
async def test_bot_transfer_act_has_six_columns_and_atomic_signature_block(tmp_path, monkeypatch):
    pdf_generator = importlib.import_module("bot.services.pdf_generator")
    template_dir = tmp_path / "templates"
    template_dir.mkdir()
    shutil.copy2(TEMPLATE_PATH, template_dir / TEMPLATE_PATH.name)
    monkeypatch.chdir(tmp_path)

    import docx2pdf

    def fail_conversion(*_args, **_kwargs):
        raise RuntimeError("conversion intentionally disabled for DOCX structure test")

    monkeypatch.setattr(docx2pdf, "convert", fail_conversion)

    generated_path = await pdf_generator.generate_transfer_act_pdf(
        new_employee=TO_EMPLOYEE,
        new_employee_dept=DEPARTMENT,
        old_employee=FROM_EMPLOYEE,
        serials_data=[
            {
                "serial": "PC1L9HLE",
                "equipment": {
                    "TYPE_NAME": "Системный блок",
                    "MODEL_NAME": "Lenovo ThinkCentre M720q",
                    "PART_NO": "ЦБ-00087978",
                    "INV_NO": "101646",
                },
            }
        ],
        db_name="main",
    )

    assert generated_path is not None
    assert Path(generated_path).suffix == ".docx"
    _assert_transfer_act_layout(Path(generated_path))
