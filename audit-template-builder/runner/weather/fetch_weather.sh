#!/usr/bin/env bash
# Download the Milwaukee Mitchell Intl AP TMY3 weather file for LOCAL testing of
# repair_and_run.py. The Docker image fetches this same file at build time, so
# you only need this when running the runner outside the container.
set -euo pipefail
cd "$(dirname "$0")"
URL="https://energyplus-weather.s3.amazonaws.com/north_and_central_america_wmo_region_4/USA/WI/USA_WI_Milwaukee-Mitchell.Intl.AP.726400_TMY3/USA_WI_Milwaukee-Mitchell.Intl.AP.726400_TMY3.epw"
OUT="USA_WI_Milwaukee-Mitchell.Intl.AP.726400_TMY3.epw"
curl -sL "$URL" -o "$OUT"
echo "wrote $(pwd)/$OUT"
