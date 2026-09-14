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
    completed = subprocess.run([sys.executable, '-c', 'import backend.ai_sandbox_worker_main; import backend.ai_sandbox_gateway_main'],
                               cwd=extracted, env=env, capture_output=True, text=True, timeout=30)
    assert completed.returncode == 0, completed.stderr
