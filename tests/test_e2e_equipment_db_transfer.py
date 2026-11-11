"""Real transfer/download routes and service over isolated attached SQLite DBs.

The fixture records the production column/nullability metadata (2026-10-13).
Only SQL Server syntax and session advisory locks are adapted. All copies,
deletes, rollback, document associations and BLOB downloads execute real SQL.
This does not certify SQL Server locking or cross-database commit behaviour.
"""
from __future__ import annotations

import io
import json
import re
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pypdf import PdfWriter


def pdf_bytes():
    stream = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    writer.write(stream)
    return stream.getvalue()


class Cursor:
    def __init__(self, connection, harness):
        self.connection, self.harness = connection, harness
        self.raw = connection.raw.cursor()
        self.synthetic = None
        self.description = None
        self.rowcount = -1

    def execute(self, sql, params=()):
        self.harness.sql.append(sql)
        self.synthetic = None
        if "sp_getapplock" in sql:
            database = re.search(r"\[([^]]+)\]\.sys", sql).group(1)
            lock = self.harness.locks[database]
            acquired = lock.acquire(blocking=False)
            if acquired:
                self.connection.acquired.append(database)
            self.synthetic = [(0 if acquired else -1,)]
            self.description = [("result",)]
            return self
        if "sp_releaseapplock" in sql:
            database = re.search(r"\[([^]]+)\]\.sys", sql).group(1)
            self.harness.locks[database].release()
            self.connection.acquired.remove(database)
            return self
        # Reject the SQL Server regression before stripping hints for SQLite.
        # Otherwise `FROM DOCS WITH (...) d` silently becomes valid SQLite SQL.
        if re.search(
            r"\bWITH\s*\([^)]*\)\s+(?:AS\s+)?"
            r"(?!(?:WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|ORDER|GROUP|HAVING|UNION|FOR|OFFSET|FETCH|SET)\b)"
            r"[A-Za-z_]\w*", sql, flags=re.I,
        ):
            raise sqlite3.OperationalError("SQL Server alias must precede table hints")
        sql = re.sub(r"\[source\]\.dbo\.", "source.", sql)
        sql = re.sub(r"\[target\]\.dbo\.", "target.", sql)
        sql = re.sub(r"TRY_CONVERT\(int,\s*ITEM_ID\)", "TRY_CONVERT_INT(ITEM_ID)", sql, flags=re.I)
        sql = re.sub(r"\s+WITH\s*\([^)]*\)", "", sql, flags=re.I)
        sql = re.sub(r"\bISNULL\(", "IFNULL(", sql)
        sql = re.sub(r"\bN'", "'", sql)
        top = re.search(r"SELECT TOP (\d+)", sql)
        if top:
            sql = sql.replace(top.group(0), "SELECT") + " LIMIT " + top.group(1)
        if self.harness.fail_sql and self.harness.fail_sql in sql:
            raise sqlite3.OperationalError("Injected write failure")
        self.raw.execute(sql, params)
        self.description, self.rowcount = self.raw.description, self.raw.rowcount
        return self

    def fetchone(self):
        return self.synthetic.pop(0) if self.synthetic else self.raw.fetchone()

    def fetchall(self):
        return self.synthetic if self.synthetic is not None else self.raw.fetchall()


class Connection:
    def __init__(self, raw, harness):
        self.raw, self.harness, self.acquired = raw, harness, []

    def cursor(self):
        return Cursor(self, self.harness)

    def commit(self):
        self.raw.commit()

    def rollback(self):
        self.raw.rollback()


class Database:
    def __init__(self, name, harness):
        self.name, self.harness = name, harness

    @contextmanager
    def get_connection(self):
        raw = sqlite3.connect(self.harness.paths[self.name], timeout=2)
        raw.create_function("ISNUMERIC", 1, lambda v: 1 if str(v).replace('.', '', 1).isdigit() else 0)
        def try_int(value):
            token = str(value).strip()
            if not re.fullmatch(r"[+-]?\d+", token):
                return None
            number = int(token)
            return number if -(2**31) <= number < 2**31 else None
        raw.create_function("TRY_CONVERT_INT", 1, try_int)
        other = 'source' if self.name == 'target' else 'target'
        raw.execute('ATTACH DATABASE ? AS ' + other, (str(self.harness.paths[other]),))
        conn = Connection(raw, self.harness)
        try:
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            for database in conn.acquired:
                self.harness.locks[database].release()
            raw.close()

    def execute_query(self, sql, params=()):
        if "INFORMATION_SCHEMA.COLUMNS" in sql:
            with sqlite3.connect(self.harness.paths[self.name]) as conn:
                return [{"COLUMN_NAME": r[1]} for r in conn.execute(f"PRAGMA table_info({params[0]})")]
        with self.get_connection() as conn:
            cur = conn.cursor().execute(sql, params)
            return [dict(zip([c[0] for c in cur.description], row)) for row in cur.fetchall()]


@pytest.fixture
def ctx(monkeypatch, tmp_path):
    import local_store
    monkeypatch.setattr(local_store, "_STORE_SINGLETON", None)
    local_store.get_local_store(data_dir=tmp_path / "local_store")
    from backend.api import deps
    from backend.api.v1 import equipment
    from backend.services import equipment_db_transfer_service as transfer
    from backend.services import transfer_service as acts

    harness = SimpleNamespace(paths={n: tmp_path / f"{n}.db" for n in ("source", "target")},
        locks={n: threading.Lock() for n in ("source", "target")}, sql=[], fail_sql=None, rendered=[])
    metadata = json.loads((Path(__file__).parent / "fixtures/equipment_db_transfer_schema.json").read_text(encoding="utf-8"))
    dictionary_sql = [
        "CREATE TABLE BRANCHES(BRANCH_NO INTEGER PRIMARY KEY,BRANCH_NAME TEXT)",
        "CREATE TABLE LOCATIONS(LOC_NO INTEGER PRIMARY KEY,DESCR TEXT)",
        "CREATE TABLE LOC_BRANCH(LOC_NO INTEGER,BRANCH_NO INTEGER)",
        "CREATE TABLE STATUS(STATUS_NO INTEGER PRIMARY KEY,DESCR TEXT)",
        "CREATE TABLE CI_MODELS(MODEL_NO INTEGER,CI_TYPE INTEGER,TYPE_NO INTEGER,MODEL_NAME TEXT,VENDOR_NO INTEGER)",
        "CREATE TABLE VENDORS(VENDOR_NO INTEGER PRIMARY KEY,VENDOR_NAME TEXT)",
        "CREATE TABLE SUPPLIERS(SUPPL_NO INTEGER PRIMARY KEY,SUPPL_NAME TEXT)",
        "CREATE TABLE COMPANY(COMP_NO INTEGER PRIMARY KEY,COMP_NAME TEXT)",
        "CREATE TABLE OWNERS(OWNER_NO INTEGER PRIMARY KEY,OWNER_LNAME TEXT,OWNER_FNAME TEXT,OWNER_MNAME TEXT,OWNER_DISPLAY_NAME TEXT,OWNER_LOGIN TEXT,OWNER_DEPT TEXT)",
    ]
    keys = {"ITEMS": "ID", "FILES": "FILE_NO", "DOCS": "DOC_NO", "MOVES": "MOVE_NO",
            "CI_HISTORY": "HIST_ID", "COMMENTS": "COMMENT_NO", "DEV_SERVICE": "SERVICE_NO"}
    for name, path in harness.paths.items():
        with sqlite3.connect(path) as conn:
            for table in sorted({r['table'] for r in metadata}):
                columns = []
                for row in (r for r in metadata if r['table'] == table):
                    typ = 'BLOB' if row['type'] == 'image' else 'REAL' if row['type'] in ('float','money') else 'INTEGER' if row['type'] == 'int' else 'TEXT'
                    constraint = ' PRIMARY KEY' if keys.get(table) == row['column'] else ' NOT NULL' if row['nullable'] == 'NO' else ''
                    columns.append(row['column']+' '+typ+constraint)
                conn.execute(f"CREATE TABLE {table} ({','.join(columns)})")
            for sql in dictionary_sql:
                conn.execute(sql)
            conn.execute("INSERT INTO BRANCHES VALUES(1,'Филиал')")
            conn.execute("INSERT INTO LOCATIONS VALUES(1,'ИТ')")
            conn.execute("INSERT INTO LOC_BRANCH VALUES(1,1)")
            conn.execute("INSERT INTO STATUS VALUES(1,'В эксплуатации')")
            conn.execute("INSERT INTO CI_TYPES(TYPE_NO,CI_TYPE,TYPE_NAME) VALUES(1,1,'Монитор')")
            conn.execute("INSERT INTO CI_TYPES(TYPE_NO,CI_TYPE,TYPE_NAME) VALUES(3,10,'Акт')")
            conn.execute("INSERT INTO CI_MODELS VALUES(1,1,1,'TEST-MODEL',NULL)")
            conn.execute("INSERT INTO OWNERS(OWNER_NO,OWNER_DISPLAY_NAME,OWNER_DEPT) VALUES(1,'Отправитель','ИТ')")
            conn.execute("INSERT INTO OWNERS(OWNER_NO,OWNER_DISPLAY_NAME,OWNER_DEPT) VALUES(99,'Получатель','ИТ')")
    harness.metadata = metadata

    def insert(database, table, **values):
        values = dict(values)
        for row in metadata:
            if row['table'] == table and row['nullable'] == 'NO' and row['column'] not in values:
                values[row['column']] = 0 if row['type'] in ('int','float','money') else '2026-10-13' if row['type']=='datetime' else ''
        with sqlite3.connect(harness.paths[database]) as conn:
            conn.execute(f"INSERT INTO {table} ({','.join(values)}) VALUES ({','.join('?' for _ in values)})", tuple(values.values()))

    def query(database, sql, params=()):
        with sqlite3.connect(harness.paths[database]) as conn:
            conn.row_factory = sqlite3.Row
            return [dict(r) for r in conn.execute(sql, params)]

    harness.insert, harness.query = insert, query
    for item_id, inv in ((7,1001),(8,1002),(41,1003)):
        insert('source','ITEMS',ID=item_id,CI_TYPE=1,INV_NO=inv,TYPE_NO=1,MODEL_NO=1,STATUS_NO=1,
               BRANCH_NO=1,LOC_NO=1,EMPL_NO=1,COMP_NO=0,SUPPL_NO=0,SERVICE_SUPPL_NO=0,SERIAL_NO=f'TEST-SN-{item_id}')
    insert('source','DOCS',DOC_NO=41,TYPE_NO=3,DOC_NUMBER='Акт 41',EMPL_NO=1,BRANCH_NO=1,LOC_NO=1)
    for item_id in (7,8):
        insert('source','DOCS_LIST',DOC_NO=41,ITEM_ID=item_id,CI_TYPE=1)
    harness.pdf = pdf_bytes()
    insert('source','FILES',FILE_NO=1,ITEM_ID=41,CI_TYPE=10,FILE_TYPE=1,FILE_NAME='signed41.pdf',FILE_DATA=harness.pdf)
    insert('source','FILES',FILE_NO=2,ITEM_ID=7,CI_TYPE=1,FILE_TYPE=0,FILE_NAME='photo.png',FILE_DATA=b'original-photo',FILE_SMALL_IMAGE_DATA=b'thumb')

    monkeypatch.setattr(transfer,'get_db',lambda name: Database(name,harness))
    monkeypatch.setattr(transfer,'get_database_config',lambda name: {'host':'isolated','database':name})
    monkeypatch.setattr(equipment.queries,'get_available_databases',lambda: {'source':{},'target':{}})
    monkeypatch.setattr(equipment.queries,'get_owner_by_no',lambda number,db: next(iter(query(db,'SELECT * FROM OWNERS WHERE OWNER_NO=?',(number,))),None))
    monkeypatch.setattr(equipment.queries,'get_branch_by_no',lambda number,db: next(iter(query(db,'SELECT * FROM BRANCHES WHERE BRANCH_NO=?',(number,))),None))
    monkeypatch.setattr(equipment.queries,'get_location_by_no',lambda number,db: next(iter(query(db,'SELECT * FROM LOCATIONS WHERE LOC_NO=?',(number,))),None))
    # Legacy LOCATIONS has no BRANCH_NO: the real helper cannot validate its
    # LOC_BRANCH relation. Keep that behaviour so the service guard is tested.
    monkeypatch.setattr(equipment.queries,'is_location_in_branch',lambda *args: True)
    monkeypatch.setattr(equipment,'invalidate_equipment_cache',lambda *args: None)
    monkeypatch.setattr(acts,'DEFAULT_ACTS_DIR',tmp_path/'acts')
    monkeypatch.setattr(acts,'_ACT_STORE',{})

    def render(items,name,dept,email,db_id,operation_id=None):
        harness.rendered.append(items)
        path=tmp_path/'new-act.pdf'
        path.write_bytes(harness.pdf)
        act_id=operation_id+'-act'
        acts.register_act_records([{'act_id':act_id,'file_path':str(path),'file_name':path.name,'file_type':'pdf'}])
        return [{'act_id':act_id,'file_name':path.name,'file_type':'pdf'}]
    monkeypatch.setattr(acts,'generate_transfer_acts',render)
    app=FastAPI()
    app.include_router(equipment.router,prefix='/api/v1/equipment')
    harness.user=SimpleNamespace(id=15,username='transfer-test',role='admin',permissions=[],is_active=True)
    app.dependency_overrides[deps.get_current_active_user]=lambda:harness.user
    app.dependency_overrides[equipment.get_request_scoped_database_id]=lambda:'source'
    harness.client=TestClient(app,base_url='https://testserver')
    harness.transfer,harness.acts,harness.equipment=transfer,acts,equipment
    yield harness
    harness.client.close()


def post(ctx, inv_nos=None, **overrides):
    return ctx.client.post('/api/v1/equipment/transfer/to-db',json={
        'operation_id':'db-transfer-test-001','inv_nos':inv_nos or ['1001'],
        'target_db':'target','target_owner_no':99,**overrides})


def test_original_pdf_shared_act_photo_and_restart_download(ctx):
    response=post(ctx,['1001','1002'])
    assert response.status_code==200,response.text
    report=response.json()
    assert report['summary']=={'total':2,'ok':2,'failed':0}
    assert report['verification']['documents']==1 and report['verification']['original_files']==2
    doc_no=report['document_map']['41']
    assert len(ctx.query('target','SELECT * FROM DOCS_LIST WHERE DOC_NO=?',(doc_no,)))==2
    assert ctx.query('target','SELECT FILE_DATA FROM FILES WHERE CI_TYPE=10 AND ITEM_ID=?',(doc_no,))[0]['FILE_DATA']==ctx.pdf
    assert ctx.query('target','SELECT FILE_DATA,FILE_SMALL_IMAGE_DATA FROM FILES WHERE CI_TYPE=1')[0]=={'FILE_DATA':b'original-photo','FILE_SMALL_IMAGE_DATA':b'thumb'}
    assert ctx.query('source','SELECT ID FROM ITEMS')==[{'ID':41}]
    assert ctx.query('source','SELECT FILE_DATA FROM FILES WHERE CI_TYPE=10')[0]['FILE_DATA']==ctx.pdf
    assert ctx.query('source','SELECT * FROM DOCS_LIST')==[]
    ctx.acts._ACT_STORE.clear()
    (ctx.acts.DEFAULT_ACTS_DIR.parent/'new-act.pdf').unlink()
    act=report['acts'][0]
    download=ctx.client.get(f"/api/v1/equipment/transfer/to-db/target/files/{act['file_no']}")
    assert download.status_code==200 and download.content==ctx.pdf
    assert download.headers['content-type']=='application/pdf'
    assert 'attachment' in download.headers['content-disposition']
    replay=post(ctx,['1001','1002'])
    assert replay.status_code==200 and replay.json()['replayed'] is True
    assert len(ctx.rendered)==1
    assert len(ctx.query('target','SELECT * FROM ITEMS'))==2


def test_partial_shared_act_retains_unmoved_source_links(ctx):
    response=post(ctx)
    assert response.status_code==200,response.text
    assert ctx.query('source','SELECT ITEM_ID FROM DOCS_LIST')==[{'ITEM_ID':8}]
    assert len(ctx.query('source','SELECT * FROM FILES WHERE CI_TYPE=10'))==1
    assert len(ctx.query('target','SELECT * FROM FILES WHERE CI_TYPE=10'))==2


def test_collision_cannot_move_or_delete_an_unrelated_document(ctx):
    response=post(ctx,['1003'])
    assert response.status_code==200,response.text
    assert response.json()['verification']['original_files']==0
    assert ctx.query('source','SELECT FILE_DATA FROM FILES WHERE FILE_NO=1')[0]['FILE_DATA']==ctx.pdf
    assert len(ctx.query('source','SELECT * FROM DOCS_LIST WHERE DOC_NO=41'))==2
    assert len(ctx.query('target','SELECT * FROM FILES'))==1  # New receipt only.


@pytest.mark.parametrize('failure', ['INSERT INTO FILES','DELETE FROM source.ITEMS','UPDATE DOCS SET ADDINFO'])
def test_write_failure_rolls_back_both_databases(ctx,failure):
    ctx.fail_sql=failure
    response=post(ctx)
    assert response.status_code==500,response.text
    assert len(ctx.query('source','SELECT * FROM ITEMS'))==3
    assert len(ctx.query('source','SELECT * FROM FILES'))==2
    assert ctx.query('target','SELECT * FROM ITEMS')==[]
    assert ctx.query('target','SELECT * FROM DOCS')==[]
    ctx.fail_sql=None
    assert post(ctx).status_code==200


@pytest.mark.parametrize('payload', [None,b'broken PDF',b'%PDF-1.7\ntruncated\n%%EOF'])
def test_missing_or_invalid_original_pdf_blocks_before_any_writes(ctx,payload):
    with sqlite3.connect(ctx.paths['source']) as conn:
        conn.execute('UPDATE FILES SET FILE_DATA=? WHERE FILE_NO=1',(payload,))
    response=post(ctx)
    assert response.status_code==400,response.text
    assert ctx.query('target','SELECT * FROM ITEMS')==[]
    assert len(ctx.query('source','SELECT * FROM ITEMS'))==3
    assert ctx.rendered==[]


def test_missing_document_attachment_blocks_transfer(ctx):
    with sqlite3.connect(ctx.paths['source']) as conn:
        conn.execute('DELETE FROM FILES WHERE FILE_NO=1')
    response=post(ctx)
    assert response.status_code==400 and 'вложения отсутствуют' in response.json()['detail']
    assert ctx.query('target','SELECT * FROM ITEMS')==[]


def test_pdf_generation_failure_preserves_source(ctx,monkeypatch):
    def broken(*args,**kwargs):
        raise ctx.acts.TransferActGenerationError('conversion failed')
    monkeypatch.setattr(ctx.acts,'generate_transfer_acts',broken)
    response=post(ctx)
    assert response.status_code==503,response.text
    assert len(ctx.query('source','SELECT * FROM ITEMS'))==3
    assert ctx.query('target','SELECT * FROM ITEMS')==[]


@pytest.mark.parametrize('table', ['INVENT_LIST','TASKS_LIST','JOBS_LIST','CARTRIGES_REPLACES','FIELDS_VALUES'])
def test_unsupported_links_block_instead_of_being_deleted(ctx,table):
    values={'ITEM_ID':7}
    if table in ('INVENT_LIST','JOBS_LIST'):values['CI_TYPE']=1
    if table=='FIELDS_VALUES':values.update(ITEM_ID='7',ITEM_NO=1,FIELD_NO=123)
    ctx.insert('source',table,**values)
    response=post(ctx)
    assert response.status_code==400,response.text
    assert len(ctx.query('source',f'SELECT * FROM {table}'))==1
    assert ctx.query('target','SELECT * FROM ITEMS')==[]


def test_source_changed_during_render_is_not_deleted(ctx,monkeypatch):
    render=ctx.acts.generate_transfer_acts
    def changed(*args,**kwargs):
        with sqlite3.connect(ctx.paths['source']) as conn:
            conn.execute("UPDATE ITEMS SET DESCR='changed by another user' WHERE ID=7")
        return render(*args,**kwargs)
    monkeypatch.setattr(ctx.acts,'generate_transfer_acts',changed)
    response=post(ctx)
    assert response.status_code==409,response.text
    assert ctx.query('target','SELECT * FROM ITEMS')==[]
    assert ctx.query('source','SELECT DESCR FROM ITEMS WHERE ID=7')[0]['DESCR']=='changed by another user'


def test_operation_key_cannot_be_reused_with_other_parameters(ctx):
    assert post(ctx).status_code==200
    response=post(ctx,['1002'])
    assert response.status_code==409,response.text
    assert len(ctx.query('target','SELECT * FROM ITEMS'))==1
    assert len(ctx.query('source','SELECT * FROM ITEMS'))==2


def test_parallel_transfer_is_rejected_and_retry_replays(ctx,monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    started,release=threading.Event(),threading.Event()
    render=ctx.acts.generate_transfer_acts
    def waiting(*args,**kwargs):
        started.set()
        assert release.wait(10)
        return render(*args,**kwargs)
    monkeypatch.setattr(ctx.acts,'generate_transfer_acts',waiting)
    with ThreadPoolExecutor(max_workers=2) as executor:
        first=executor.submit(post,ctx)
        assert started.wait(10)
        second=executor.submit(post,ctx).result(timeout=10)
        assert second.status_code==409,second.text
        release.set()
        assert first.result(timeout=10).status_code==200
    assert post(ctx).json()['replayed'] is True
    assert len(ctx.query('target','SELECT * FROM ITEMS'))==1


def test_download_and_transfer_require_write_permission(ctx):
    ctx.user.role='viewer'
    assert post(ctx).status_code==403
    assert ctx.client.get('/api/v1/equipment/transfer/to-db/target/files/1').status_code==403
    assert ctx.client.post('/api/v1/equipment/transfer/to-db/target/files/1/email',json={'recipient_email':'test@example.com'}).status_code==403


def test_history_comments_service_and_moves_keep_remapped_links(ctx):
    ctx.insert('source','CI_HISTORY',HIST_ID=1,ITEM_ID=7,EMPL_NO_OLD=1,EMPL_NO_NEW=1,
               BRANCH_NO_OLD=1,BRANCH_NO_NEW=1,LOC_NO_OLD=1,LOC_NO_NEW=1,STATUS_NO_NEW=1,
               TYPE_NO_NEW=1,MODEL_NO_NEW=1,CI_TYPE_OLD=1,CI_TYPE_NEW=1,CH_COMMENT='original history')
    ctx.insert('source','COMMENTS',COMMENT_NO=1,ITEM_ID=7,CI_TYPE=1,COMMENT_TEXT='equipment note')
    ctx.insert('source','COMMENTS',COMMENT_NO=2,ITEM_ID=41,CI_TYPE=10,COMMENT_TEXT='document note')
    ctx.insert('source','DEV_SERVICE',SERVICE_NO=1,ITEM_ID=7,FAILURE_DESCR='service history',SERVICE_SUPPL_NO=0)
    ctx.insert('source','MOVES',MOVE_NO=2,SOURCE_BRANCH_NO=1,TARGET_BRANCH_NO=1,SOURCE_EMPL_NO=1,TARGET_EMPL_NO=99,COMP_NO=0)
    for item_id in (7,8):ctx.insert('source','MOVES_LIST',MOVE_NO=2,ITEM_ID=item_id)
    with sqlite3.connect(ctx.paths['target']) as conn:
        conn.execute('UPDATE CI_TYPES SET TYPE_NO=30 WHERE CI_TYPE=10')
    response=post(ctx,['1001','1002'])
    assert response.status_code==200,response.text
    report=response.json()
    doc_no=report['document_map']['41']
    assert ctx.query('target','SELECT TYPE_NO FROM DOCS WHERE DOC_NO=?',(doc_no,))==[{'TYPE_NO':30}]
    assert len(ctx.query('target','SELECT * FROM MOVES'))==1
    assert len(ctx.query('target','SELECT * FROM MOVES_LIST'))==2
    assert len(ctx.query('target','SELECT * FROM CI_HISTORY'))==3
    assert len(ctx.query('target',"SELECT * FROM CI_HISTORY WHERE CH_COMMENT='original history'"))==1
    assert len(ctx.query('target',"SELECT * FROM COMMENTS WHERE COMMENT_TEXT='document note' AND ITEM_ID=?",(doc_no,)))==1
    assert len(ctx.query('source','SELECT * FROM COMMENTS WHERE CI_TYPE=10'))==1
    assert ctx.query('source','SELECT * FROM DEV_SERVICE')==[]
    assert ctx.query('target','SELECT FAILURE_DESCR FROM DEV_SERVICE')==[{'FAILURE_DESCR':'service history'}]


def test_shared_field_definitions_are_never_deleted_by_equipment_id(ctx):
    ctx.insert('source','FIELDS',FIELD_NO=1,ITEM_NO=7,FIELD_NAME='Shared field definition')
    ctx.insert('source','FIELDS_LINKS',ITEM_NO=7,FIELD_NO=1,ITEM_TYPE_NO=1)
    response=post(ctx)
    assert response.status_code==200,response.text
    assert len(ctx.query('source','SELECT * FROM FIELDS'))==1
    assert len(ctx.query('source','SELECT * FROM FIELDS_LINKS'))==1


def test_target_inventory_changed_during_render_aborts(ctx,monkeypatch):
    render=ctx.acts.generate_transfer_acts
    def changed(*args,**kwargs):
        ctx.insert('target','ITEMS',ID=500,INV_NO=500,CI_TYPE=1,TYPE_NO=1,MODEL_NO=1,STATUS_NO=1,BRANCH_NO=1,LOC_NO=1)
        return render(*args,**kwargs)
    monkeypatch.setattr(ctx.acts,'generate_transfer_acts',changed)
    response=post(ctx)
    assert response.status_code==409,response.text
    assert len(ctx.query('source','SELECT * FROM ITEMS'))==3
    assert ctx.query('target','SELECT ID FROM ITEMS')==[{'ID':500}]


def test_email_reads_persistent_pdf_after_registry_loss(ctx,monkeypatch):
    response=post(ctx)
    assert response.status_code==200,response.text
    act=response.json()['acts'][0]
    ctx.acts._ACT_STORE.clear()
    captured=[]
    async def send(**kwargs):
        captured.append(kwargs)
        return True
    monkeypatch.setattr(ctx.equipment,'send_binary_file_email',send)
    sent=ctx.client.post(f"/api/v1/equipment/transfer/to-db/target/files/{act['file_no']}/email",json={'recipient_email':'test@example.com'})
    assert sent.status_code==200,sent.text
    assert captured[0]['file_bytes']==ctx.pdf and captured[0]['recipient_email']=='test@example.com'
    assert ctx.client.get('/api/v1/equipment/transfer/to-db/source/files/1').status_code==404


def test_replay_does_not_create_another_acceptance_task(ctx,monkeypatch):
    from backend.services.hub_service import hub_service
    tasks=[]
    monkeypatch.setattr(hub_service,'ensure_transfer_act_reminder_task_project',lambda:{'id':'test-project'})
    def create(**kwargs):
        tasks.append(kwargs)
        return {'id':'test-task','title':kwargs['title']}
    monkeypatch.setattr(hub_service,'create_task',create)
    first=post(ctx,task_assignee_user_ids=[15])
    assert first.status_code==200 and first.json()['task']['id']=='test-task',first.text
    replay=post(ctx,task_assignee_user_ids=[15])
    assert replay.status_code==200 and replay.json()['task']['id']=='test-task',replay.text
    assert len(tasks)==1


def test_recipient_changed_during_render_aborts(ctx,monkeypatch):
    render=ctx.acts.generate_transfer_acts
    def changed(*args,**kwargs):
        with sqlite3.connect(ctx.paths['target']) as conn:
            conn.execute("UPDATE OWNERS SET OWNER_DISPLAY_NAME='Changed recipient' WHERE OWNER_NO=99")
        return render(*args,**kwargs)
    monkeypatch.setattr(ctx.acts,'generate_transfer_acts',changed)
    response=post(ctx)
    assert response.status_code==409,response.text
    assert len(ctx.query('source','SELECT * FROM ITEMS'))==3
    assert ctx.query('target','SELECT * FROM ITEMS')==[]


@pytest.mark.parametrize('payload,status', [
    ({'target_db':'source'},400), ({'target_db':'unknown'},400),
    ({'target_owner_no':None},400), ({'operation_id':'invalid key'},422),
])
def test_invalid_requests_cannot_modify_databases(ctx,payload,status):
    response=post(ctx,**payload)
    assert response.status_code==status,response.text
    assert len(ctx.query('source','SELECT * FROM ITEMS'))==3
    assert ctx.query('target','SELECT * FROM ITEMS')==[]


def test_unauthenticated_requests_are_rejected(ctx):
    from backend.api import deps
    ctx.client.app.dependency_overrides.pop(deps.get_current_active_user)
    assert post(ctx).status_code==401
    assert ctx.client.get('/api/v1/equipment/transfer/to-db/target/files/1').status_code==401


def test_model_name_collision_creates_model_with_correct_type_and_vendor(ctx):
    with sqlite3.connect(ctx.paths['target']) as conn:
        conn.execute("INSERT INTO CI_TYPES(TYPE_NO,CI_TYPE,TYPE_NAME) VALUES(2,1,'Other category')")
        conn.execute("INSERT INTO VENDORS VALUES(2,'Other vendor')")
        conn.execute('UPDATE CI_MODELS SET TYPE_NO=2,VENDOR_NO=2 WHERE MODEL_NO=1')
    response=post(ctx)
    assert response.status_code==200,response.text
    row=ctx.query('target','SELECT i.TYPE_NO AS item_type,m.TYPE_NO AS model_type,m.VENDOR_NO AS vendor FROM ITEMS i JOIN CI_MODELS m ON i.MODEL_NO=m.MODEL_NO AND i.CI_TYPE=m.CI_TYPE')[0]
    assert row=={'item_type':1,'model_type':1,'vendor':None}
    assert len(ctx.query('target','SELECT * FROM CI_MODELS'))==2


def test_location_name_in_other_branch_is_not_reused(ctx):
    for database in ('source','target'):
        with sqlite3.connect(ctx.paths[database]) as conn:
            conn.execute("INSERT INTO BRANCHES VALUES(2,'Second branch')")
    with sqlite3.connect(ctx.paths['source']) as conn:
        conn.execute('UPDATE ITEMS SET BRANCH_NO=2 WHERE ID=7')
        conn.execute('INSERT INTO LOC_BRANCH VALUES(1,2)')
    response=post(ctx)
    assert response.status_code==200,response.text
    row=ctx.query('target','SELECT BRANCH_NO,LOC_NO FROM ITEMS')[0]
    assert row['BRANCH_NO']==2 and row['LOC_NO']!=1
    assert ctx.query('target','SELECT * FROM LOC_BRANCH WHERE LOC_NO=? AND BRANCH_NO=?',(row['LOC_NO'],row['BRANCH_NO']))
    assert ctx.query('target','SELECT * FROM LOC_BRANCH WHERE LOC_NO=1')==[{'LOC_NO':1,'BRANCH_NO':1}]


def test_explicit_location_from_other_branch_is_rejected(ctx):
    ctx.insert('target','BRANCHES',BRANCH_NO=2,BRANCH_NAME='Second branch')
    response=post(ctx,target_branch_no=2,target_loc_no=1)
    assert response.status_code==400,response.text
    assert len(ctx.query('source','SELECT * FROM ITEMS'))==3
    assert ctx.query('target','SELECT * FROM ITEMS')==[]


@pytest.mark.parametrize('field_item_id',['0007',' 7 ','+7'])
def test_noncanonical_additional_field_id_blocks_before_delete(ctx,field_item_id):
    ctx.insert('source','FIELDS_VALUES',ITEM_ID=field_item_id,ITEM_NO=1,FIELD_NO=123,FIELD_VALUE='preserve-me')
    response=post(ctx)
    assert response.status_code==400,response.text
    assert len(ctx.query('source','SELECT * FROM ITEMS WHERE ID=7'))==1
    assert ctx.query('source','SELECT FIELD_VALUE FROM FIELDS_VALUES')==[{'FIELD_VALUE':'preserve-me'}]
    assert ctx.query('target','SELECT * FROM ITEMS')==[]


def test_unrelated_owner_change_does_not_abort_transfer(ctx,monkeypatch):
    render=ctx.acts.generate_transfer_acts
    def changed(*args,**kwargs):
        ctx.insert('source','OWNERS',OWNER_NO=200,OWNER_DISPLAY_NAME='Unrelated person')
        return render(*args,**kwargs)
    monkeypatch.setattr(ctx.acts,'generate_transfer_acts',changed)
    response=post(ctx)
    assert response.status_code==200,response.text
    assert ctx.query('source','SELECT * FROM ITEMS WHERE ID=7')==[]
    assert len(ctx.query('target','SELECT * FROM ITEMS'))==1


def test_referenced_owner_change_aborts_transfer(ctx,monkeypatch):
    render=ctx.acts.generate_transfer_acts
    def changed(*args,**kwargs):
        with sqlite3.connect(ctx.paths['source']) as conn:
            conn.execute("UPDATE OWNERS SET OWNER_DISPLAY_NAME='Changed source owner' WHERE OWNER_NO=1")
        return render(*args,**kwargs)
    monkeypatch.setattr(ctx.acts,'generate_transfer_acts',changed)
    response=post(ctx)
    assert response.status_code==409,response.text
    assert len(ctx.query('source','SELECT * FROM ITEMS WHERE ID=7'))==1
    assert ctx.query('target','SELECT * FROM ITEMS')==[]


def test_round_trip_preserves_original_operation_replay(ctx):
    first=post(ctx)
    assert first.status_code==200,first.text
    ctx.client.app.dependency_overrides[ctx.equipment.get_request_scoped_database_id]=lambda:'target'
    second=post(ctx,[str(first.json()['items'][0]['inv_no_new'])],target_db='source',operation_id='db-transfer-test-002')
    assert second.status_code==200,second.text
    ctx.client.app.dependency_overrides[ctx.equipment.get_request_scoped_database_id]=lambda:'source'
    third=post(ctx,[str(second.json()['items'][0]['inv_no_new'])],operation_id='db-transfer-test-003')
    assert third.status_code==200,third.text
    replay=post(ctx)
    assert replay.status_code==200 and replay.json()['replayed'] is True,replay.text
    assert len(ctx.query('target','SELECT * FROM DOCS WHERE ADDINFO LIKE ?',('%HUB_DB_TRANSFER_V1:db-transfer-test-001:%',)))==1
    assert len(ctx.query('target','SELECT * FROM ITEMS'))==1


@pytest.mark.parametrize('owns_operation',[False,True])
def test_operator_can_access_cross_database_pdf_only_for_own_operation(ctx,monkeypatch,owns_operation):
    created=post(ctx)
    assert created.status_code==200,created.text
    act=created.json()['acts'][0]
    ctx.user.role='operator'
    ctx.user.permissions=['database.write']
    ctx.user.assigned_database='source'
    if not owns_operation:
        ctx.user.id=20
        ctx.user.username='other-operator'
    sent=[]
    async def send(**kwargs):sent.append(kwargs);return True
    monkeypatch.setattr(ctx.equipment,'send_binary_file_email',send)
    download=ctx.client.get(f"/api/v1/equipment/transfer/to-db/target/files/{act['file_no']}")
    email=ctx.client.post(f"/api/v1/equipment/transfer/to-db/target/files/{act['file_no']}/email",json={'recipient_email':'test@example.com'})
    assert download.status_code==(200 if owns_operation else 403),download.text
    assert email.status_code==(200 if owns_operation else 403),email.text
    assert len(sent)==(1 if owns_operation else 0)
    if owns_operation:assert download.content==ctx.pdf


@pytest.mark.parametrize('has_matching_model',[False,True])
def test_model_vendor_collision_resolves_by_vendor_name(ctx,has_matching_model):
    ctx.insert('source','VENDORS',VENDOR_NO=5,VENDOR_NAME='Original vendor')
    with sqlite3.connect(ctx.paths['source']) as conn:
        conn.execute('UPDATE CI_MODELS SET VENDOR_NO=5 WHERE MODEL_NO=1')
    ctx.insert('target','VENDORS',VENDOR_NO=2,VENDOR_NAME='Other vendor')
    ctx.insert('target','VENDORS',VENDOR_NO=9,VENDOR_NAME='Original vendor')
    with sqlite3.connect(ctx.paths['target']) as conn:
        conn.execute('UPDATE CI_MODELS SET VENDOR_NO=2 WHERE MODEL_NO=1')
    if has_matching_model:
        ctx.insert('target','CI_MODELS',MODEL_NO=8,CI_TYPE=1,TYPE_NO=1,MODEL_NAME='TEST-MODEL',VENDOR_NO=9)
    response=post(ctx)
    assert response.status_code==200,response.text
    row=ctx.query('target','SELECT i.MODEL_NO,m.VENDOR_NO FROM ITEMS i JOIN CI_MODELS m ON i.MODEL_NO=m.MODEL_NO AND i.CI_TYPE=m.CI_TYPE')[0]
    assert row['VENDOR_NO']==9 and row['MODEL_NO']==(8 if has_matching_model else 2)
    assert len(ctx.query('target','SELECT * FROM CI_MODELS'))==2


def test_legacy_copied_journal_does_not_make_retry_ambiguous(ctx):
    first=post(ctx)
    assert first.status_code==200,first.text
    receipt=ctx.query('target','SELECT * FROM DOCS WHERE DOC_NO=?',(first.json()['act_doc_no'],))[0]
    ctx.insert('target','DOCS',**{**receipt,'DOC_NO':500})
    replay=post(ctx)
    assert replay.status_code==200 and replay.json()['replayed'] is True,replay.text
    assert replay.json()['act_doc_no']==first.json()['act_doc_no']
    assert len(ctx.query('target','SELECT * FROM ITEMS'))==1


def test_operation_keys_with_colons_and_common_prefixes_replay_exactly(ctx):
    first=post(ctx,operation_id='db-transfer-prefix:001')
    second=post(ctx,['1002'],operation_id='db-transfer-prefix')
    assert first.status_code==200,first.text
    assert second.status_code==200,second.text
    for original,inv,key in ((first,'1001','db-transfer-prefix:001'),(second,'1002','db-transfer-prefix')):
        replay=post(ctx,[inv],operation_id=key)
        assert replay.status_code==200 and replay.json()['replayed'] is True,replay.text
        assert replay.json()['act_doc_no']==original.json()['act_doc_no']
    assert len(ctx.query('target','SELECT * FROM ITEMS'))==2


def test_target_database_operator_can_download_existing_receipt(ctx):
    created=post(ctx)
    assert created.status_code==200,created.text
    ctx.user.role='operator'
    ctx.user.permissions=['database.write']
    ctx.user.id=20
    ctx.user.username='receiving-operator'
    ctx.client.app.dependency_overrides[ctx.equipment.get_request_scoped_database_id]=lambda:'target'
    file_no=created.json()['acts'][0]['file_no']
    response=ctx.client.get(f'/api/v1/equipment/transfer/to-db/target/files/{file_no}')
    assert response.status_code==200 and response.content==ctx.pdf,response.text


@pytest.mark.parametrize('owns_operation',[False,True])
def test_legacy_receipt_cross_database_access_uses_creator_username(ctx,owns_operation):
    created=post(ctx)
    assert created.status_code==200,created.text
    row=ctx.query('target','SELECT ADDINFO FROM DOCS WHERE DOC_NO=?',(created.json()['act_doc_no'],))[0]
    header,payload=row['ADDINFO'].split(ctx.transfer._OP_MARKER,1)
    operation_id,_,encoded=payload.partition(':{')
    stored=json.loads('{'+encoded)
    stored['report'].pop('created_by_user_id')
    with sqlite3.connect(ctx.paths['target']) as conn:
        conn.execute('UPDATE DOCS SET ADDINFO=? WHERE DOC_NO=?',(header+ctx.transfer._OP_MARKER+operation_id+':'+json.dumps(stored),created.json()['act_doc_no']))
    ctx.user.role='operator'
    ctx.user.permissions=['database.write']
    if not owns_operation:ctx.user.username='another-operator'
    file_no=created.json()['acts'][0]['file_no']
    response=ctx.client.get(f'/api/v1/equipment/transfer/to-db/target/files/{file_no}')
    assert response.status_code==(200 if owns_operation else 403),response.text
    if owns_operation:assert response.content==ctx.pdf


@pytest.mark.parametrize('journal_change',['missing_marker','invalid_report','invalid_acts','copied_receipt'])
def test_corrupted_journal_cannot_authorize_cross_database_pdf(ctx,monkeypatch,journal_change):
    created=post(ctx)
    assert created.status_code==200,created.text
    receipt_no=created.json()['act_doc_no']
    row=ctx.query('target','SELECT ADDINFO FROM DOCS WHERE DOC_NO=?',(receipt_no,))[0]
    header,payload=row['ADDINFO'].split(ctx.transfer._OP_MARKER,1)
    operation_id,_,encoded=payload.partition(':{')
    stored=json.loads('{'+encoded)
    if journal_change=='invalid_report':stored['report']=[]
    if journal_change=='invalid_acts':stored['report']['acts']=[None]
    if journal_change=='copied_receipt':stored['report']['act_doc_no']=receipt_no+1
    addinfo=header+(ctx.transfer._OP_MARKER if journal_change!='missing_marker' else '')+operation_id+':'+json.dumps(stored)
    with sqlite3.connect(ctx.paths['target']) as conn:
        conn.execute('UPDATE DOCS SET ADDINFO=? WHERE DOC_NO=?',(addinfo,receipt_no))
    ctx.user.role='operator'
    ctx.user.permissions=['database.write']
    async def forbidden_send(**kwargs):pytest.fail('Unauthorized PDF reached SMTP')
    monkeypatch.setattr(ctx.equipment,'send_binary_file_email',forbidden_send)
    file_no=created.json()['acts'][0]['file_no']
    path=f'/api/v1/equipment/transfer/to-db/target/files/{file_no}'
    assert ctx.client.get(path).status_code==403
    assert ctx.client.post(path+'/email',json={'recipient_email':'test@example.com'}).status_code==403


@pytest.mark.parametrize('owns_operation',[False,True])
def test_fixed_database_assignment_cannot_be_bypassed_by_download_header(ctx,monkeypatch,owns_operation):
    from backend.api.v1 import database
    created=post(ctx)
    assert created.status_code==200,created.text
    ctx.user.role='operator'
    ctx.user.permissions=['database.write']
    ctx.user.assigned_database='source'
    if not owns_operation:
        ctx.user.id=20
        ctx.user.username='another-operator'
    monkeypatch.setattr(database,'get_all_db_configs',lambda:[{'id':'source'},{'id':'target'}])
    ctx.client.app.dependency_overrides.pop(ctx.equipment.get_request_scoped_database_id)
    file_no=created.json()['acts'][0]['file_no']
    path=f'/api/v1/equipment/transfer/to-db/target/files/{file_no}'
    headers={'X-Database-ID':'target'}
    response=ctx.client.get(path,headers=headers)
    assert response.status_code==(200 if owns_operation else 403),response.text
    async def send(**kwargs):return True
    monkeypatch.setattr(ctx.equipment,'send_binary_file_email',send)
    email=ctx.client.post(path+'/email',headers=headers,json={'recipient_email':'test@example.com'})
    assert email.status_code==(200 if owns_operation else 403),email.text
