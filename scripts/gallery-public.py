"""Run gallery-dl on approved public platforms, with a scoped HTTP guard.
No credentials, browser profiles, proxy, custom extractors or user options.
"""
import sys
import time
from email.utils import parsedate_to_datetime
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
platform = sys.argv.pop(1)
domains = DOMAINS[platform]
original_send = requests.sessions.Session.send

def guarded_send(session, request, **kwargs):
    u = urlsplit(request.url)
    host = u.hostname or ""
    if (u.scheme != "https" or u.username or u.password or u.port not in (None, 443)
            or not any(host == d or host.endswith("." + d) for d in domains)):
        raise requests.exceptions.InvalidURL("Untrue gallery destination not supported")
    # Requests invokes Session.send again for each redirect.
    response = original_send(session, request, **kwargs)
    if response.status_code in (401, 403, 429):
        if platform == "instagram":
            retry = 0
            if response.status_code == 429:
                value = response.headers.get("Retry-After", "")
                try:
                    retry = int(value) * 1000 if value.isdigit() else max(0, int((parsedate_to_datetime(value).timestamp() - time.time()) * 1000))
                except (TypeError, ValueError, OverflowError):
                    pass
            print("UNTRUE_INSTAGRAM_HTTP_%d retry_after_ms=%d" % (response.status_code, retry), file=sys.stderr, flush=True)
        else:
            print('UNTRUE_ACCESS_RESTRICTED' if response.status_code != 429 else 'UNTRUE_RATE_LIMIT', file=sys.stderr)
        response.close()
        raise requests.exceptions.HTTPError('HTTP Error %s' % response.status_code, response=response)
    return response

requests.sessions.Session.send = guarded_send
raise SystemExit(gallery_dl.main())
