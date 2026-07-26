// =============================================================================
// src/builder/chartKit/EChartsLazy.jsx
//
// Lazy-loaded ECharts surface, mirroring the RechartsLazy pattern: the
// tree-shaken echartsCore module (own vendor-echarts chunk, no React deps →
// pure leaf, no TDZ cycle risk) is fetched once via a shared dynamic import.
//
// <LeapEChart option={...} onSeriesClick={...} /> owns the whole chart
// lifecycle: init with the 'leap' theme, setOption on change, resize via
// ResizeObserver (charts genuinely fill their grid tile — no fixed heights),
// click events for drill-through, dispose on unmount. While the chunk loads it
// renders an empty div; the chart appears when the module arrives.
// =============================================================================

import { useRef, useEffect, useState } from 'react'

const echartsPromise = import('./echartsCore')
let _echarts = null

export function LeapEChart({ option, onSeriesClick, minHeight = 200, style }) {
  const divRef   = useRef(null)
  const chartRef = useRef(null)
  const clickRef = useRef(onSeriesClick)
  clickRef.current = onSeriesClick
  const [lib, setLib] = useState(_echarts)

  useEffect(() => {
    if (_echarts) return
    let cancelled = false
    echartsPromise.then(m => {
      _echarts = m.default
      if (!cancelled) setLib(m.default)
    })
    return () => { cancelled = true }
  }, [])

  // Chart lifecycle: init once per mounted div, resize with the tile, dispose.
  useEffect(() => {
    if (!lib || !divRef.current) return
    const chart = lib.init(divRef.current, 'leap')
    chartRef.current = chart
    chart.on('click', (params) => clickRef.current?.(params))
    const ro = new ResizeObserver(() => { if (!chart.isDisposed()) chart.resize() })
    ro.observe(divRef.current)
    return () => { ro.disconnect(); chart.dispose(); chartRef.current = null }
  }, [lib])

  // Options are rebuilt by the widget renderers on every meaningful change;
  // notMerge guarantees removed series/labels don't linger.
  useEffect(() => {
    if (chartRef.current && option) chartRef.current.setOption(option, { notMerge: true })
  })

  return (
    <div ref={divRef} style={{ width: '100%', height: '100%', minHeight, ...style }} />
  )
}
