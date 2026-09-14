import importlib.util
from pathlib import Path

import pytest


spec = importlib.util.spec_from_file_location('sandbox_control_launcher', Path(__file__).resolve().parents[1] / 'scripts/ai-sandbox/start_control.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


@pytest.mark.parametrize('host', ['0.0.0.0', '127.0.0.1', '8.8.8.8', '::', '169.254.1.1'])
def test_control_refuses_public_or_wildcard_bind(host):
    with pytest.raises(ValueError):
        launcher.control_options({'AI_SANDBOX_CONTROL_BIND_HOST': host})


def test_control_requires_tls_and_disables_public_proxy_trust(tmp_path):
    values = {'AI_SANDBOX_CONTROL_BIND_HOST': '10.103.0.10', 'AI_SANDBOX_TRANSFER_SERVICE_TOKEN': 'test-only-0123456789-abcdefghijklmnopqrstuvwxyz'}
    with pytest.raises(ValueError):
        launcher.control_options(values)
    cert = tmp_path / 'cert.pem'
    key = tmp_path / 'key.pem'
    cert.write_text('test fixture only')
    key.write_text('test fixture only')
    options = launcher.control_options({**values, 'AI_SANDBOX_CONTROL_TLS_CERT': str(cert), 'AI_SANDBOX_CONTROL_TLS_KEY': str(key)})
    assert options['proxy_headers'] is False
    assert options['access_log'] is False
    assert options['port'] == 8443


@pytest.mark.parametrize('allowed,peer,status', [('', '10.103.0.11', 403), ('10.103.0.11', '10.103.0.12', 403), ('10.103.0.11', '10.103.0.11', 200)])
def test_control_network_acl_uses_transport_peer(monkeypatch, allowed, peer, status):
    import asyncio
    from starlette.requests import Request
    from starlette.responses import Response
    from backend.ai_sandbox_internal_main import restrict_control_network

    monkeypatch.setenv('AI_SANDBOX_CONTROL_ALLOWED_IPS', allowed)
    request = Request({'type': 'http', 'client': (peer, 1234), 'headers': [(b'x-forwarded-for', b'10.103.0.11')]})

    async def next_handler(_request):
        return Response(status_code=200)

    result = asyncio.run(restrict_control_network(request, next_handler))
    assert result.status_code == status
