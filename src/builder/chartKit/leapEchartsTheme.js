// =============================================================================
// src/builder/chartKit/leapEchartsTheme.js
//
// The LEAP ECharts theme — the design system expressed as ECharts' JSON theme
// shape and registered once as 'leap' (see echartsCore.js). Every dashboard
// chart inherits it, so palette/typography polish is bought exactly once.
// Series colors come from CHART_COLORS (no red/orange, per the design system);
// grid/axes stay recessive; all text wears the text tokens, never series color.
// =============================================================================

import { C, CHART_COLORS } from '../../data/constants'

const AXIS_LABEL = { color: C.textSecondary, fontSize: 11 }

export const LEAP_ECHARTS_THEME = {
  color: CHART_COLORS,
  textStyle: { fontFamily: "'Inter', system-ui, sans-serif", color: C.textSecondary },

  categoryAxis: {
    axisLine: { lineStyle: { color: C.border } },
    axisTick: { show: false },
    axisLabel: AXIS_LABEL,
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { ...AXIS_LABEL, color: C.textMuted },
    splitLine: { lineStyle: { color: '#f0f3f8' } },
  },

  legend: {
    textStyle: { color: C.textSecondary, fontSize: 11 },
    icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 14,
  },

  tooltip: {
    backgroundColor: '#ffffff',
    borderColor: C.border,
    borderWidth: 1,
    padding: [7, 10],
    textStyle: { color: C.textPrimary, fontSize: 12 },
    extraCssText: 'box-shadow: 0 4px 12px rgba(13,26,46,0.10); border-radius: 6px;',
  },
}

// Shared tooltip base for per-widget options (theme covers style; options add
// trigger/formatter). Kept here so every widget composes the same hover layer.
export const TOOLTIP_ITEM = { trigger: 'item', confine: true }
export const TOOLTIP_AXIS = {
  trigger: 'axis', confine: true,
  axisPointer: { type: 'line', lineStyle: { color: C.borderDark } },
}
