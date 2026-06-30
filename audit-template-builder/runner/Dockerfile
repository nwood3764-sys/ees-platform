# EnergyPlus runner for the Audit Template Builder.
#
# Versions are load-bearing (build spec section 2.1): OpenStudio SDK 3.11.0 is
# paired with EnergyPlus 25.2.0. A mismatched engine fatally fails the
# SDK-translated IDF. Base image Ubuntu 22.04 matches the EnergyPlus build.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Python deps (OpenStudio SDK 3.11.0, Flask, gunicorn). --break-system-packages
# is required on Ubuntu 22.04's externally-managed Python.
COPY requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /app/requirements.txt

# EnergyPlus 25.2.0 (exact release pinned to the SDK above).
RUN curl -sL https://github.com/NREL/EnergyPlus/releases/download/v25.2.0/EnergyPlus-25.2.0-cf7368216c-Linux-Ubuntu22.04-x86_64.tar.gz \
        -o /tmp/ep.tar.gz \
    && mkdir -p /opt/eplus \
    && tar xzf /tmp/ep.tar.gz -C /opt/eplus --strip-components=1 \
    && ln -s /opt/eplus/energyplus /usr/local/bin/energyplus \
    && rm /tmp/ep.tar.gz

# Weather: Milwaukee Mitchell Intl AP TMY3 (the Wauwatosa/Milwaukee models'
# target station). Fetched at build so the ~1.6 MB file isn't committed to git.
RUN mkdir -p /app/weather \
    && curl -sL "https://energyplus-weather.s3.amazonaws.com/north_and_central_america_wmo_region_4/USA/WI/USA_WI_Milwaukee-Mitchell.Intl.AP.726400_TMY3/USA_WI_Milwaukee-Mitchell.Intl.AP.726400_TMY3.epw" \
        -o /app/weather/USA_WI_Milwaukee-Mitchell.Intl.AP.726400_TMY3.epw

COPY server.py repair_and_run.py /app/
WORKDIR /app
EXPOSE 8080

# Timeout >= 120 s covers EnergyPlus warmup + the ~16 s run.
CMD ["gunicorn", "-b", "0.0.0.0:8080", "-t", "120", "--workers", "2", "server:app"]
