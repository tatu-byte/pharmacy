"""Small ASGI boundary: bound work before parsing, and reject browser cross-site writes."""

import asyncio
import os

from starlette.datastructures import Headers
from starlette.responses import JSONResponse

from app.domain import reason
from app.validation import strict_json

MAX_BODY = 32 * 1024


def rejected(status, code, message):
    return JSONResponse(
        {
            "error": {
                "code": "request_rejected",
                "violations": [reason(code, "", message)],
            }
        },
        status_code=status,
    )


class RequestGuards:
    def __init__(self, app):
        self.app = app
        self.hosts = set(
            os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1,[::1],api,web").split(",")
        )
        self.origins = set(
            os.getenv(
                "ALLOWED_ORIGINS",
                "http://localhost:8080,http://127.0.0.1:8080,http://localhost:8000,http://127.0.0.1:8000",
            ).split(",")
        )

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        host = headers.get("host", "").lower()
        # Explicit allow-list also prevents DNS rebinding against the local demo.
        hostname = (
            host.split("]", 1)[0] + "]"
            if host.startswith("[")
            else host.split(":", 1)[0]
        )
        if hostname not in self.hosts:
            return await rejected(400, "invalid_host", "Host is not allowed")(
                scope, receive, send
            )
        origin = headers.get("origin")
        if (origin and origin not in self.origins) or headers.get(
            "sec-fetch-site"
        ) == "cross-site":
            return await rejected(
                403, "cross_site_request", "Cross-site requests are not allowed"
            )(scope, receive, send)

        async def secure_send(message):
            if message["type"] == "http.response.start":
                message = {
                    **message,
                    "headers": [
                        *message.get("headers", []),
                        (b"x-content-type-options", b"nosniff"),
                        (b"cache-control", b"no-store"),
                        (b"referrer-policy", b"no-referrer"),
                        (b"x-frame-options", b"DENY"),
                        (b"content-security-policy", b"frame-ancestors 'none'; base-uri 'self'; object-src 'none'"),
                    ],
                }
            await send(message)

        if scope["method"] in {"POST", "PUT", "PATCH"}:
            if (
                headers.get("content-type", "").split(";", 1)[0].lower().strip()
                != "application/json"
            ):
                return await rejected(
                    415, "json_required", "Content-Type must be application/json"
                )(scope, receive, secure_send)
            if headers.get("content-encoding", "identity").lower() != "identity":
                return await rejected(
                    415,
                    "encoding_unsupported",
                    "Compressed request bodies are not supported",
                )(scope, receive, secure_send)
            chunks, size = [], 0
            try:
                async with asyncio.timeout(10):
                    while True:
                        message = await receive()
                        if message["type"] == "http.disconnect":
                            return
                        chunk = message.get("body", b"")
                        size += len(chunk)
                        if size > MAX_BODY:
                            return await rejected(
                                413, "body_too_large", "Request body exceeds 32 KiB"
                            )(scope, receive, secure_send)
                        chunks.append(chunk)
                        if not message.get("more_body", False):
                            break
            except TimeoutError:
                return await rejected(408, "body_timeout", "Request body timed out")(
                    scope, receive, secure_send
                )
            body = b"".join(chunks)
            # Dispense parsing failures are handled by its service so they enter the attempt log.
            if scope["path"] != "/api/v1/dispenses":
                try:
                    strict_json(body)
                except ValueError:
                    return await rejected(
                        422,
                        "invalid_json",
                        "Body must be valid, finite JSON with unique keys and at most 32 nesting levels",
                    )(scope, receive, secure_send)
            consumed = False

            async def replay():
                nonlocal consumed
                if not consumed:
                    consumed = True
                    return {"type": "http.request", "body": body, "more_body": False}
                return await receive()

            return await self.app(scope, replay, secure_send)
        return await self.app(scope, receive, secure_send)
