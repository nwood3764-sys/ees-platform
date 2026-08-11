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
# Single worker, generous timeout — model repair is CPU-bound but quick.
CMD ["gunicorn", "-b", "0.0.0.0:8080", "-w", "2", "-t", "120", "app:app"]
