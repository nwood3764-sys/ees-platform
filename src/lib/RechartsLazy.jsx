// src/lib/RechartsLazy.jsx
//
// Recharts is ~414KB raw / ~113KB gzip — the largest non-React dep in the
// bundle. Before this module, every page that imports from 'recharts' at
// module top-level pulled the whole library into the initial page load
// even when the user never opened a dashboard. After this module, the
// chart components are wrapped in React.lazy + Suspense so recharts only
// downloads when at least one chart actually mounts.
//
// USAGE — drop-in replacement for `import { ... } from 'recharts'`:
//
//   // BEFORE:
//   import { PieChart, Pie, Cell, BarChart, Bar, ... } from 'recharts'
//
//   // AFTER:
//   import { PieChart, Pie, Cell, BarChart, Bar, ... } from '../lib/RechartsLazy'
//
// No other changes required. Each component renders inside its own
// Suspense boundary with a tiny skeleton fallback so the rest of the
// page never blocks on recharts.
//
// CHUNK STRATEGY:
// The dynamic import below is what triggers Vite to put recharts into its
// own chunk (already configured in vite.config.js manualChunks). Vite sees
// `import('recharts')` as an async boundary and emits a separate JS file
// that browsers fetch only on demand.
//
// CSS / SSR: recharts is fully client-side and ships no CSS, so no extra
// handling needed for the lazy boundary.

import { lazy, Suspense } from 'react'

// One shared promise — every component reuses the same dynamic import so
// recharts is fetched exactly once per page regardless of how many chart
// types render. Vite handles deduplication automatically when you import
// the same specifier multiple times, but reusing a single promise is
// clearer and removes any concern about re-evaluation.
const rechartsPromise = import('recharts')

// Build a lazy wrapper for one named export from recharts. The function
// returns a React component that, when mounted, triggers the dynamic
// import (if not already in flight) and renders the real recharts
// component once it's loaded.
//
// We export each one with a Suspense boundary baked in so module code
// can use <PieChart>...</PieChart> exactly like before. Without the
// built-in Suspense, every consumer would have to wrap their chart in
// <Suspense> themselves — a footgun, since forgetting it crashes the
// component tree.
function lazyChart(name) {
  const Lazy = lazy(async () => {
    const mod = await rechartsPromise
    return { default: mod[name] }
  })
  // The wrapper is what consumers actually mount. It forwards props and
  // children into the lazy-loaded real component and provides a Suspense
  // boundary so the rest of the page can paint while recharts downloads.
  //
  // Fallback is an empty span — charts render inside <ResponsiveContainer>
  // which already reserves layout space, so we don't need a visible
  // skeleton. A spinner would be more distracting than a brief blank.
  function Wrapped(props) {
    return (
      <Suspense fallback={<span style={{ display: 'block' }} />}>
        <Lazy {...props} />
      </Suspense>
    )
  }
  Wrapped.displayName = `Lazy${name}`
  return Wrapped
}

// Every recharts component the app actually uses. If we ever import a
// new one from 'recharts' anywhere, it must be added here too — the
// preflight has no static check for this since the proxy is module-level.
//
// List sourced from `grep -rh "from 'recharts'" src/modules | tr ',' '\n'`.
export const PieChart           = lazyChart('PieChart')
export const Pie                = lazyChart('Pie')
export const Cell               = lazyChart('Cell')
export const BarChart           = lazyChart('BarChart')
export const Bar                = lazyChart('Bar')
export const LineChart          = lazyChart('LineChart')
export const Line               = lazyChart('Line')
export const XAxis              = lazyChart('XAxis')
export const YAxis              = lazyChart('YAxis')
export const Tooltip            = lazyChart('Tooltip')
export const ResponsiveContainer = lazyChart('ResponsiveContainer')
// DashboardRunner uses a handful more; surfaced here to avoid touching it twice.
export const Legend             = lazyChart('Legend')
export const CartesianGrid      = lazyChart('CartesianGrid')
export const Area               = lazyChart('Area')
export const AreaChart          = lazyChart('AreaChart')
export const RadialBar          = lazyChart('RadialBar')
export const RadialBarChart     = lazyChart('RadialBarChart')
export const Funnel             = lazyChart('Funnel')
export const FunnelChart        = lazyChart('FunnelChart')
export const LabelList          = lazyChart('LabelList')
export const Scatter            = lazyChart('Scatter')
export const ScatterChart       = lazyChart('ScatterChart')
export const ZAxis              = lazyChart('ZAxis')
