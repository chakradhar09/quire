"""The two network calls of a similarity check: Brave web search, and fetching the pages it finds.

Search results are untrusted input. A result (or a redirect from one) must never make the worker
request your own machine or network, so every hop goes through check_url first.
"""
import ipaddress
import socket
import time
from urllib.robotparser import RobotFileParser

import httpx2
import trafilatura

from text import normalize

REDIRECTS = {301, 302, 303, 307, 308}
WEB_PAGE = {"text/html", "application/xhtml+xml"}


class UnsafeUrl(Exception):
    pass


class RateLimited(Exception):
    pass


def check_url(url):
    """Raise UnsafeUrl unless url is http(s) to a host whose every address is public."""
    try:
        u = httpx2.URL(url)
    except httpx2.InvalidURL as e:
        raise UnsafeUrl(f"not a URL: {url}") from e
    if u.scheme not in ("http", "https") or not u.host:
        raise UnsafeUrl(f"only http and https pages are fetched: {url}")
    try:
        infos = socket.getaddrinfo(u.host, u.port or (443 if u.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise UnsafeUrl(f"cannot resolve {u.host}") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if getattr(ip, "ipv4_mapped", None):
            ip = ip.ipv4_mapped
        if not ip.is_global or ip.is_multicast:
            raise UnsafeUrl(f"{u.host} resolves to a non-public address ({ip})")
    # ponytail: httpx2 resolves the name again when it connects, so a host that changes its DNS
    # answer in between could slip through; pin the checked IP in a custom transport if that matters.


def extract(html):
    """(title, normalized text) of a page's main content, or None if it has none."""
    doc = trafilatura.bare_extraction(html, with_metadata=True, include_comments=False)
    if doc is None or not doc.text:
        return None
    return doc.title, normalize(doc.text)


class Fetcher:
    """Polite page fetcher: robots.txt, one request per second per host, 10 s, 5 MB, web pages only."""

    def __init__(self, client=None, min_interval=1.0, contact="", timeout=10.0, max_bytes=5 * 1024 * 1024):
        self.client = client or httpx2.Client()
        self.min_interval = min_interval
        self.timeout = timeout
        self.max_bytes = max_bytes
        self.user_agent = "Quire/0.1 (personal plagiarism self-check" + (f"; {contact})" if contact else ")")
        self.last_request = {}
        self.robots = {}

    def _request(self, url):
        """One guarded GET, no redirects followed. Returns (status, headers, body); body None if too big."""
        check_url(url)
        host = httpx2.URL(url).host
        wait = self.last_request.get(host, 0) + self.min_interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self.last_request[host] = time.monotonic()
        with self.client.stream("GET", url, headers={"user-agent": self.user_agent}, timeout=self.timeout,
                                follow_redirects=False) as r:
            if r.status_code in REDIRECTS:
                return r.status_code, r.headers, b""
            body = bytearray()
            for chunk in r.iter_bytes():
                body += chunk
                if len(body) > self.max_bytes:
                    return r.status_code, r.headers, None
            return r.status_code, r.headers, bytes(body)

    def _allowed(self, url):
        u = httpx2.URL(url)
        origin = f"{u.scheme}://{u.netloc.decode()}"
        if origin not in self.robots:
            parser = RobotFileParser()
            try:
                status, _, body = self._request(origin + "/robots.txt")
            except (httpx2.HTTPError, UnsafeUrl):
                parser.disallow_all = True
            else:  # the same rules as RobotFileParser.read(); a 5xx leaves it unread, which disallows
                if status in (401, 403):
                    parser.disallow_all = True
                elif 400 <= status < 500 or status in REDIRECTS:
                    parser.allow_all = True
                elif status == 200 and body is not None:
                    parser.parse(body.decode("utf-8", "replace").splitlines())
            self.robots[origin] = parser
        return self.robots[origin].can_fetch("Quire", url)

    def fetch(self, url):
        """(title, text) of a public web page, or None if it is not allowed, too big or not a page.
        Raises UnsafeUrl if the URL or a redirect points anywhere but the public internet."""
        for _ in range(5):
            check_url(url)  # before robots.txt, so an unsafe hop is refused loudly, not skipped as "disallowed"
            if not self._allowed(url):
                return None
            status, headers, body = self._request(url)
            if status in REDIRECTS:
                url = str(httpx2.URL(url).join(headers.get("location", "")))
                continue
            if status != 200 or body is None:
                return None
            kind = headers.get("content-type", "").split(";")[0].strip().lower()
            if kind in WEB_PAGE:
                return extract(body)
            if kind == "text/plain":
                return None, normalize(body.decode("utf-8", "replace"))
            return None
        return None  # more than 5 redirects


class BraveSearch:
    """Brave Search API: the URLs of the top results for one query."""

    API = "https://api.search.brave.com/res/v1/web/search"

    def __init__(self, key, client=None, spacing=1.1):
        if not key:
            raise RuntimeError("No Brave Search API key. Add one on Quire's Settings page.")
        self.key = key
        self.client = client or httpx2.Client(timeout=10.0)
        self.spacing = spacing  # the free plan allows one request per second
        self.last = 0.0

    def __call__(self, query):
        wait = self.last + self.spacing - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self.last = time.monotonic()
        r = self.client.get(self.API, params={"q": query, "count": 3},
                            headers={"X-Subscription-Token": self.key, "Accept": "application/json"})
        if r.status_code == 429:
            raise RateLimited("Brave rate limit, try again in a minute")
        if r.status_code in (401, 403, 422):
            raise RuntimeError("Brave Search rejected the API key. Check it on Quire's Settings page, and that its plan "
                               "is active in the Brave dashboard.")
        r.raise_for_status()
        return [hit["url"] for hit in r.json().get("web", {}).get("results", []) if hit.get("url")]
