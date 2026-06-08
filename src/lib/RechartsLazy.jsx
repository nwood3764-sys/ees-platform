// src/lib/RechartsLazy.jsx
//
// Recharts is ~414KB raw / ~113KB gzip — the largest non-React dep in the
// bundle. To keep it out of the initial page load, it is loaded on demand
// through a single shared dynamic import and surfaced via the useRecharts()
// hook below. Vite's manualChunks config emits recharts (and its d3/victory
// deps) as a separate `vendor-recharts` chunk that browsers fetch only when
// a chart-bearing module actually mounts.
//
// IMPORTANT — why there are no per-component exports here:
// An earlier version wrapped each recharts component (Pie, Bar, Cell, XAxis,
// …) in its own React.lazy + Suspense boundary and exported them as drop-in
// replacements. That broke recharts composition: chart parents
// (PieChart/BarChart/…) introspect their children's element TYPES to compute
// geometry, and a Suspense-wrapped child has the wrapper's type, not the real
// recharts type — so charts rendered an empty <svg> with no data layers.
//
// The correct pattern is to load the whole module once and render the REAL,
// directly-composed components together:
//
//   const R = useRecharts()
//   return (
//     <R.ResponsiveContainer width="100%" height={240}>
//       <R.PieChart><R.Pie data={data} dataKey="value" .../></R.PieChart>
//     </R.ResponsiveContainer>
//   )
//
// While the chunk is still loading, useRecharts returns a proxy whose every
// property is a no-op component, so the chart subtree renders nothing until
// recharts arrives, then a re-render swaps in the real components. No guards
// or Suspense boundaries needed at the call site.

import { useState, useEffect } from 'react'

// One shared promise — recharts is fetched exactly once per page regardless
// of how many modules or chart types render.
const rechartsPromise = import('recharts')

let _rechartsModule = null

// No-op component rendered for every recharts name until the real module
// loads, so <R.X> is always a valid component.
const _Empty = () => null
const _loadingProxy = new Proxy({}, { get: () => _Empty })

export function useRecharts() {
  const [mod, setMod] = useState(_rechartsModule)
  useEffect(() => {
    if (_rechartsModule) { setMod(_rechartsModule); return }
    let cancelled = false
    rechartsPromise.then(m => {
      _rechartsModule = m
      if (!cancelled) setMod(m)
    })
    return () => { cancelled = true }
  }, [])
  return mod || _loadingProxy
}
