from datetime import date
from decimal import Decimal
import importlib.util
from pathlib import Path
from uuid import uuid4
import pytest
import sqlalchemy as sa
from openpyxl import Workbook
from backend.appdb.db import get_app_engine
from backend.appdb.models import AppConstructionWorkItem, AppConstructionWorkAudit
from backend.services.construction_management_service import ConstructionManagementService

ROOT = Path(__file__).resolve().parents[1]
def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/'construction'/f'{name}.py')
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result

def test_zero_and_empty_date_are_preserved():
    parser=module('prepare-excel-work')
    assert parser.quantity(0)==Decimal(0)
    assert parser.parse_date('\xa0') is None
    with pytest.raises(ValueError): parser.quantity('#REF!')

def test_known_static_subtotals_do_not_double_count_leaf_work(tmp_path):
    parser=module('prepare-excel-work')
    book=Workbook(); sheet=book.active; sheet.title='ГПР-7207 (111)'
    for row,number,name,total in ((6,'1','Раздел',10),(7,'1.1','Оборудование',10),(8,None,'Работа',10)):
        for column,value in ((1,number),(2,name),(4,total),(5,'шт'),(6,5),(10,'\xa0')):
            sheet.cell(row,column,value)
    path=tmp_path/'source.xlsx'; book.save(path)
    report=parser.prepare(path,date.today())['sheets'][0]
    assert len(report['aggregates'])==2
    assert len(report['items'])==1
    assert report['items'][0]['plan']['initial_quantity']=='5.0000'
    assert report['items'][0]['plan']['weight'] is None

@pytest.mark.parametrize('rollback',[False,True])
def test_native_import_is_atomic_and_creates_history(tmp_path,rollback):
    importer=module('import-excel-work')
    url=f'sqlite+pysqlite:///{(tmp_path / "import.db").as_posix()}'
    group=importer.GROUPS['720/7']
    obj=ConstructionManagementService(url).save_object(object_id=None,name='Тест импорта',groups=[{'group_ref':group,'group_name':'720/7'}],role_candidates={},actor_user_id=0)
    importer.OBJECT=obj['id']
    row={'id':str(uuid4()),'source_block':'720/7','plan':{'section':'Раздел','name':'Кабель','unit':'м','planned_quantity':'10','initial_quantity':'2','initial_date':date.today().isoformat(),'weight':None}}
    engine=get_app_engine(url)
    with engine.connect() as connection:
        transaction=connection.begin()
        importer.import_rows(connection,[row])
        assert connection.execute(sa.select(sa.func.count()).select_from(AppConstructionWorkItem)).scalar_one()==1
        assert connection.execute(sa.select(sa.func.count()).select_from(AppConstructionWorkAudit)).scalar_one()==1
        transaction.rollback() if rollback else transaction.commit()
    with engine.connect() as connection:
        assert connection.execute(sa.select(sa.func.count()).select_from(AppConstructionWorkItem)).scalar_one()==(0 if rollback else 1)
        assert connection.execute(sa.select(sa.func.count()).select_from(AppConstructionWorkAudit)).scalar_one()==(0 if rollback else 1)
