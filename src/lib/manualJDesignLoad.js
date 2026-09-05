// Which number the equipment gets sized to — and why it is never assumed.
//
// A Manual J report prints many loads. The one that matters for equipment
// selection is "what does this building need", and in a report that models more
// than one proposed system that number is NOT the one printed on the Whole Home
// page. This module works out the candidates, states where each came from, and
// leaves the choice to a person.
//
// ─── The double count, measured on the real report ──────────────────────────
//
// 2506 Frazier Ave, Madison — a house modelled under a gas furnace AND a cold
// climate heat pump:
//
//   Whole Home, as printed                        46,735 Btu/h heating
//   Rooms, de-duplicated                          29,881 Btu/h heating
//   difference                                    16,854  = Zone 1, twice
//
// Zone 1's five rooms are assigned to both proposed systems, and the whole-home
// page sums per ASSIGNMENT. Size a heat pump to 46,735 and it is nearly twice
// the house. The cooling side of the same report does NOT diverge (12,002 both
// ways) because the furnace contributes no cooling — which is exactly why the
// check is per measure and not one comparison of one number.
//
// ─── Why the correction is a subtraction and not a re-sum ───────────────────
//
// Re-summing the rooms loses whatever the whole-home page counts that no room
// does: on this report, 1,706 Btu/h of blower heat, which is a system-level
// gain and appears in no room. The cooling roll-up from rooms is 10,296 against
// a printed 12,002, and the 1,706 is the whole difference.
//
// So the building load is the PRINTED whole-home figure with the redundant
// copies removed: for a room appearing k times, everything but its largest
// assignment is subtracted. That keeps blower heat, keeps the report's own
// arithmetic, and removes only what is genuinely counted twice. Taking the
// largest is what makes it right per measure — a room's cooling load is a
// property of the room, so an assignment of 0 (the furnace, which does not
// cool) is the redundant copy, not the real one.
//
// Pure: no DOM, no network, no clock. Pinned in
// scripts/conduit-manual-j-fixture.mjs.

import { LOAD_MEASURES } from './conduitManualJ.js'

const ZERO = () => ({ sensibleCoolingBtuh: 0, latentCoolingBtuh: 0, totalCoolingBtuh: 0, totalHeatingBtuh: 0 })

const isRoomScope = b => b.scope === 'room' || b.scope === 'unassigned_room'

/** A room's identity across systems: the same room, listed under each system. */
export function roomKey(block) {
  return `${(block.room || block.name || '').toLowerCase().trim()}|${(block.story || '').toLowerCase().trim()}`
}

function addInto(target, values, sign = 1) {
  for (const m of LOAD_MEASURES) target[m] += sign * (values && values[m] != null ? values[m] : 0)
  return target
}

/**
 * Rooms grouped by identity. A room appearing more than once is served by more
 * than one modelled system, which is what the whole-home page counts twice.
 */
export function roomAssignments(blocks) {
  const groups = new Map()
  for (const b of (blocks || [])) {
    if (!isRoomScope(b) || !b.total) continue
    const key = roomKey(b)
    if (!groups.has(key)) groups.set(key, { key, room: b.room || b.name, story: b.story || null, assignments: [] })
    groups.get(key).assignments.push({ system: b.system || null, scope: b.scope, total: b.total, floorAreaSqFt: b.geometry ? b.geometry.floorAreaSqFt : null })
  }
  return [...groups.values()]
}

/** The rooms counted more than once, with how much each duplicate contributes. */
export function duplicatedRoomAssignments(blocks) {
  return roomAssignments(blocks)
    .filter(g => g.assignments.length > 1)
    .map(g => {
      const redundant = ZERO()
      for (const m of LOAD_MEASURES) {
        const vals = g.assignments.map(a => (a.total && a.total[m] != null ? a.total[m] : 0))
        const largest = Math.max(...vals)
        // everything but the largest assignment is the redundant copy
        redundant[m] = vals.reduce((s, v) => s + v, 0) - largest
      }
      return { ...g, systems: g.assignments.map(a => a.system).filter(Boolean), redundant }
    })
}

/** Sum of every distinct room, taking each room's largest assignment per measure. */
export function distinctRoomRollup(blocks) {
  const out = ZERO()
  for (const g of roomAssignments(blocks)) {
    for (const m of LOAD_MEASURES) {
      out[m] += Math.max(...g.assignments.map(a => (a.total && a.total[m] != null ? a.total[m] : 0)))
    }
  }
  return out
}

/**
 * Every load this report could reasonably be sized to, most defensible first.
 * Each carries where it came from, so the review screen can say it out loud.
 */
export function designLoadCandidates(report) {
  const blocks = (report && report.blocks) || []
  const whole = blocks.find(b => b.scope === 'whole_home')
  const duplicates = duplicatedRoomAssignments(blocks)
  const candidates = []

  if (whole && whole.total) {
    if (duplicates.length) {
      const corrected = addInto(ZERO(), whole.total)
      for (const d of duplicates) addInto(corrected, d.redundant, -1)
      candidates.push({
        id: 'whole_building_corrected',
        label: 'Whole building',
        total: corrected,
        floorAreaSqFt: whole.geometry ? whole.geometry.floorAreaSqFt : null,
        basis:
          `The Whole Home page as printed, less the ${duplicates.length} room` +
          `${duplicates.length === 1 ? '' : 's'} it counts once per proposed system ` +
          `(${duplicates.map(d => d.room).join(', ')}).`,
        recommended: true,
      })
    }
    candidates.push({
      id: 'whole_home_as_printed',
      label: 'Whole Home, exactly as printed',
      total: whole.total,
      floorAreaSqFt: whole.geometry ? whole.geometry.floorAreaSqFt : null,
      basis: duplicates.length
        ? 'The report’s own Whole Home total. It counts every room served by more than one proposed system once per system.'
        : 'The report’s own Whole Home total.',
      overstated: duplicates.length > 0,
      recommended: !duplicates.length,
    })
  }

  const rooms = roomAssignments(blocks)
  if (rooms.length) {
    candidates.push({
      id: 'distinct_rooms',
      label: `All ${rooms.length} rooms, de-duplicated`,
      total: distinctRoomRollup(blocks),
      floorAreaSqFt: null,
      basis: 'Every distinct room added up. Excludes anything the report counts only at system level, such as blower heat.',
      recommended: !whole || !whole.total,
    })
  }

  for (const b of blocks) {
    if (b.scope !== 'system' || !b.total) continue
    candidates.push({
      id: `system:${b.name}`,
      label: b.name,
      total: b.total,
      floorAreaSqFt: b.geometry ? b.geometry.floorAreaSqFt : null,
      basis: `Only what the ${b.name} serves${b.geometry && b.geometry.floorAreaSqFt ? ` (${b.geometry.floorAreaSqFt} ft²)` : ''}.`,
      systemType: b.distribution ? b.distribution.systemType : null,
    })
  }

  return candidates
}

/** The candidate a review screen opens on. Never silently the printed one. */
export function recommendedDesignLoad(report) {
  const list = designLoadCandidates(report)
  return list.find(c => c.recommended) || list[0] || null
}

/**
 * What the report says that a person should look at before trusting it.
 * Each is a fact with its arithmetic attached, never a vague "check this".
 */
export function designLoadNotices(report) {
  const notices = []
  const blocks = (report && report.blocks) || []
  const whole = blocks.find(b => b.scope === 'whole_home')
  const duplicates = duplicatedRoomAssignments(blocks)

  if (whole && whole.total && duplicates.length) {
    for (const m of LOAD_MEASURES) {
      const redundant = duplicates.reduce((s, d) => s + d.redundant[m], 0)
      if (redundant <= 0) continue
      notices.push({
        severity: 'important',
        measure: m,
        message:
          `The Whole Home ${measureLabel(m)} of ${fmt(whole.total[m])} Btu/h counts ` +
          `${duplicates.map(d => d.room).join(', ')} once per proposed system. ` +
          `${fmt(redundant)} Btu/h of it is the same load twice; the building needs ` +
          `${fmt(whole.total[m] - redundant)} Btu/h.`,
      })
    }
  }

  const systems = blocks.filter(b => b.scope === 'system')
  if (systems.length > 1) {
    notices.push({
      severity: 'info',
      message:
        `This report models ${systems.length} proposed systems (${systems.map(s => s.name).join(', ')}). ` +
        'Each system’s load is only the part of the building it serves.',
    })
  }

  const unassigned = blocks.filter(b => b.scope === 'unassigned_room' && b.total)
  if (unassigned.length) {
    const heat = unassigned.reduce((s, b) => s + (b.total.totalHeatingBtuh || 0), 0)
    notices.push({
      severity: 'info',
      message:
        `${unassigned.length} room${unassigned.length === 1 ? ' is' : 's are'} served by no modelled system ` +
        `(${unassigned.map(b => b.name).join(', ')}), carrying ${fmt(heat)} Btu/h of heating load.`,
    })
  }

  for (const w of (report && report.warnings) || []) notices.push({ severity: 'warning', message: w })
  return notices
}

function measureLabel(m) {
  return m === 'totalHeatingBtuh' ? 'heating load'
    : m === 'totalCoolingBtuh' ? 'total cooling load'
      : m === 'sensibleCoolingBtuh' ? 'sensible cooling load'
        : 'latent cooling load'
}

function fmt(n) {
  return n == null ? '—' : Math.round(n).toLocaleString('en-US')
}

// ─── The NEEP Cold Climate Air Source Heat Pump List search ─────────────────
//
// The advanced search on ashp.neep.org asks for exactly these fields. Every one
// but the construction year is in the Manual J; the year is a fact about the
// building and comes from LEAP. Filling this in is the point of the scrape —
// the auditor should never retype a number that is already on the report.

/**
 * @param {object} report        parseConduitManualJ output
 * @param {object} [context]     what LEAP knows: { constructionYear, postalCode }
 * @param {object} [designLoad]  the chosen candidate; defaults to the recommended one
 */
export function neepSearchParameters(report, context = {}, designLoad = null) {
  const dc = (report && report.designConditions) || {}
  const chosen = designLoad || recommendedDesignLoad(report)
  const whole = ((report && report.blocks) || []).find(b => b.scope === 'whole_home')
  const address = (report && report.subject && report.subject.address) || null

  const ducted = ((report && report.blocks) || [])
    .filter(b => b.scope === 'system')
    .map(b => (b.distribution && b.distribution.distributionType) || '')
    .filter(Boolean)

  return {
    zipCode: (context.postalCode || (address && address.postalCode)) || null,
    weatherStation: dc.weatherStation || null,
    heatingDesignTempF: dc.heating ? dc.heating.outdoorDryBulbF : null,
    coolingDesignTempF: dc.cooling ? dc.cooling.outdoorDryBulbF : null,
    heatingDesignLoadBtuh: chosen ? chosen.total.totalHeatingBtuh : null,
    coolingDesignLoadBtuh: chosen ? chosen.total.totalCoolingBtuh : null,
    buildingSquareFootage:
      (chosen && chosen.floorAreaSqFt) || (whole && whole.geometry ? whole.geometry.floorAreaSqFt : null) || null,
    // Not in the Manual J. A year LEAP does not hold is left null and asked for
    // rather than guessed — NEEP uses it to bracket, and a wrong one is worse
    // than an empty one.
    homeConstructionYear: context.constructionYear != null ? context.constructionYear : null,
    ductingConfiguration: ducted.some(d => /ducted/i.test(d))
      ? 'Ducted'
      : (ducted.length ? 'Ductless' : null),
    designLoadBasis: chosen ? chosen.label : null,
    designLoadBasisId: chosen ? chosen.id : null,
  }
}

/** Which NEEP parameters are still missing, by the label a person would read. */
export function missingNeepParameters(params) {
  const REQUIRED = {
    zipCode: 'ZIP code',
    heatingDesignTempF: 'Heating design temperature',
    coolingDesignTempF: 'Cooling design temperature',
    heatingDesignLoadBtuh: 'Heating design load',
    coolingDesignLoadBtuh: 'Cooling design load',
    buildingSquareFootage: 'Building square footage',
    homeConstructionYear: 'Home construction year',
  }
  return Object.entries(REQUIRED)
    .filter(([k]) => params[k] == null || params[k] === '')
    .map(([, label]) => label)
}
