// Audit Template Builder — runtime configuration.
//
// Set AUDIT_RUNNER_URL to the EnergyPlus runner's base URL (the Fly.io app)
// once it is deployed, e.g. "https://ees-audit-runner.fly.dev".
//
// Leave it empty ("") to run the app with NO backend: in that mode the two
// OpenStudio slots accept only the OpenStudio Results HTML (.html/.htm). The
// .osm path requires the runner because EnergyPlus cannot run in the browser.
//
// This file is committed with an empty default and edited per-deployment, so
// the runner URL is configured without touching index.html.
window.AUDIT_RUNNER_URL = "";
