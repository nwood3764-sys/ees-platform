"""Offline BuildingSync 2.6.0 validation for the Audit Template XML the front end
generates.

Usage:
    pip install lxml requests
    python validate_buildingsync.py path/to/AuditTemplate.xml

It downloads BuildingSync.xsd v2.6.0 (and the gbXML 6.01 schema it imports) into
a local cache dir, rewrites the gbXML import to point at the local copy so lxml
can resolve it offline, then validates the supplied XML and prints any errors.

This is a structural/schema check. The real acceptance test is importing the XML
into the DOE Audit Template; some import-dialect quirks are not expressed in the
XSD (see the runner/front-end notes).
"""

import os
import sys

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".schema-cache")
BUILDINGSYNC_XSD_URL = (
    "https://github.com/BuildingSync/schema/releases/download/v2.6.0/BuildingSync.xsd"
)
GBXML_XSD_URL = "https://www.gbxml.org/schema/6.01/GreenBuildingXML_Ver6.01.xsd"
GBXML_LOCAL = "GreenBuildingXML_Ver6.01.xsd"


def _fetch(url, dest):
    import requests

    if os.path.exists(dest):
        return dest
    print(f"downloading {url}", file=sys.stderr)
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    with open(dest, "wb") as fh:
        fh.write(r.content)
    return dest


def _prepare_schema():
    os.makedirs(CACHE, exist_ok=True)
    bs = _fetch(BUILDINGSYNC_XSD_URL, os.path.join(CACHE, "BuildingSync.xsd"))
    _fetch(GBXML_XSD_URL, os.path.join(CACHE, GBXML_LOCAL))

    # Rewrite the gbXML import schemaLocation to the local copy so validation is
    # fully offline. The import line references gbXML by URL or relative path;
    # repoint any schemaLocation that mentions gbXML to our cached file.
    with open(bs, "r", encoding="utf-8") as fh:
        xsd = fh.read()
    import re

    def repl(m):
        return f'schemaLocation="{GBXML_LOCAL}"'

    xsd = re.sub(
        r'schemaLocation="[^"]*(?:gbxml|GreenBuildingXML)[^"]*"',
        repl,
        xsd,
        flags=re.IGNORECASE,
    )
    patched = os.path.join(CACHE, "BuildingSync.local.xsd")
    with open(patched, "w", encoding="utf-8") as fh:
        fh.write(xsd)
    return patched


def validate(xml_path):
    from lxml import etree

    schema_doc = etree.parse(_prepare_schema())
    schema = etree.XMLSchema(schema_doc)
    doc = etree.parse(xml_path)
    if schema.validate(doc):
        print(f"VALID: {xml_path} conforms to BuildingSync 2.6.0")
        return 0
    print(f"INVALID: {xml_path}", file=sys.stderr)
    for err in schema.error_log:
        print(f"  line {err.line}: {err.message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python validate_buildingsync.py path/to/AuditTemplate.xml", file=sys.stderr)
        sys.exit(2)
    sys.exit(validate(sys.argv[1]))
