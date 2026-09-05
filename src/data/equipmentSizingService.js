import { supabase } from '../lib/supabase'

// One call, one definition. The database does the sizing (select_equipment_for_load)
// because the same answer has to be reachable from the standalone tool and from
// the opportunity line item, and two copies of a sizing rule is how two screens
// come to disagree about whether a heat pump heats a building.
//
// Everything here is a NUMBER. Nothing reads an assessment, a property or an
// opportunity — that is what keeps the standalone tool honest, and it is the
// test for whether the two workflows have been mixed.
export async function sizeEquipmentForLoad({
  heatingLoadBtuh,
  coolingLoadBtuh,
  winterDesignTempF,
  ducting = null,
  measureProductId = null,
  coolingMinPct = 90,
  coolingMaxPct = 115,
  limit = 25,
}) {
  const { data, error } = await supabase.rpc('select_equipment_for_load', {
    p_design_heating_load_btuh: heatingLoadBtuh,
    p_design_cooling_load_btuh: coolingLoadBtuh,
    p_winter_design_temp_f: winterDesignTempF,
    p_ducting: ducting || null,
    p_measure_product_id: measureProductId || null,
    p_cooling_min_pct: coolingMinPct,
    p_cooling_max_pct: coolingMaxPct,
    p_limit: limit,
  })
  if (error) throw error
  return data || []
}
