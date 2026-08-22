// Run every fixture suite in scripts/*-fixture.mjs, in name order.
//
// Discovery rather than a hardcoded list: a fixture is only worth writing if it
// actually runs, and a hand-maintained chain in package.json is exactly the
// kind of thing a new suite gets left out of. Part of `npm run build:safe`.

import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const suites = readdirSync(here)
  .filter(f => f.endsWith('-fixture.mjs'))
  .sort()

if (suites.length === 0) {
  console.error('run-fixtures: no *-fixture.mjs suites found — expected at least one')
  process.exit(1)
}

// Name the environment and the suite list up front: this runs inside the
// Netlify build, whose log is the only place a CI-only failure is visible.
console.log(`run-fixtures: node ${process.version} · ${suites.length} suites · ${suites.join(', ')}`)

let failed = 0
for (const suite of suites) {
  const result = spawnSync(process.execPath, [join(here, suite)], { stdio: 'inherit' })
  if (result.error) {
    failed += 1
    console.error(`run-fixtures: ${suite} could not be started — ${result.error.message}`)
    continue
  }
  if (result.signal) {
    failed += 1
    console.error(`run-fixtures: ${suite} was killed by ${result.signal}`)
    continue
  }
  if (result.status !== 0) {
    failed += 1
    console.error(`run-fixtures: ${suite} exited ${result.status}`)
  }
}

console.log(failed === 0
  ? `run-fixtures: ${suites.length} suites passed`
  : `run-fixtures: ${failed} of ${suites.length} suites FAILED`)
process.exit(failed === 0 ? 0 : 1)
