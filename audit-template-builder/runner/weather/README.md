# Weather files

This directory is intentionally empty in git. The EnergyPlus weather file
(`USA_WI_Milwaukee-Mitchell.Intl.AP.726400_TMY3.epw`, ~1.6 MB) is a third-party
asset that is **fetched at Docker build time** (see `../Dockerfile`), so it is
not committed here.

For local testing of `repair_and_run.py` outside the container, run:

```bash
./fetch_weather.sh
```

Then point the runner at it:

```bash
AUDIT_EPW="$(pwd)/USA_WI_Milwaukee-Mitchell.Intl.AP.726400_TMY3.epw" \
  python3 ../repair_and_run.py /path/to/model.osm
```

## Beyond Milwaukee

Phase 1 targets Milwaukee only (the Wauwatosa/Milwaukee models). For a wider
portfolio, key the EPW off the `.osm`'s `OS:WeatherFile` City/State (or the
Asset Score climate zone) and bundle the handful of Wisconsin stations needed.
