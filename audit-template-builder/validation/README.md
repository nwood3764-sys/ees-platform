# BuildingSync validation

`validate_buildingsync.py` checks an Audit Template XML (produced by the front
end) against the BuildingSync 2.6.0 schema, fully offline after a one-time
schema download.

```bash
pip install lxml requests
python validate_buildingsync.py /path/to/Building_Baseline_AuditTemplate.xml
```

It caches `BuildingSync.xsd` (v2.6.0) and the gbXML 6.01 schema it imports under
`.schema-cache/` (git-ignored) and repoints the gbXML import at the local copy.

This is a schema-conformance check only. The authoritative acceptance test is
importing the XML into the DOE Audit Template under **Buildings → Import**; some
import-dialect behaviors (e.g. metered scenarios being dropped on import) are not
expressed in the XSD.
