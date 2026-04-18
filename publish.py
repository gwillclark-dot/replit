#!/usr/bin/env python3
"""Publish Trax status to the Replit-hosted georgeFM page.

Reads ~/Trax/{STATE.md, projects.json}, sanitizes, POSTs to $GEORGEFM_URL.

Usage:
    GEORGEFM_URL=https://your-repl.repl.co \
    GEORGEFM_TOKEN=secret \
    python3 publish.py

Designed to run from launchd every ~5 minutes.
"""
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

TRAX_DIR = Path(os.environ.get("TRAX_DIR", Path.home() / "Trax"))
STATE_FILE = TRAX_DIR / "STATE.md"
PROJECTS_FILE = TRAX_DIR / "projects.json"

URL = os.environ.get("GEORGEFM_URL", "").rstrip("/")
TOKEN = os.environ.get("GEORGEFM_TOKEN", "")

MAX_SUMMARY_CHARS = 200
MAX_RECENT = 6
MAX_UP_NEXT = 5
MAX_TRACK_RUNS = 10
MAX_NEXT_STEPS = 3
MAX_NEXT_STEP_CHARS = 140

# Drop entries that contain anything in this list (case-insensitive)
SANITIZE_BLOCKLIST = [
    "password", "api_key", "secret", "token", "ssn",
]


def parse_state(text):
    """Extract 'Last Run' headers from STATE.md into structured entries."""
    entries = []
    for match in re.finditer(
        r"##\s*Last Run.*?\n+(\d{4}-\d{2}-\d{2})\s*[—-]\s*\*\*([^*]+)\*\*[:\s]*(.+?)(?=\n##|\Z)",
        text,
        re.DOTALL,
    ):
        date, project, summary = match.groups()
        summary = " ".join(summary.split()).strip()
        if any(bad in summary.lower() for bad in SANITIZE_BLOCKLIST):
            continue
        if len(summary) > MAX_SUMMARY_CHARS:
            summary = summary[: MAX_SUMMARY_CHARS - 1].rstrip() + "…"
        entries.append({
            "project": project.strip().lower(),
            "summary": summary,
            "played_at": f"{date}T12:00:00Z",
        })
    return entries


def read_next_steps(project_dir):
    """Return the first N unchecked `- [ ]` items from <project_dir>/NEXT_STEPS.md."""
    path = TRAX_DIR / project_dir / "NEXT_STEPS.md"
    if not path.exists():
        return []
    items = []
    for line in path.read_text().splitlines():
        m = re.match(r"^\s*-\s*\[\s\]\s*(.+?)\s*$", line)
        if not m:
            continue
        text = m.group(1)
        if any(bad in text.lower() for bad in SANITIZE_BLOCKLIST):
            continue
        if len(text) > MAX_NEXT_STEP_CHARS:
            text = text[: MAX_NEXT_STEP_CHARS - 1].rstrip() + "…"
        items.append(text)
        if len(items) >= MAX_NEXT_STEPS:
            break
    return items


def build_payload():
    state_text = STATE_FILE.read_text() if STATE_FILE.exists() else ""
    projects = json.loads(PROJECTS_FILE.read_text())["projects"] if PROJECTS_FILE.exists() else {}

    # Index project metadata by name and alias
    meta_by_name = {}
    for key, p in projects.items():
        names = {key, *(p.get("aliases") or [])}
        for n in names:
            meta_by_name[n.lower()] = {
                "key": key,
                "status": p.get("status"),
                "rotation": p.get("rotation", False),
            }

    runs = parse_state(state_text)

    def lookup(project):
        p = project.lower().strip()
        candidates = [
            p,
            p.replace(" ", "_"),
            p.replace(" ", "-"),
            p.replace(" ", ""),
            p.split()[0] if p.split() else p,
            "_".join(p.split()[:2]),
            "-".join(p.split()[:2]),
        ]
        for cand in candidates:
            if cand in meta_by_name:
                return meta_by_name[cand]
        return {}

    # Now playing = most recent run
    now_playing = None
    if runs:
        head = runs[0]
        m = lookup(head["project"])
        now_playing = {
            "project": head["project"],
            "channel": m.get("key", head["project"]),
            "status": m.get("status", "active"),
            "summary": head["summary"],
            "duration_seconds": 0,
        }

    # Recently played = next N
    recent = []
    for r in runs[1 : 1 + MAX_RECENT]:
        m = lookup(r["project"])
        recent.append({
            "project": r["project"],
            "summary": r["summary"],
            "played_at": r["played_at"],
            "status": m.get("status", "active"),
        })

    # Up next = active/finishing projects in rotation, excluding now_playing
    np_key = now_playing["channel"] if now_playing else None
    up_next = []
    for key, p in projects.items():
        if key == np_key:
            continue
        if not p.get("rotation"):
            continue
        if p.get("status") not in ("active", "finishing"):
            continue
        up_next.append({
            "project": key,
            "channel": key,
            "status": p.get("status"),
        })
    up_next = up_next[:MAX_UP_NEXT]

    # Library = everything not archived
    library = [
        {"project": key, "status": p.get("status")}
        for key, p in projects.items()
        if p.get("status") != "archived"
    ]

    # Tracks = per-project rollup with all matching runs + NEXT_STEPS preview
    tracks = {}
    for key, p in projects.items():
        if p.get("status") == "archived":
            continue
        project_runs = []
        for r in runs:
            m = lookup(r["project"])
            if m.get("key") == key:
                project_runs.append({
                    "summary": r["summary"],
                    "played_at": r["played_at"],
                })
                if len(project_runs) >= MAX_TRACK_RUNS:
                    break
        tracks[key] = {
            "name": key.replace("_", " "),
            "channel": key,
            "status": p.get("status"),
            "recent_runs": project_runs,
            "next_steps_preview": read_next_steps(p.get("dir", key)),
        }

    return {
        "now_playing": now_playing,
        "up_next": up_next,
        "recently_played": recent,
        "library": library,
        "tracks": tracks,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def post(payload):
    if not URL or not TOKEN:
        print("error: GEORGEFM_URL and GEORGEFM_TOKEN must be set", file=sys.stderr)
        sys.exit(2)
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{URL}/api/status",
        data=body,
        headers={"Content-Type": "application/json", "X-Ingest-Token": TOKEN},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.status, resp.read().decode()


def main():
    payload = build_payload()
    if "--dry-run" in sys.argv:
        print(json.dumps(payload, indent=2))
        return
    status, body = post(payload)
    print(f"published: {status} {body}")


if __name__ == "__main__":
    main()
