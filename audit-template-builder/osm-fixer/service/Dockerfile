# OSM Fixer service — OpenStudio SDK behind a small Flask API.
# The openstudio pip wheel bundles the SDK (no EnergyPlus needed: this service
# only repairs + translates models, it does not run simulations).
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY repair.py app.py ./

ENV PORT=8080
EXPOSE 8080
# Bind to $PORT (Render/Fly set this at runtime; falls back to 8080 locally).
# One worker keeps memory within the free tier (openstudio is heavy per worker);
# generous timeout because the first request cold-loads the SDK. Shell form so
# $PORT expands.
CMD gunicorn -b 0.0.0.0:${PORT:-8080} -w 1 -t 300 app:app
