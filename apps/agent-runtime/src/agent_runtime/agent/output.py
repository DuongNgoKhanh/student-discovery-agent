"""Model text -> safe markdown: images, HTML and links outside the allowlist are reduced to plain text."""
import re
from collections.abc import Iterable
from urllib.parse import urlsplit

_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_AUTOLINK = re.compile(r"<(https?://[^>\s]+)>")
_HTML_TAG = re.compile(r"</?[A-Za-z!][^>\n]*>")
_LINK = re.compile(r"\[([^\]]+)\]\(\s*<?((?:[^()\s>]|\([^()\s]*\))+)>?(?:\s+\"[^\"]*\")?\s*\)")  # one paren level
_REFERENCE = re.compile(r"^[ \t>*+\-\d.)]*\[(?:\\.|[^\]\\])+\]:[^\n]*\n?", re.MULTILINE)
_BARE_URL = re.compile(r"\bhttps?://[^\s)\]>]+")
_KEPT = re.compile("\x00(\\d+)\x00")


def link_allowed(url: str, allowed_domains: Iterable[str]) -> bool:
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and any(host == domain or host.endswith("." + domain)
                                           for domain in allowed_domains)


def sanitize_markdown(text: str, allowed_domains: Iterable[str]) -> str:
    domains = tuple(allowed_domains)
    text = _IMAGE.sub(lambda m: m.group(1), text)
    text = _AUTOLINK.sub(lambda m: m.group(1), text)
    text = _HTML_TAG.sub("", text)
    text = _REFERENCE.sub("", text)  # reference-style targets are never kept; inline links cover the use
    kept: list[str] = []

    def keep_link(match: re.Match) -> str:
        label, url = match.group(1), match.group(2)
        if not link_allowed(url, domains):
            return label
        kept.append(f"[{label}]({url})")
        return f"\x00{len(kept) - 1}\x00"

    text = _LINK.sub(keep_link, text)
    text = _BARE_URL.sub(lambda m: m.group(0) if link_allowed(m.group(0), domains) else "", text)
    return _KEPT.sub(lambda m: kept[int(m.group(1))], text).strip()
