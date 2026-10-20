import importlib.util
import os
import subprocess
import sys
import tarfile
from pathlib import Path


def test_allowlisted_release_imports_worker_without_repository_or_live_env(tmp_path):
    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location('sandbox_release', root / 'scripts/ai-sandbox/build_release.py')
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    result = builder.build_release(tmp_path / 'archive')
    extracted = tmp_path / 'release'
    with tarfile.open(result['archive']) as archive:
        assert not any('.env' in name or 'app_service.py' in name for name in archive.getnames())
        archive.extractall(extracted, filter='data')
    env = {**os.environ, 'APP_DATABASE_URL': 'sqlite:///:memory:', 'APP_ENV': 'development',
           'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONPATH': os.pathsep.join([str(extracted), str(extracted / 'WEB-itinvent')])}
    completed = subprocess.run([sys.executable, '-c',
                                'import backend.ai_sandbox_worker_main; import backend.ai_sandbox_gateway_main\n'
                                'try:\n'
                                '    from shared.llm import jev_client\n'
                                'except ImportError:\n'
                                '    pass\n'
                                'else:\n'
                                '    raise AssertionError(\'Minimal sandbox bundle unexpectedly provided the omitted Jev capability\')'],
                               cwd=extracted, env=env, capture_output=True, text=True, timeout=30)
    assert completed.returncode == 0, completed.stderr


def test_shared_llm_does_not_hide_a_missing_jev_dependency(tmp_path):
    root = Path(__file__).resolve().parents[1]
    env = {**os.environ, 'APP_DATABASE_URL': 'sqlite:///:memory:', 'CHAT_DATABASE_URL': 'sqlite:///:memory:',
           'APP_ENV': 'development', 'PYTHONDONTWRITEBYTECODE': '1',
           'PYTHONPATH': os.pathsep.join([str(root), str(root / 'WEB-itinvent')])}
    completed = subprocess.run([sys.executable, '-c',
                                'import importlib.abc\n'
                                'import sys\n'
                                'class BrokenJevDependency(importlib.abc.MetaPathFinder):\n'
                                '    def find_spec(self, fullname, path=None, target=None):\n'
                                "        if fullname == 'shared.llm.jev_client':\n"
                                "            raise ModuleNotFoundError('Missing transitive Jev dependency', name='hub_test_jev_dependency')\n"
                                'sys.meta_path.insert(0, BrokenJevDependency())\n'
                                'try:\n'
                                '    import shared.llm\n'
                                'except ModuleNotFoundError as exc:\n'
                                "    assert exc.name == 'hub_test_jev_dependency'\n"
                                'else:\n'
                                "    raise AssertionError('Import unexpectedly hid a missing Jev dependency')"],
                               cwd=tmp_path, env=env, capture_output=True, text=True, timeout=30)
    assert completed.returncode == 0, completed.stderr
