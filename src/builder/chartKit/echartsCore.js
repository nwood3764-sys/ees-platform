// =============================================================================
// src/builder/chartKit/echartsCore.js
//
// Tree-shaken ECharts assembly: only the chart types + components the LEAP
// dashboard widgets use are registered, keeping the vendor-echarts chunk lean
// (~100KB gz vs ~330KB for the full build). This module is loaded ONLY via the
// dynamic import in EChartsLazy.jsx — never import it statically from app code,
// or ECharts lands in the entry bundle.
//
// New widget types that need more chart kinds (heatmap, treemap, scatter, …)
// register them here — one line — and every consumer picks them up.
// =============================================================================

import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart, FunnelChart, GaugeChart } from 'echarts/charts'
import {
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  MarkLineComponent, DataZoomComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { LEAP_ECHARTS_THEME } from './leapEchartsTheme'

echarts.use([
  BarChart, LineChart, PieChart, FunnelChart, GaugeChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  MarkLineComponent, DataZoomComponent,
  CanvasRenderer,
])

echarts.registerTheme('leap', LEAP_ECHARTS_THEME)

export default echarts
