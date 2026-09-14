from types import SimpleNamespace

import pytest

from shared.llm.client import OpenRouterClient
from shared.llm.env import normalize_openrouter_base_url
from shared.llm.errors import OpenRouterClientError


@pytest.mark.parametrize('suffix', ['', '/', '/chat/completions'])
def test_go_base_url_keeps_provider_prefix(suffix):
    assert normalize_openrouter_base_url('https://opencode.ai/zen/go/v1' + suffix) == 'https://opencode.ai/zen/go/v1'
    assert normalize_openrouter_base_url('https://routerai.ru/v1') == 'https://routerai.ru/api/v1'


def test_go_stream_identifies_gateway_and_authenticated_session(monkeypatch):
    client = OpenRouterClient()
    calls = []
    def create(**kwargs):
        calls.append(kwargs)
        return iter([{'choices': []}])
    monkeypatch.setattr(client, '_resolve_base_url', lambda: 'https://opencode.ai/zen/go/v1')
    monkeypatch.setattr(client, '_build_client', lambda **kw: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    list(client.stream_chat_completion(messages=[{'role': 'user', 'content': 'check'}], session_id='session-1'))
    assert calls[0]['extra_headers'] == {'User-Agent': 'hub-opencode-gateway/1.0', 'x-opencode-session': 'session-1'}
    with pytest.raises(OpenRouterClientError, match='stable session'):
        client.stream_chat_completion(messages=[{'role': 'user', 'content': 'check'}], session_id='bad\r\nheader')
    assert len(calls) == 1
