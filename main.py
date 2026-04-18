import json
import os
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request, abort

try:
    from replit.object_storage import Client as _ObjectStorageClient
    from replit.object_storage.errors import ObjectNotFoundError
    _OBJECT_STORAGE_IMPORTABLE = True
except ImportError:
    _OBJECT_STORAGE_IMPORTABLE = False

APP_DIR = Path(__file__).parent
DATA_FILE = APP_DIR / "data" / "status.json"
STORAGE_KEY = "status.json"
INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "")
EMPTY_STATUS = {
    "now_playing": None,
    "up_next": [],
    "recently_played": [],
    "library": [],
    "tracks": {},
    "updated_at": None,
}

app = Flask(__name__)


def _storage_client():
    """Return a cached Object Storage client, or None if unavailable."""
    if not _OBJECT_STORAGE_IMPORTABLE:
        return None
    if not hasattr(_storage_client, "_cached"):
        try:
            _storage_client._cached = _ObjectStorageClient()
        except Exception:
            _storage_client._cached = None
    return _storage_client._cached


def load_status():
    client = _storage_client()
    if client is not None:
        try:
            return json.loads(client.download_as_text(STORAGE_KEY))
        except ObjectNotFoundError:
            return dict(EMPTY_STATUS)
        except Exception as e:
            app.logger.warning("object storage read failed: %s; falling back to file", e)
    if DATA_FILE.exists():
        with DATA_FILE.open() as f:
            return json.load(f)
    return dict(EMPTY_STATUS)


def save_status(payload):
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    text = json.dumps(payload, indent=2)
    client = _storage_client()
    if client is not None:
        try:
            client.upload_from_text(STORAGE_KEY, text)
            return
        except Exception as e:
            app.logger.warning("object storage write failed: %s; falling back to file", e)
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(text)


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
    return jsonify({"ok": True, "backend": "object_storage" if _storage_client() else "file"})


@app.get("/healthz")
def healthz():
    return "ok", 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)
