"""Loopback-only browser boundary. No audio/model imports or side effects."""
from urllib.parse import urlsplit

LOOPBACK = {"127.0.0.1", "localhost", "::1"}
LOCAL_ORIGIN_PATTERN = r"^https?://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?$"


def trusted_request(headers, remote_address):
    if remote_address not in {"127.0.0.1", "::1", "::ffff:127.0.0.1"}:
        return False
    try:
        host = urlsplit("http://" + headers.get("host", ""))
        if host.hostname not in LOOPBACK or host.username or host.password or host.path:
            return False
        if headers.get("sec-fetch-site") not in {None, "same-origin", "same-site", "none"}:
            return False
        if "origin" in headers:
            origin = urlsplit(headers["origin"])
            if origin.scheme not in {"http", "https"} or origin.hostname not in LOOPBACK:
                return False
            if origin.username or origin.password or origin.path not in {"", "/"} or origin.query or origin.fragment:
                return False
        return True
    except ValueError:
        return False
