from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.api.v1.chat._common import _raise_chat_http_error


def test_chat_query_cancellation_is_reported_as_retryable_overload():
    class QueryCanceled(Exception):
        sqlstate = "57014"

    class WrappedDatabaseError(Exception):
        def __init__(self):
            super().__init__("statement canceled due to statement timeout")
            self.orig = QueryCanceled("canceling statement due to statement timeout")

    with pytest.raises(HTTPException) as raised:
        _raise_chat_http_error(WrappedDatabaseError())

    assert raised.value.status_code == 503
    assert raised.value.headers == {"Retry-After": "1"}
