# app.py — OSM Fixer service. Flask endpoint that repairs uploaded OpenStudio
# models with the OpenStudio SDK and returns the corrected file(s).
#
#   GET  /health   -> 200 {"ok": true, "sdk": "<version>"}
#   POST /fix      -> multipart form, one or more .osm files under any field
#                     name. Returns a single corrected .osm (one input) or a
#                     .zip of corrected models (multiple inputs). Each output
#                     keeps its original filename.
#                     The repair summary is returned in the X-OSM-Fixer-Summary
#                     response header (JSON) for the single-file case.
#
# CORS is restricted to ALLOWED_ORIGIN (the front-end site); default "*" for
# easy local testing — set it in the deploy env.

import io
import json
import os
import tempfile
import zipfile

from flask import Flask, request, Response, jsonify
from flask_cors import CORS

import openstudio
from repair import repair_osm

app = Flask(__name__)
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
CORS(app, resources={r"/*": {"origins": ALLOWED_ORIGIN}})

MAX_FILES = 20


@app.get("/health")
def health():
    return jsonify(ok=True, sdk=openstudio.openStudioVersion())


@app.post("/fix")
def fix():
    files = [f for f in request.files.values() if f.filename]
    if not files:
        return jsonify(error="No files uploaded. Attach one or more .osm files."), 400
    if len(files) > MAX_FILES:
        return jsonify(error="Too many files (max %d)." % MAX_FILES), 400
    for f in files:
        if not f.filename.lower().endswith(".osm"):
            return jsonify(error="Only .osm files are accepted (%s)." % f.filename), 400

    results = []
    with tempfile.TemporaryDirectory() as tmp:
        for f in files:
            base = os.path.basename(f.filename)
            in_path = os.path.join(tmp, "in_" + base)
            out_path = os.path.join(tmp, base)
            f.save(in_path)
            try:
                summary = repair_osm(in_path, out_path)
            except Exception as e:  # noqa: BLE001 - report any repair failure cleanly
                return jsonify(error="Repair failed for %s: %s" % (base, str(e))), 422
            with open(out_path, "rb") as fh:
                data = fh.read()
            results.append((base, data, summary))

        if len(results) == 1:
            base, data, summary = results[0]
            return Response(
                data,
                mimetype="application/octet-stream",
                headers={
                    "Content-Disposition": 'attachment; filename="%s"' % base,
                    "X-OSM-Fixer-Summary": json.dumps(summary),
                },
            )

        # multiple -> zip
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            manifest = {}
            for base, data, summary in results:
                z.writestr(base, data)
                manifest[base] = summary
            z.writestr("repair_summary.json", json.dumps(manifest, indent=2))
        buf.seek(0)
        return Response(
            buf.read(),
            mimetype="application/zip",
            headers={"Content-Disposition": 'attachment; filename="fixed_models.zip"'},
        )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
