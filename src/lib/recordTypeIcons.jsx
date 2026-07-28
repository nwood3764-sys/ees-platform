// ---------------------------------------------------------------------------
// Record type icons — Salesforce-style object/record-type visual identity
// ---------------------------------------------------------------------------
// A record type's icon + color let a user tell at a glance which object and
// which record type a record is — the same way Salesforce shows a colored
// object icon in the record header, list views, and lookups.
//
// Two layers, both editable without touching this file's glyph set:
//   1. ICON_CATALOG   — the versioned glyph set (stable keys → SVG paths).
//                        This is UI chrome, kept in code like the nav icons.
//   2. per record type — an icon key + color stored on the picklist_values
//                        row (picklist_icon / picklist_color), assigned in
//                        LEAP Admin > Object Manager > Record Types.
//
// When a record type has no override, we fall back to its object's default
// (OBJECT_DEFAULT_VISUAL) and finally to a generic tag glyph — so every
// record always has a sensible badge, even before an admin assigns one.
//
// Glyphs are lucide-style single-stroke paths. Multi-subpath strings are
// split on space-before-M so each subpath renders as its own <path>.
// ---------------------------------------------------------------------------

import { C } from '../data/constants'

// ─── Curated color palette ───────────────────────────────────────────────
// Design-system rule: NO red / orange anywhere. Every swatch below is a cool
// tone or the sanctioned amber. Colors are chosen to carry a WHITE glyph with
// enough contrast (WCAG AA against #fff for a 1.8px stroke at badge sizes).
export const RECORD_TYPE_COLORS = [
  { key: 'navy',     label: 'Navy',      hex: '#1e466b' },
  { key: 'steel',    label: 'Steel',     hex: '#4a5e7a' },
  { key: 'sky',      label: 'Sky',       hex: '#2f7fd1' },
  { key: 'cyan',     label: 'Cyan',      hex: '#0e8aa8' },
  { key: 'teal',     label: 'Teal',      hex: '#0d9488' },
  { key: 'emerald',  label: 'Emerald',   hex: '#2aab72' },
  { key: 'forest',   label: 'Forest',    hex: '#1a7a4e' },
  { key: 'indigo',   label: 'Indigo',    hex: '#5b60d6' },
  { key: 'violet',   label: 'Violet',    hex: '#8b5cf6' },
  { key: 'plum',     label: 'Plum',      hex: '#8a4f9e' },
  { key: 'amber',    label: 'Amber',     hex: '#c78a2e' },
  { key: 'slate',    label: 'Slate',     hex: '#5a6b85' },
]

export const DEFAULT_RECORD_TYPE_COLOR = '#4a5e7a' // steel — neutral, on-brand

// Accepts either a palette key ('emerald') or a raw hex ('#2aab72'); returns a
// usable hex, falling back to the passed default. Keeps stored values flexible.
export function resolveColor(value, fallback = DEFAULT_RECORD_TYPE_COLOR) {
  if (!value) return fallback
  if (typeof value === 'string' && value.startsWith('#')) return value
  const match = RECORD_TYPE_COLORS.find(c => c.key === value)
  return match ? match.hex : fallback
}

// ─── Icon catalog ────────────────────────────────────────────────────────
// Grouped for the admin picker; the flat lookup is derived below. Keys are
// stable and stored in the database — renaming a key orphans assignments, so
// only ever ADD keys.
export const ICON_GROUPS = [
  {
    group: 'People & Places',
    icons: [
      { key: 'account',      label: 'Account',      path: 'M3 21h18 M5 21V7l8-4 8 4v14 M9 9h.01 M9 13h.01 M9 17h.01 M14 9h.01 M14 13h.01 M14 17h.01' },
      { key: 'contact',      label: 'Contact',      path: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M16 7a4 4 0 11-8 0 4 4 0 018 0z' },
      { key: 'users',        label: 'People',       path: 'M17 21v-2a4 4 0 00-3-3.87 M9 21v-2a4 4 0 013-3.87 M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75 M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
      { key: 'home',         label: 'Home',         path: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10' },
      { key: 'property',     label: 'Property',     path: 'M3 21h18 M3 9l9-7 9 7v12H3V9z M9 21V13h6v8' },
      { key: 'building',     label: 'Building',     path: 'M3 21h18 M5 21V7h14v14 M9 9h2 M9 13h2 M9 17h2 M13 9h2 M13 13h2 M13 17h2' },
      { key: 'building-2',   label: 'Office',       path: 'M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18 M6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2 M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2 M10 6h4 M10 10h4 M10 14h4 M10 18h4' },
      { key: 'unit',         label: 'Unit',         path: 'M3 12l9-9 9 9 M5 10v11h14V10 M10 21v-7h4v7' },
      { key: 'door',         label: 'Door',         path: 'M13 4h3a2 2 0 012 2v14 M2 20h20 M6 20V6a2 2 0 012-2h6v16 M11 12h.01' },
      { key: 'map-pin',      label: 'Location',     path: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z M15 10a3 3 0 11-6 0 3 3 0 016 0z' },
    ],
  },
  {
    group: 'Pipeline & Work',
    icons: [
      { key: 'opportunity',  label: 'Opportunity',  path: 'M3 17l6-6 4 4 7-7 M14 8h7v7' },
      { key: 'target',       label: 'Target',       path: 'M12 22a10 10 0 100-20 10 10 0 000 20z M12 18a6 6 0 100-12 6 6 0 000 12z M12 14a2 2 0 100-4 2 2 0 000 4z' },
      { key: 'project',      label: 'Project',      path: 'M9 11l3 3L22 4 M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11' },
      { key: 'clipboard',    label: 'Clipboard',    path: 'M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2 M9 2h6a1 1 0 011 1v2a1 1 0 01-1 1H9a1 1 0 01-1-1V3a1 1 0 011-1z' },
      { key: 'clipboard-check', label: 'Checklist', path: 'M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2 M9 2h6a1 1 0 011 1v2a1 1 0 01-1 1H9a1 1 0 01-1-1V3a1 1 0 011-1z M9 14l2 2 4-4' },
      { key: 'work-order',   label: 'Work Order',   path: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z' },
      { key: 'wrench',       label: 'Wrench',       path: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z' },
      { key: 'hammer',       label: 'Hammer',       path: 'M15 12l-8.5 8.5a2.12 2.12 0 01-3-3L12 9 M17.64 15L22 10.64 M20.91 11.7l-1.25-1.25a2.4 2.4 0 010-3.4l1.58-1.58a4.8 4.8 0 00-6.8 0l-.7.7a2 2 0 000 2.8l3.6 3.6a2 2 0 002.8 0z' },
      { key: 'tools',        label: 'Tools',        path: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z' },
      { key: 'ruler',        label: 'Measure',      path: 'M21.3 8.7l-6.6-6.6a1 1 0 00-1.4 0L2.1 13.3a1 1 0 000 1.4l6.6 6.6a1 1 0 001.4 0L21.3 10.1a1 1 0 000-1.4z M7.5 10.5l2 2 M11 7l2 2 M14.5 3.5l2 2 M4 14l2 2' },
      { key: 'clipboard-list', label: 'Task List',  path: 'M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2 M9 2h6a1 1 0 011 1v2a1 1 0 01-1 1H9a1 1 0 01-1-1V3a1 1 0 011-1z M8 11h8 M8 15h5' },
      { key: 'calendar',     label: 'Calendar',     path: 'M19 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2z M16 2v4 M8 2v4 M3 10h18' },
    ],
  },
  {
    group: 'Trade & Field',
    icons: [
      { key: 'bolt',         label: 'Energy',       path: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' },
      { key: 'flame',        label: 'Heating',      path: 'M12 2s5 4 5 9a5 5 0 01-10 0c0-2 1-3 1-3s0 2 2 2c0-3 2-5 2-5-.5 2 0 3 0 3s2-2 0-6z' },
      { key: 'snowflake',    label: 'Cooling',      path: 'M12 2v20 M2 12h20 M5 5l14 14 M19 5L5 19 M12 6l-2-2 2-2 2 2-2 2 M12 22l-2-2 2-2 2 2-2 2' },
      { key: 'thermometer',  label: 'Temperature',  path: 'M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z' },
      { key: 'droplet',      label: 'Water',        path: 'M12 2.7l5.66 5.66a8 8 0 11-11.31 0z' },
      { key: 'wind',         label: 'Air',          path: 'M9.6 4.6A2 2 0 1111 8H2 M12.6 19.4A2 2 0 1014 16H2 M17.7 7.5A2.5 2.5 0 1119.5 12H2' },
      { key: 'leaf',         label: 'Efficiency',   path: 'M11 20A7 7 0 019.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z M2 21c0-3 1.85-5.36 5.08-6' },
      { key: 'plug',         label: 'Electrical',   path: 'M9 2v6 M15 2v6 M6 8h12v3a6 6 0 01-12 0V8z M12 17v5' },
      { key: 'gauge',        label: 'Gauge',        path: 'M12 22a10 10 0 100-20 10 10 0 000 20z M12 12l4-4 M8 12h.01 M12 8v.01 M16 12h.01' },
      { key: 'key',          label: 'Key / Access', path: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4' },
      { key: 'camera',       label: 'Photo',        path: 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z M12 17a4 4 0 100-8 4 4 0 000 8z' },
      { key: 'truck',        label: 'Vehicle',      path: 'M1 3h15v13H1z M16 8h4l3 3v5h-7V8z M5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z M18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z' },
    ],
  },
  {
    group: 'Financial & Documents',
    icons: [
      { key: 'dollar',       label: 'Dollar',       path: 'M12 1v22 M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6' },
      { key: 'incentive',    label: 'Incentive',    path: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
      { key: 'file',         label: 'Document',     path: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8' },
      { key: 'file-check',   label: 'Approved Doc', path: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M9 15l2 2 4-4' },
      { key: 'invoice',      label: 'Invoice',      path: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M13 17H8 M12 9.5c-.83 0-1.5.5-1.5 1.1s.67 1.1 1.5 1.1 1.5.5 1.5 1.1-.67 1.1-1.5 1.1' },
      { key: 'envelope',     label: 'Envelope',     path: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M22 6l-10 7L2 6' },
      { key: 'signature',    label: 'Signature',    path: 'M3 17s2-6 5-6 3 4 5 4 3-4 5-4 3 2 3 2 M3 21h18' },
      { key: 'briefcase',    label: 'Briefcase',    path: 'M20 7h-4V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2' },
      { key: 'folder',       label: 'Folder',       path: 'M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z' },
      { key: 'box',          label: 'Product',      path: 'M16.5 9.4l-9-5.19 M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12' },
    ],
  },
  {
    group: 'Status & Symbols',
    icons: [
      { key: 'tag',          label: 'Tag',          path: 'M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z M7 7h.01' },
      { key: 'star',         label: 'Star',         path: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' },
      { key: 'flag',         label: 'Flag',         path: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7' },
      { key: 'shield',       label: 'Shield',       path: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
      { key: 'shield-check', label: 'Verified',     path: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4' },
      { key: 'award',        label: 'Award',        path: 'M12 15a7 7 0 100-14 7 7 0 000 14z M8.21 13.89L7 23l5-3 5 3-1.21-9.12' },
      { key: 'check-circle', label: 'Complete',     path: 'M22 11.08V12a10 10 0 11-5.93-9.14 M22 4L12 14.01l-3-3' },
      { key: 'layers',       label: 'Layers',       path: 'M12 2l10 5-10 5-10-5 10-5z M2 17l10 5 10-5 M2 12l10 5 10-5' },
      { key: 'grid',         label: 'Grid',         path: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z' },
      { key: 'bookmark',     label: 'Bookmark',     path: 'M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z' },
      { key: 'cog',          label: 'Config',       path: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z' },
    ],
  },
]

// Flat key → { label, path } lookup, derived from the groups.
export const ICON_CATALOG = ICON_GROUPS.reduce((acc, g) => {
  for (const ic of g.icons) acc[ic.key] = ic
  return acc
}, {})

// ─── Object default visuals ──────────────────────────────────────────────
// When a record type carries no icon/color override, the badge falls back to
// its object's default. Keyed by table name so RecordDetail (which knows the
// table) can resolve without extra config. Add a row here when a new object
// gains record types; a missing entry falls back to GENERIC_VISUAL.
export const OBJECT_DEFAULT_VISUAL = {
  accounts:               { icon: 'account',         color: '#1e466b' },
  contacts:               { icon: 'contact',         color: '#2f7fd1' },
  properties:             { icon: 'property',        color: '#1a7a4e' },
  buildings:              { icon: 'building',        color: '#2aab72' },
  units:                  { icon: 'unit',            color: '#0d9488' },
  opportunities:          { icon: 'opportunity',     color: '#8b5cf6' },
  projects:               { icon: 'project',         color: '#5b60d6' },
  work_orders:            { icon: 'work-order',      color: '#c78a2e' },
  work_types:             { icon: 'wrench',          color: '#c78a2e' },
  work_steps:             { icon: 'clipboard-check', color: '#4a5e7a' },
  work_plans:             { icon: 'clipboard-list',  color: '#4a5e7a' },
  work_plan_templates:    { icon: 'clipboard-list',  color: '#5a6b85' },
  work_step_templates:    { icon: 'clipboard-check', color: '#5a6b85' },
  assessments:            { icon: 'clipboard-check', color: '#2f7fd1' },
  enrollments:            { icon: 'users',           color: '#1e466b' },
  incentive_applications: { icon: 'incentive',       color: '#2aab72' },
  incentives:             { icon: 'dollar',          color: '#1a7a4e' },
  diagnostic_tests:       { icon: 'gauge',           color: '#0e8aa8' },
  mechanical_equipment:   { icon: 'cog',             color: '#4a5e7a' },
  equipment:              { icon: 'wrench',          color: '#4a5e7a' },
  equipment_activities:   { icon: 'tools',           color: '#5a6b85' },
  vehicles:               { icon: 'truck',           color: '#1e466b' },
  vehicle_activities:     { icon: 'truck',           color: '#5a6b85' },
  products:               { icon: 'box',             color: '#8a4f9e' },
  time_sheets:            { icon: 'calendar',        color: '#4a5e7a' },
  time_sheet_entries:     { icon: 'calendar',        color: '#5a6b85' },
  document_templates:     { icon: 'file',            color: '#4a5e7a' },
  email_templates:        { icon: 'envelope',        color: '#2f7fd1' },
  envelopes:              { icon: 'signature',       color: '#8b5cf6' },
  efr_reports:            { icon: 'file-check',      color: '#1a7a4e' },
  occurrences:            { icon: 'calendar',        color: '#5a6b85' },
  gps_points:             { icon: 'map-pin',         color: '#2f7fd1' },
  portal_users:           { icon: 'contact',         color: '#8b5cf6' },
  project_report_templates: { icon: 'file',          color: '#5a6b85' },
}

export const GENERIC_VISUAL = { icon: 'tag', color: DEFAULT_RECORD_TYPE_COLOR }

// ─── Resolution ──────────────────────────────────────────────────────────
// Resolve the icon key + hex color for a record. Precedence:
//   1. record type override (rtMeta.icon / rtMeta.color, from picklist_values)
//   2. object default (OBJECT_DEFAULT_VISUAL[tableName])
//   3. generic fallback
// `rtMeta` is the entry from picklists.metaById.get(recordTypeId) — an object
// { icon, color, label } — or null when the record has no record type.
export function resolveRecordVisual(tableName, rtMeta) {
  const objDefault = OBJECT_DEFAULT_VISUAL[tableName] || GENERIC_VISUAL
  const iconKey = (rtMeta && rtMeta.icon) || objDefault.icon || GENERIC_VISUAL.icon
  const color = resolveColor(rtMeta && rtMeta.color, objDefault.color || GENERIC_VISUAL.color)
  return { iconKey, color }
}

// ─── Custom upload refs ──────────────────────────────────────────────────
// A record type's icon is either a built-in catalog key ('home') or a custom
// upload reference of the form `upload:<mode>:<publicUrl>`, where mode is
// 'mono' (recolored white to match the badge) or 'color' (rendered as-is).
// parseIconRef normalizes either form so renderers can branch cleanly.
export function parseIconRef(iconRef) {
  if (typeof iconRef === 'string' && iconRef.startsWith('upload:')) {
    // upload:<mode>:<url> — the URL itself may contain colons (https://…),
    // so only split off the first two segments.
    const firstColon = iconRef.indexOf(':')
    const secondColon = iconRef.indexOf(':', firstColon + 1)
    if (secondColon > firstColon) {
      const mode = iconRef.slice(firstColon + 1, secondColon)
      const url = iconRef.slice(secondColon + 1)
      if (url) return { kind: 'upload', mode: mode === 'color' ? 'color' : 'mono', url }
    }
  }
  return { kind: 'builtin', key: iconRef || null }
}

// Build the stored ref from an uploaded URL + chosen render mode.
export function buildUploadIconRef(url, mode = 'mono') {
  return `upload:${mode === 'color' ? 'color' : 'mono'}:${url}`
}

export function isUploadIcon(iconRef) {
  return parseIconRef(iconRef).kind === 'upload'
}

// ─── Renderers ───────────────────────────────────────────────────────────

// Bare glyph — an <svg> that inherits stroke color. Used inside the badge and
// wherever a monochrome icon is wanted.
export function RecordTypeGlyph({ iconKey, size = 16, color = 'currentColor', strokeWidth = 1.8 }) {
  const entry = ICON_CATALOG[iconKey] || ICON_CATALOG[GENERIC_VISUAL.icon]
  const parts = entry.path.split(/\s(?=M)/)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      {parts.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}

// Salesforce-style badge — a colored rounded square with a white glyph.
// `iconKey` + `color` typically come from resolveRecordVisual(). `size` is the
// badge edge in px; the glyph scales to ~58% of it.
export function RecordTypeIcon({
  iconKey,
  color = DEFAULT_RECORD_TYPE_COLOR,
  size = 32,
  radius,
  title,
  style,
}) {
  const hex = resolveColor(color)
  const glyph = Math.round(size * 0.58)
  const br = radius != null ? radius : Math.max(5, Math.round(size * 0.22))
  const ref = parseIconRef(iconKey)

  // Custom upload — 'color' keeps the artwork's own colors on a neutral badge;
  // 'mono' recolors it to white via CSS mask so it matches the built-in glyphs
  // inside the colored square. Both render paths refuse embedded SVG scripts.
  if (ref.kind === 'upload') {
    const imgSize = Math.round(size * 0.66)
    if (ref.mode === 'color') {
      return (
        <span
          title={title}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: size, height: size, flex: `0 0 ${size}px`,
            background: '#ffffff', border: `1px solid ${C.border}`,
            borderRadius: br, boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06)',
            overflow: 'hidden', ...style,
          }}
        >
          <img src={ref.url} alt="" width={imgSize} height={imgSize}
            style={{ objectFit: 'contain', display: 'block' }} />
        </span>
      )
    }
    // mono: white silhouette of the uploaded shape on the colored badge.
    return (
      <span
        title={title}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: size, height: size, flex: `0 0 ${size}px`,
          background: hex, borderRadius: br,
          boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.12)', ...style,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: imgSize, height: imgSize, background: '#ffffff',
            WebkitMaskImage: `url("${ref.url}")`, maskImage: `url("${ref.url}")`,
            WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center', maskPosition: 'center',
            WebkitMaskSize: 'contain', maskSize: 'contain',
          }}
        />
      </span>
    )
  }

  return (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, flex: `0 0 ${size}px`,
        background: hex,
        borderRadius: br,
        boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.12)',
        ...style,
      }}
    >
      <RecordTypeGlyph iconKey={ref.key} size={glyph} color="#ffffff" strokeWidth={2} />
    </span>
  )
}

// Convenience: resolve + render a record's badge in one call. Pass the table
// name and the record-type meta (or null). Everything else forwards to
// RecordTypeIcon.
export function RecordVisualBadge({ tableName, recordTypeMeta, ...rest }) {
  const { iconKey, color } = resolveRecordVisual(tableName, recordTypeMeta)
  return <RecordTypeIcon iconKey={iconKey} color={color} {...rest} />
}
