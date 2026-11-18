"""Small RESP test adapter: real Redis executes the production Lua unchanged."""
import socket
from urllib.parse import urlsplit


class RedisCommands:
    def __init__(self, url):
        parsed = urlsplit(url)
        if parsed.scheme != 'redis' or parsed.hostname not in {'localhost', '127.0.0.1'}:
            raise ValueError('Tests require a disposable loopback Redis without credentials')
        self.address = (parsed.hostname, parsed.port or 6379)

    def __call__(self, *args):
        values = [str(arg).encode() for arg in args]
        payload = b'*' + str(len(values)).encode() + b'\r\n'
        payload += b''.join(b'$' + str(len(value)).encode() + b'\r\n' + value + b'\r\n' for value in values)
        with socket.create_connection(self.address, timeout=3) as connection:
            connection.sendall(payload)
            with connection.makefile('rb') as stream:
                return self.read(stream)

    @classmethod
    def read(cls, stream):
        prefix, line = stream.read(1), stream.readline().removesuffix(b'\r\n')
        if prefix == b'-':
            raise RuntimeError(line.decode())
        if prefix == b':':
            return int(line)
        if prefix == b'+':
            return line.decode()
        if prefix == b'$':
            count = int(line)
            if count == -1:
                return None
            value = stream.read(count).decode()
            stream.read(2)
            return value
        if prefix == b'*':
            return [cls.read(stream) for _ in range(int(line))]
        raise RuntimeError('Invalid RESP response')
