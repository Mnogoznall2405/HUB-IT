"""Exercise the full branding workflow against an isolated container filesystem/transport."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import types

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/onlyoffice/brand_ui.py'
API = 'web-apps/apps/api/documents/api.js'


@pytest.fixture
def env(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location('isolated_brand_ui', SCRIPT)
    brand = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(brand)
    # Windows harness: the Linux flock syscall is an unchanged deployment boundary.
    monkeypatch.setitem(sys.modules, 'fcntl', types.SimpleNamespace(LOCK_EX=2, LOCK_NB=4, flock=lambda *_: None))
    names = json.loads(SCRIPT.with_name('original-sha256.json').read_text(encoding='utf-8'))
    original = {}
    for name in names:
        if name.endswith('/api.js'):
            value = f"// vendor API\nconst ver = '/10.0.0-{brand.ORIGINAL_TAG}';\n".encode()
        elif name.endswith('/Main.js'):
            value = b"function vendor() { me.defaultTitleText = 'ONLYOFFICE'; }\n"
        elif name.endswith('/About.js'):
            value = b'''const vendor = [\n                '<table id="id-about-licensor-info"'\n];\n'''
        elif name.endswith('/index.html'):
            value = b'<html><title>ONLYOFFICE editor</title></html>\n'
        else:
            value = b'<svg xmlns="http://www.w3.org/2000/svg"><title>Vendor</title></svg>\n'
        original[name] = value
    manifest = {name: hashlib.sha256(value).hexdigest() for name, value in original.items()}
    files = {**original, **{name + '.gz': gzip.compress(value, mtime=0) for name, value in original.items()}, 'LICENSE.txt': b'test license'}

    class Container:
        package = brand.PACKAGE_VERSION
        ready_after = 0
        ready_checks = 0
        failure = None
        moves = 0
        clock = 0.0
        read_failures = 0

        def __init__(self):
            self.files = files.copy()

        def relative(self, path):
            assert path.startswith(brand.DOCUMENT_ROOT + '/')
            return path[len(brand.DOCUMENT_ROOT) + 1:]

        def run(self, *args):
            if args[:2] == ('podman', 'cp'):
                # Exact historical failure at the process boundary.
                raise subprocess.CalledProcessError(125, args, stderr='container copy unavailable during startup')
            if args[:2] == ('podman', 'inspect'):
                return 'a' * 64
            assert args[:2] == ('podman', 'exec'), args
            assert args[2] in ('onlyoffice', 'a' * 64), args
            command = args[3:]
            if command[0] == 'dpkg-query':
                return self.package
            if command[0] == 'curl':
                self.ready_checks += 1
                if self.ready_checks <= self.ready_after:
                    raise RuntimeError('editor is starting')
                return 'true'
            if command[0] in ('mkdir', 'chmod'):
                return ''
            if command[0] == 'mv':
                source, target = map(self.relative, command[-2:])
                if target == self.failure:
                    self.failure = None
                    raise RuntimeError('simulated publication failure')
                self.files[target] = self.files.pop(source)
                self.moves += 1
                return ''
            if command[0] == 'sha256sum':
                return '\n'.join(hashlib.sha256(self.files[self.relative(path)]).hexdigest() + '  ' + path for path in command[1:])
            raise AssertionError(command)

        def binary(self, *args, **kwargs):
            if args[:3] == ('podman', 'exec', '-i'):
                self.files[self.relative(args[-1])] = kwargs['content']
                return b''
            assert args[:2] == ('podman', 'exec') and args[3:5] == ('cat', '--'), args
            if self.read_failures:
                self.read_failures -= 1
                raise RuntimeError('transient container read failure')
            return self.files[self.relative(args[-1])]

        def sleep(self, seconds):
            self.clock += seconds

    container = Container()
    monkeypatch.setattr(brand, 'run', container.run)
    # Create the transport seam even when running the old script for the regression baseline.
    monkeypatch.setattr(brand, 'run_binary', container.binary, raising=False)
    if hasattr(brand, 'time'):
        monkeypatch.setattr(brand.time, 'sleep', container.sleep)
        monkeypatch.setattr(brand.time, 'monotonic', lambda: container.clock)
    return brand, container, manifest, tmp_path / 'state', original


def test_startup_copy_failure_no_longer_prevents_branding_and_repeat_is_idempotent(env):
    brand, container, manifest, state, original = env
    brand.apply('onlyoffice', state, manifest, False)
    header = 'web-apps/apps/common/main/resources/img/header/dark-logo_s.svg'
    assert b'<title>HUB-IT</title>' in container.files[header]
    assert b'#444444' in container.files[header]
    assert brand.CACHE_TAG.encode() in container.files[API]
    for name in original:
        assert gzip.decompress(container.files[name + '.gz']) == container.files[name]
    published = container.files.copy()
    moves = container.moves
    brand.apply('onlyoffice', state, manifest, False)
    assert container.files == published and container.moves == moves


def test_recreated_container_with_new_cache_namespace_is_rebranded_and_restores_its_own_originals(env):
    brand, container, manifest, state, original = env
    for tag in ('b' * 32, 'c' * 32):
        container.files = {**original, **{name + '.gz': gzip.compress(value, mtime=0) for name, value in original.items()}, 'LICENSE.txt': b'test license'}
        container.files[API] = container.files[API].replace(brand.ORIGINAL_TAG.encode(), tag.encode())
        container.files[API + '.gz'] = gzip.compress(container.files[API], mtime=0)
        stock = container.files.copy()
        brand.apply('onlyoffice', state, manifest, False)
        assert brand.CACHE_TAG.encode() in container.files[API]
    brand.apply('onlyoffice', state, manifest, True)
    assert all(container.files[name] == value for name, value in stock.items())


def test_vendor_code_change_is_rejected_before_any_asset_is_written(env):
    brand, container, manifest, state, _ = env
    container.files[API] += b'console.log("unreviewed vendor change");'
    before = container.files.copy()
    with pytest.raises((ValueError, FileNotFoundError)):
        brand.apply('onlyoffice', state, manifest, False)
    assert container.files == before and container.moves == 0


def test_unknown_package_is_rejected_without_changing_assets(env):
    brand, container, manifest, state, _ = env
    container.package = '11.0.0-new'
    before = container.files.copy()
    with pytest.raises(ValueError, match='Unsupported ONLYOFFICE version'):
        brand.apply('onlyoffice', state, manifest, False)
    assert container.files == before and container.moves == 0


def test_corrupt_original_gzip_cannot_be_published(env):
    brand, container, manifest, state, _ = env
    container.files[API + '.gz'] = gzip.compress(b'wrong version', mtime=0)
    before = container.files.copy()
    with pytest.raises(ValueError, match='gzip differs'):
        brand.apply('onlyoffice', state, manifest, False)
    assert container.files == before and container.moves == 0


def test_publication_failure_restores_exact_original_asset_bytes(env):
    brand, container, manifest, state, original = env
    before = container.files.copy()
    container.failure = 'web-apps/apps/documenteditor/main/app/controller/Main.js'
    with pytest.raises(RuntimeError, match='publication failure'):
        brand.apply('onlyoffice', state, manifest, False)
    assert all(container.files[name] == value for name, value in before.items())


def test_manual_change_to_branded_assets_is_not_overwritten(env):
    brand, container, manifest, state, _ = env
    brand.apply('onlyoffice', state, manifest, False)
    path = 'web-apps/apps/common/main/resources/img/header/header-logo_s.svg'
    container.files[path] = b'<svg>independent administrator change</svg>'
    before = container.files.copy()
    with pytest.raises(ValueError, match='Previously branded assets changed'):
        brand.apply('onlyoffice', state, manifest, False)
    assert container.files == before


def test_waits_for_document_server_readiness_before_applying(env):
    brand, container, manifest, state, _ = env
    container.ready_after = 2
    brand.apply('onlyoffice', state, manifest, False, wait_ready_seconds=10)
    assert container.ready_checks == 3
    assert brand.CACHE_TAG.encode() in container.files[API]


def test_readiness_timeout_does_not_modify_container_assets(env):
    brand, container, manifest, state, _ = env
    container.ready_after = 100
    before = container.files.copy()
    with pytest.raises(RuntimeError, match='not ready'):
        brand.apply('onlyoffice', state, manifest, False, wait_ready_seconds=4)
    assert container.files == before and container.moves == 0


def test_cli_failure_records_an_actionable_status_for_the_next_diagnosis(env, monkeypatch, capsys):
    brand, container, _, state, _ = env
    container.package = 'unsupported-package'
    monkeypatch.setattr(sys, 'argv', ['brand_ui.py', 'apply', '--state', str(state)])
    with pytest.raises(ValueError, match='Unsupported ONLYOFFICE version'):
        brand.main()
    status = json.loads((state / 'last-run.json').read_text(encoding='utf-8'))
    assert status['status'] == 'failed'
    assert 'unsupported-package' in status['error']
    assert 'HUBIT_BRANDING_FAILED' in capsys.readouterr().err
    assert container.moves == 0


def test_transient_read_failure_is_retried_before_branding_is_applied(env):
    brand, container, manifest, state, _ = env
    container.read_failures = 1
    brand.apply('onlyoffice', state, manifest, False)
    assert brand.CACHE_TAG.encode() in container.files[API]
    assert container.clock == 1
