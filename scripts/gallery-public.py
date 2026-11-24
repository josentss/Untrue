"""Run gallery-dl on approved public platforms, with a scoped HTTP guard.
No credentials, browser profiles, proxy, custom extractors or user options.
"""
import sys
from urllib.parse import urlsplit
import requests
import gallery_dl

DOMAINS = {
    "tiktok": ("tiktok.com", "tiktokv.com", "tiktokcdn.com", "tiktokcdn-us.com",
               "tiktokcdn-eu.com", "byteoversea.com", "ibytedtos.com",
               "byteimg.com", "ibyteimg.com", "muscdn.com"),
    "instagram": ("instagram.com", "cdninstagram.com", "fbcdn.net"),
    "pinterest": ("pin.it", "pinterest.com", "pinterest.es", "pinterest.co.uk",
                  "pinterest.ca", "pinterest.de", "pinterest.fr", "pinterest.com.mx",
                  "pinimg.com"),
}

if len(sys.argv) < 3 or sys.argv[1] not in DOMAINS:
    raise SystemExit(2)
domains = DOMAINS[sys.argv.pop(1)]
original_send = requests.sessions.Session.send

def guarded_send(session, request, **kwargs):
    u = urlsplit(request.url)
    host = u.hostname or ""
    if (u.scheme != "https" or u.username or u.password or u.port not in (None, 443)
            or not any(host == d or host.endswith("." + d) for d in domains)):
        raise requests.exceptions.InvalidURL("Untrue gallery destination not supported")
    # Requests invokes Session.send again for each redirect.
    return original_send(session, request, **kwargs)

requests.sessions.Session.send = guarded_send
raise SystemExit(gallery_dl.main())
