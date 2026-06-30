"""Flask endpoint for the EnergyPlus runner.

    GET  /health   -> 200 "ok"
    POST /run-osm  -> multipart upload of one .osm; runs EnergyPlus and returns
                      JSON in the Audit Template Builder front end's data shape.

CORS is restricted to the front-end origin via the ALLOWED_ORIGIN env var
(comma-separated list, or "*" to allow any). Set it to the Netlify site URL.
"""

import os
import tempfile

from flask import Flask, jsonify, request
from flask_cors import CORS

import repair_and_run

app = Flask(__name__)

_origins_env = os.environ.get("ALLOWED_ORIGIN", "*")
_origins = "*" if _origins_env.strip() == "*" else [
    o.strip() for o in _origins_env.split(",") if o.strip()
]
CORS(app, resources={r"/run-osm": {"origins": _origins}})

# Reject oversized uploads early (a large .osm is a few MB; 64 MB is generous).
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024


@app.get("/health")
def health():
    return "ok", 200


@app.post("/run-osm")
def run_osm():
    f = request.files.get("file")
    if f is None or not f.filename:
        return jsonify(error="no file uploaded (expected multipart field 'file')"), 400
    if not f.filename.lower().endswith(".osm"):
        return jsonify(error="expected an OpenStudio .osm file"), 400

    with tempfile.TemporaryDirectory() as workdir:
        osm_path = os.path.join(workdir, "model.osm")
        f.save(osm_path)
        try:
            results, _htm, notes = repair_and_run.run(osm_path, workdir=workdir)
        except Exception as exc:  # surface a readable message to the browser
            return jsonify(error=str(exc)), 500
        results["_notes"] = notes
        return jsonify(results), 200


if __name__ == "__main__":
    # Local dev only; production uses gunicorn (see Dockerfile).
    app.run(host="0.0.0.0", port=8080)
