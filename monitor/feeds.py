import http.client
import re
import ssl
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import urlsplit

UTC = timezone.utc
LIMIT = 1_500_000
REQUEST_TIMEOUT = 12
RETRY_BUDGET = 30
RETRY_DELAYS = (1, 2)  # Three attempts at most, including the first request.


def stamp(value):
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def date(value):
    try:
        d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        d = parsedate_to_datetime(value)
    if d.tzinfo is None:
        raise ValueError("Date needs timezone")
    return d.astimezone(UTC)


class PostText(HTMLParser):
    """Quoted posts are not the target author's own promise."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.stack = [], []

    @property
    def quote(self):
        return any(blocked for _, blocked in self.stack)

    def handle_starttag(self, tag, attrs):
        classes = dict(attrs).get("class", "") or ""
        blocked = tag in ("blockquote", "script", "style") or bool(
            set(classes.lower().split()) & {"quote", "quote-text", "quoted-tweet", "quote-tweet", "quoted-post"})
        if tag not in ("br", "img", "hr", "input", "meta", "link", "source", "wbr"):
            self.stack.append((tag, blocked))
        if tag in ("p", "br", "div") and not self.quote:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break
        if tag in ("p", "div") and not self.quote:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.quote:
            self.parts.append(data)


def parse_feed(body, now, mirror_host=""):
    if len(body) > LIMIT or b"<!DOCTYPE" in body.upper() or b"<!ENTITY" in body.upper():
        raise ValueError("Unsafe or oversized XML")
    root = ET.fromstring(body)
    local = lambda tag: tag.rsplit("}", 1)[-1]
    if local(root.tag) not in ("rss", "feed"):
        raise ValueError("Expected RSS/Atom, not an HTML challenge")
    posts = {}
    for item in root.iter():
        if local(item.tag) not in ("item", "entry"):
            continue
        fields = {local(x.tag): x.text or "" for x in item}
        for x in item:
            if local(x.tag) in ("content", "description", "summary") and len(x):
                fields[local(x.tag)] = re.sub(r"<(/?)(?:ns\d+|html|xhtml):", r"<\1",
                    (x.text or "") + "".join(ET.tostring(c, encoding="unicode") for c in x))
        links = [x.attrib.get("href") or x.text or "" for x in item
                 if local(x.tag) == "link" and x.attrib.get("rel", "alternate") == "alternate"]
        link = links[0] if links else fields.get("guid", "")
        u = urlsplit(link)
        match = re.fullmatch(r"/thsottiaux/status/(\d+)(?:/)?", u.path, re.I)
        if u.scheme != "https" or u.username or u.password or not match:
            continue
        if u.hostname not in {"x.com", "twitter.com", "fxtwitter.com", "fixupx.com", mirror_host}:
            continue
        title = fields.get("title", "")
        if re.match(r"^(RT |RT by |Retweeted)", title, re.I):
            continue
        creator = fields.get("creator", "")
        if "@" in creator and not re.search(r"@thsottiaux\b", creator, re.I):
            continue
        try:
            posted = date(fields.get("pubDate") or fields.get("published") or fields.get("updated", ""))
        except (ValueError, TypeError, OverflowError):
            continue
        if posted > now:
            continue
        parser = PostText()
        parser.feed(fields.get("description") or fields.get("content") or fields.get("summary") or title)
        text = re.sub(r"\s+", " ", "".join(parser.parts)).strip()[:12000]
        if text:
            pid = match[1]
            posts[pid] = {"id": pid, "text": text, "postedAt": stamp(posted),
                          "url": f"https://x.com/thsottiaux/status/{pid}"}
    return sorted(posts.values(), key=lambda p: (p["postedAt"], int(p["id"])))


def _known_fxtwitter_feed(url):
    try:
        u = urlsplit(url)
        return (u.scheme == "https" and u.hostname == "fxtwitter.com" and
                u.port in (None, 443) and not u.username and not u.password and
                u.path == "/thsottiaux/feed.xml")
    except (TypeError, ValueError):
        return False


def _retryable(exc, request_url):
    if isinstance(exc, urllib.error.HTTPError):
        if _access_challenge(exc):
            return False
        # This live RSS endpoint can intermittently return 404 while its user
        # timeline is still available. Do not retry other missing resources.
        if exc.code == 404:
            return _known_fxtwitter_feed(request_url) and _known_fxtwitter_feed(exc.geturl())
        return exc.code in (408, 429) or 500 <= exc.code <= 599
    if isinstance(exc, urllib.error.URLError):
        return not isinstance(exc.reason, ssl.SSLError)
    return isinstance(exc, (TimeoutError, ConnectionError, http.client.IncompleteRead,
                            http.client.RemoteDisconnected))


def _access_challenge(exc):
    headers = exc.headers or {}
    return (exc.code in (401, 403, 407, 511) or
            headers.get("cf-mitigated", "").lower() == "challenge" or
            bool(headers.get("WWW-Authenticate") or headers.get("Proxy-Authenticate")))


def _retry_after(exc):
    if not isinstance(exc, urllib.error.HTTPError) or not exc.headers:
        return 0
    value = exc.headers.get("Retry-After", "").strip()
    if re.fullmatch(r"[0-9]+", value):
        return int(value) if len(value) <= 10 else RETRY_BUDGET
    try:
        until = parsedate_to_datetime(value)
        if until.tzinfo is not None:
            return max(0, (until - datetime.now(UTC)).total_seconds())
    except (TypeError, ValueError, OverflowError):
        pass
    return 0


def _failure(exc, url, attempts):
    # Keep diagnostics structured: exception strings and URLs can contain tokens.
    try:
        host = urlsplit(url).hostname or "invalid"
    except ValueError:
        host = "invalid"
    failure = {"host": host, "reason": type(exc).__name__, "attempts": attempts}
    if isinstance(exc, urllib.error.HTTPError):
        failure["status"] = exc.code
        failure["category"] = ("access-denied" if _access_challenge(exc) else
                               "rate-limited" if exc.code == 429 else
                               "server-error" if 500 <= exc.code <= 599 else
                               "http-error")
    elif isinstance(exc, (TimeoutError, urllib.error.URLError)) and (
            isinstance(exc, TimeoutError) or isinstance(getattr(exc, "reason", None), TimeoutError)):
        failure["category"] = "timeout"
    elif isinstance(exc, urllib.error.URLError):
        failure["category"] = "tls-error" if isinstance(exc.reason, ssl.SSLError) else "network-error"
    elif isinstance(exc, (ConnectionError, http.client.IncompleteRead, http.client.RemoteDisconnected)):
        failure["category"] = "read-error"
    elif isinstance(exc, ValueError):
        failure["category"] = "invalid-feed"
    else:
        failure["category"] = "unexpected-error"
    return failure


def _read_feed(request, now, attempts):
    deadline = time.monotonic() + RETRY_BUDGET
    last_error = TimeoutError()
    for attempt in range(len(RETRY_DELAYS) + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise last_error
        attempts["count"] = attempt + 1
        try:
            with urllib.request.urlopen(request, timeout=min(REQUEST_TIMEOUT, remaining)) as response:
                if urlsplit(response.url).scheme != "https":
                    raise ValueError("Insecure redirect")
                age = int(response.headers.get("Age", "0"))
                response_date = response.headers.get("Date")
                if age > 3600 or (response_date and (now - date(response_date)).total_seconds() > 3600):
                    raise ValueError("Stale mirror response")
                return response.read(LIMIT + 1)
        except Exception as exc:
            last_error = exc
            if attempt == len(RETRY_DELAYS) or not _retryable(exc, request.full_url):
                raise
            delay = max(RETRY_DELAYS[attempt], _retry_after(exc))
            # A long Retry-After means the source is unavailable for this poll.
            if delay >= deadline - time.monotonic():
                raise
            time.sleep(delay)


def fetch_feeds(urls, now, minimum_posted_at=None):
    """Bounded failover; never bypass authentication, CAPTCHA, or access controls."""
    failures, successes = [], []
    for url in urls[:3]:
        attempts = {"count": 0}
        try:
            u = urlsplit(url)
            if u.scheme != "https" or not u.hostname or u.username or u.password:
                raise ValueError("Only public HTTPS feed URLs")
            request = urllib.request.Request(url, headers={
                "User-Agent": "TiboResetObservatory/0.1 (public RSS; 15 minute polling)",
                "Accept": "application/rss+xml, application/atom+xml, application/xml",
                "Cache-Control": "no-cache",
            })
            body = _read_feed(request, now, attempts)
            posts = parse_feed(body, now, u.hostname)
            # Empty feeds can be a broken/changed mirror. Do not mark them fresh.
            if not posts:
                raise ValueError("No recognizable target posts")
            if minimum_posted_at and date(posts[-1]["postedAt"]) < date(minimum_posted_at):
                raise ValueError("Timeline regressed behind the last successful poll")
            successes.append((posts, u.hostname))
        except Exception as exc:
            failures.append(_failure(exc, url, attempts["count"]))
    if not successes:
        raise FeedUnavailable(failures)
    merged = {}
    for posts, host in successes:
        for post in posts:
            previous = merged.get(post["id"])
            if previous and (previous["text"], previous["postedAt"]) != (post["text"], post["postedAt"]):
                raise FeedUnavailable(failures + [{"host": host, "reason": "ConflictingPost"}])
            merged[post["id"]] = post
    return sorted(merged.values(), key=lambda p: (p["postedAt"], int(p["id"]))), ", ".join(h for _, h in successes), failures


class FeedUnavailable(Exception):
    def __init__(self, failures):
        self.failures = failures
        super().__init__("All configured feeds unavailable")
