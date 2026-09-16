"""JSON-only gzip compression middleware.

starlette's GZipMiddleware buffers streaming bodies without flushing, which
breaks SSE (`text/event-stream`) and file downloads. This middleware compresses
only `application/json` responses above `minimum_size`; every other response —
including all streaming endpoints — passes through untouched.
"""
import gzip
from typing import Any

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

DEFAULT_MINIMUM_SIZE = 1024


class JsonGzipMiddleware:
    """ASGI middleware: gzip for application/json responses only."""

    def __init__(self, app: ASGIApp, minimum_size: int = DEFAULT_MINIMUM_SIZE, compresslevel: int = 6) -> None:
        self.app = app
        self.minimum_size = minimum_size
        self.compresslevel = compresslevel

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        accept_encoding = Headers(scope=scope).get("accept-encoding", "")
        if "gzip" not in accept_encoding.lower():
            await self.app(scope, receive, send)
            return
        responder = _JsonGzipResponder(self.app, self.minimum_size, self.compresslevel)
        await responder(scope, receive, send)


class _JsonGzipResponder:
    def __init__(self, app: ASGIApp, minimum_size: int, compresslevel: int) -> None:
        self.app = app
        self.minimum_size = minimum_size
        self.compresslevel = compresslevel
        self.is_json = False
        self.start_message: Message | None = None
        self.body_parts: list[bytes] = []

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        async def wrapped_send(message: Message) -> None:
            message_type = message["type"]

            if message_type == "http.response.start":
                headers = Headers(raw=message["headers"])
                content_type = headers.get("content-type", "")
                self.is_json = (
                    "content-encoding" not in headers
                    and content_type.lower().startswith("application/json")
                )
                if not self.is_json:
                    await send(message)
                else:
                    self.start_message = message
                return

            if message_type == "http.response.pathsend":
                if self.start_message is not None:
                    await send(self.start_message)
                    self.start_message = None
                await send(message)
                return

            if message_type != "http.response.body":
                await send(message)
                return

            if not self.is_json:
                await send(message)
                return

            # JSON path: buffer until the body is complete, then compress once.
            self.body_parts.append(message.get("body", b""))
            if message.get("more_body", False):
                return

            body = b"".join(self.body_parts)
            assert self.start_message is not None
            headers = MutableHeaders(raw=self.start_message["headers"])
            headers.add_vary_header("Accept-Encoding")

            if len(body) >= self.minimum_size:
                body = gzip.compress(body, compresslevel=self.compresslevel)
                headers["Content-Encoding"] = "gzip"

            headers["Content-Length"] = str(len(body))
            await send(self.start_message)
            await send({"type": "http.response.body", "body": body, "more_body": False})

        try:
            await self.app(scope, receive, wrapped_send)
        finally:
            # App raised before producing a response start — nothing to flush.
            self.body_parts.clear()


def get_json_gzip_middleware() -> Any:
    return JsonGzipMiddleware
