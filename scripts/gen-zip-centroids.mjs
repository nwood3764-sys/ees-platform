// Generates public/geo/us-zip-centroids.json — a compact map of US ZIP code
// centroids used by the Service Provider intake map (draw a service-area
// boundary → derive the ZIP codes inside it, client-side with turf).
//
// Source: the `us-zips` package (devDependency), 2020 Census-derived ZIP
// centroids. Output shape: { "<zip>": [lng, lat] } with coordinates rounded
// to 4 decimals (~11 m — far finer than ZIP-centroid-in-polygon needs).
//
//   node scripts/gen-zip-centroids.mjs
//
// The output is committed to the repo; regenerate only when the ZIP data
// changes. Not part of the build.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const zips = require('us-zips')
const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../public/geo/us-zip-centroids.json')

const r = (n) => Math.round(n * 1e4) / 1e4
const compact = {}
let n = 0
for (const [zip, c] of Object.entries(zips)) {
  if (!c || typeof c.latitude !== 'number' || typeof c.longitude !== 'number') continue
  compact[zip] = [r(c.longitude), r(c.latitude)]
  n++
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(compact))
console.log(`wrote ${n} ZIP centroids -> ${out}`)
