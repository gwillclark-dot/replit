#!/usr/bin/env python3
"""Poll the Replit signal queue and drop new signals into ~/Trax/signals/inbox/.

Reads cursor from ~/Trax/signals/.cursor (ISO timestamp). GETs
$GEORGEFM_URL/api/signals?since=<cursor>, writes each new signal to
<id>.json, updates cursor to newest received_at.

Designed to run from launchd every ~60 seconds.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

URL = os.environ.get("GEORGEFM_URL", "").rstrip("/")
SIGNALS_DIR = Path(os.environ.get("TRAX_SIGNALS_DIR", Path.home() / "Trax" / "signals"))
INBOX_DIR = SIGNALS_DIR / "inbox"
CURSOR_FILE = SIGNALS_DIR / ".cursor"


def read_cursor():
    if CURSOR_FILE.exists():
        return CURSOR_FILE.read_text().strip()
    return ""


def write_cursor(value):
    CURSOR_FILE.parent.mkdir(parents=True, exist_ok=True)
    CURSOR_FILE.write_text(value)


def fetch_signals(cursor):
    query = f"?since={urllib.parse.quote(cursor)}" if cursor else ""
    req = urllib.request.Request(f"{URL}/api/signals{query}")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def main():
    if not URL:
        print("error: GEORGEFM_URL must be set", file=sys.stderr)
        sys.exit(2)
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    cursor = read_cursor()
    signals = fetch_signals(cursor)
    if not signals:
        print("no new signals")
        return
    # signals come newest-first
    newest_ts = signals[0].get("received_at", cursor)
    for sig in signals:
        sig_id = sig.get("id")
        if not sig_id:
            continue
        path = INBOX_DIR / f"{sig_id}.json"
        if path.exists():
            continue
        path.write_text(json.dumps(sig, indent=2))
    write_cursor(newest_ts)
    print(f"pulled {len(signals)} signal(s); cursor -> {newest_ts}")


if __name__ == "__main__":
    main()
