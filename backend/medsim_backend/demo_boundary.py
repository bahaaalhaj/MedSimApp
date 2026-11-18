"""Exact-origin ingress for the same-origin guest demo; forwarded headers confer no trust."""
from urllib.parse import urlsplit

from starlette.requests import Request
from starlette.responses import JSONResponse


class DemoBoundary:
    def __init__(self, app, origins):
        self.app = app
        self.origins = set(origins)
        self.hosts = {urlsplit(origin).netloc for origin in origins}

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        request = Request(scope)
        raw = scope['headers']
        if any(sum(k.lower() == key for k, _ in raw) > 1 for key in (b'host', b'origin', b'referer')):
            return await JSONResponse({'detail': 'Ambiguous ingress headers'}, 400)(scope, receive, send)
        origin = request.headers.get('origin')
        referer = request.headers.get('referer')
        referer_origin = None
        if referer:
            parsed = urlsplit(referer)
            referer_origin = parsed.scheme + '://' + parsed.netloc
        expected = 'https://' + request.headers.get('host', '')
        valid = expected in self.origins and request.headers.get('sec-fetch-site') not in {'cross-site'}
        valid = valid and (not origin or origin == expected) and (not referer_origin or referer_origin == expected)
        if request.method not in {'GET', 'HEAD', 'OPTIONS'}:
            valid = valid and (origin == expected or referer_origin == expected)
        if not valid:
            return await JSONResponse({'detail': 'Demo host/origin rejected'}, 403)(scope, receive, send)

        async def safe_send(message):
            if message['type'] == 'http.response.start':
                message = {**message, 'headers': [*message.get('headers', []),
                    (b'cache-control', b'no-store, no-transform'), (b'x-content-type-options', b'nosniff'),
                    (b'referrer-policy', b'same-origin')]}
            await send(message)
        await self.app(scope, receive, safe_send)
