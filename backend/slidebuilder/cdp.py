"""Tiny websocket + Chrome DevTools protocol client (no third-party packages)."""
import base64
import json
import os
import socket
import struct
import time
import urllib.parse


class CDP:
    """Tiny websocket + DevTools protocol client (no third-party packages)."""

    def __init__(self, ws_url, timeout=180):
        u = urllib.parse.urlparse(ws_url)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = ("GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % (u.path, u.hostname, u.port, key))
        self.sock.sendall(req.encode())
        self.buf = bytearray()
        while b"\r\n\r\n" not in self.buf:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("DevTools handshake failed")
            self.buf += chunk
        head, _, rest = bytes(self.buf).partition(b"\r\n\r\n")
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise ConnectionError("DevTools refused the connection: %r" % head[:120])
        self.buf = bytearray(rest)
        self.next_id = 0

    def _exact(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(max(1 << 20, n - len(self.buf)))
            if not chunk:
                raise ConnectionError("DevTools connection closed")
            self.buf += chunk
        out = bytes(self.buf[:n])
        del self.buf[:n]
        return out

    def _send(self, op, payload):
        hdr = bytearray([0x80 | op])
        n = len(payload)
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126); hdr += struct.pack(">H", n)
        else:
            hdr.append(0x80 | 127); hdr += struct.pack(">Q", n)
        mask = os.urandom(4)
        hdr += mask
        body = bytes(b ^ mask[i & 3] for i, b in enumerate(payload))
        self.sock.sendall(bytes(hdr) + body)

    def _message(self):
        parts = []
        while True:
            h = self._exact(2)
            fin, op, ln = h[0] & 0x80, h[0] & 0x0F, h[1] & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", self._exact(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", self._exact(8))[0]
            if h[1] & 0x80:
                m = self._exact(4)
                data = bytes(b ^ m[i & 3] for i, b in enumerate(self._exact(ln)))
            else:
                data = self._exact(ln)
            if op == 0x9:
                self._send(0xA, data); continue
            if op == 0x8:
                raise ConnectionError("DevTools connection closed")
            parts.append(data)
            if fin:
                return b"".join(parts)

    def call(self, method, params=None, timeout=120, session=None):
        self.next_id += 1
        mid = self.next_id
        msg = {"id": mid, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        self.sock.settimeout(max(5, timeout))
        self._send(0x1, json.dumps(msg).encode())
        end = time.time() + timeout
        while time.time() < end:
            msg = json.loads(self._message())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError("%s: %s" % (method, msg["error"].get("message")))
                return msg.get("result", {})
        raise TimeoutError(method)

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass

