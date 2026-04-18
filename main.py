import json
import os
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request, abort

APP_DIR = Path(__file__).parent
DATA_FILE = APP_DIR / "data" / "status.json"
INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "")

app = Flask(__name__)


def load_status():
    if not DATA_FILE.exists():
        return {"now_playing": None, "up_next": [], "recently_played": [], "library": [], "updated_at": None}
    with DATA_FILE.open() as f:
        return json.load(f)


def save_status(payload):
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with DATA_FILE.open("w") as f:
        json.dump(payload, f, indent=2)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/track/<key>")
def track(key):
    status = load_status()
    tracks = status.get("tracks") or {}
    track_data = tracks.get(key)
    if not track_data:
        abort(404)
    return render_template("track.html", track=track_data, key=key, updated_at=status.get("updated_at"))


@app.get("/api/status")
def api_status():
    resp = jsonify(load_status())
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.post("/api/status")
def ingest_status():
    if not INGEST_TOKEN:
        abort(503, "INGEST_TOKEN not configured")
    if request.headers.get("X-Ingest-Token") != INGEST_TOKEN:
        abort(401)
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        abort(400, "expected JSON object")
    save_status(payload)
    return jsonify({"ok": True})


@app.get("/healthz")
def healthz():
    return "ok", 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)
