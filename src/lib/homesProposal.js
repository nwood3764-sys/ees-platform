// ---------------------------------------------------------------------------
// homesProposal — self-contained proposal/invoice PDF engine for the
// Wisconsin IRA Multifamily HOMES program, ported verbatim from the approved
// standalone Audit Builder (audit-template-builder/frontend/index.html).
//
// Why a standalone module instead of LEAP's shared paperworkModel renderer:
// the shared renderer is used by the project + assessment documents and carries
// an older visual, while THIS is the design Nicholas finalized for the
// enrollment proposal. Keeping it isolated means the enrollment proposal renders
// exactly the approved output with zero blast radius on the other documents.
//
// The ported functions read a handful of globals in the original app
// (`data`, `pj()`, an occUnits field, `eemState`, `setRatesForState`). Those
// globals are re-created here as module state, fed from an explicit input
// object, so the render code below is otherwise byte-for-byte the original.
//
// Inputs come from the enrollment: the two DOE Asset Score reports (baseline +
// improved) are text-extracted upstream (LEAP's pdf.js loader) and handed in as
// strings; the unit count, owner/contact fields, and primary contractor come
// from the record.
// ---------------------------------------------------------------------------

/* eslint-disable */

// The page furniture every EES / Sealed proposal shares — one definition, in
// src/lib/proposalPdfKit.js. Aliased to the names the ported render code below
// already uses, so that code stays byte-for-byte the approved original.
import {
  stateFullName, contactWithTitle, newProposalPdf,
  money as _money, qty as _qty, phone as _phone,
  stampEesFooters as _stampEesFooters, stampSealedFooters as _stampSealedFooters,
} from './proposalPdfKit.js'

// _pdfNew: the kit takes the lazily-loaded jsPDF constructor explicitly.
function _pdfNew(margin){ return newProposalPdf(_jspdf, margin); }

// ---- module state standing in for the standalone app's globals -------------
let _jspdf = null;                 // jsPDF constructor, loaded lazily
let _fields = {};                  // the PJ_* form fields, supplied by the caller
let _units = null;                 // dwelling-unit count from the enrollment
let data = { asBase: null, asImp: null };   // parsed Asset Score reports
let eemState = null;               // energy-efficiency measure list (attic drives scope)

// pj(id): the original read a trimmed <input> value; here it reads the supplied
// fields object instead.
function pj(id){ return (_fields[id] != null ? String(_fields[id]) : '').trim(); }
// setRatesForState: only fed the energy-model dollar math (audit/HEAR docs), not
// the proposal's rebate calc — a no-op here.
function setRatesForState(){}
// effectiveMeasures: the WI IRA Multifamily HOMES proposal always scopes attic
// air sealing + insulation (plus the low-flow devices the model adds), so the
// attic measure is always present. This is the only field invoiceModel reads.
function effectiveMeasures(){ return [{ title:'Attic Insulation', desc:'attic ceiling insulation and air sealing' }]; }

function _setInputs({ fields, assetScoreBaseText, assetScoreImpText, units } = {}){
  _fields = fields || {};
  _units  = (units != null && units !== '') ? parseInt(units, 10) || null : null;
  data = {
    asBase: assetScoreBaseText ? parseAssetScore(assetScoreBaseText) : null,
    asImp:  assetScoreImpText  ? parseAssetScore(assetScoreImpText)  : null,
  };
  eemState = effectiveMeasures();
}

/**
 * Compute the proposal model WITHOUT rendering — used to gate the action and to
 * report exactly which inputs are missing. Returns invoiceModel() output.
 */
export function computeHomesModel(input){ _setInputs(input); return invoiceModel(); }

/**
 * Render the proposal/invoice PDF. `contractor` selects the design: anything
 * matching "sealed" uses the green Sealed engine, otherwise the blue EES engine.
 * @returns {Promise<Blob>}
 */
export async function generateHomesProposalBlob(input){
  _setInputs(input);
  if (!_jspdf) {
    const mod = await import('jspdf');
    _jspdf = mod.jsPDF || mod.default || (mod.jspdf && mod.jspdf.jsPDF);
  }
  const kind = input && input.kind ? input.kind : 'proposal';
  const sealed = /sealed/i.test((input && input.contractor) || '');
  const tabs = Array.isArray(input && input.signatureTabs) ? input.signatureTabs : null;
  return sealed ? buildSealedPdfBlob(kind, tabs) : buildEesPdfBlob(kind, tabs);
}

/**
 * Render a HOMES document AND return its signature/date tab positions:
 * { blob, tabs }.
 *
 * Same renderer, same call, one out-parameter — never a second PDF path. Only
 * the INVOICE kinds carry an acknowledgment block (proposals deliberately do
 * not, per Nicholas), so a proposal comes back with an empty tab list and the
 * caller refuses to send it rather than placing a signature nowhere.
 */
export async function generateHomesProposalBlobWithSignatureTabs(input){
  const signatureTabs = [];
  const blob = await generateHomesProposalBlob({ ...input, signatureTabs });
  return { blob, tabs: signatureTabs };
}

// ===========================================================================
// Below this line: functions ported verbatim from the standalone Audit Builder
// (only `window.jspdf` and the occUnits field read are rewired to module state).
// ===========================================================================

// --- ported: num (index.html 455) ---
function num(re,t,d){const m=t.match(re);return m?parseFloat(m[1].replace(/,/g,'')):d;}

// --- ported: parseAssetScore (index.html 456,786) ---
function parseAssetScore(t){
  const d={};
  const bi=t.split('BUILDING INFORMATION')[1]||t;
  const lines=bi.split('\n').map(l=>l.trim()).filter(Boolean);
  // name: first line, cut at the first 2+ space gap (separates from the Building Type column).
  // The name may wrap to a 2nd line that also starts before any column text.
  let nm=lines[0].split(/\s{2,}/)[0].trim();
  if(lines[1]){
    let cont=lines[1].split(/\s{2,}/)[0].trim();
    // pdf.js may merge the Building Type value onto this line with single spaces;
    // cut it off at the known type fragments.
    cont=cont.replace(/\s*\((fewer|four|more)\b.*$/i,'').replace(/\s*floors\).*$/i,'')
             .replace(/\s*(Multi-family|Multifamily|Office|Mixed).*$/i,'').trim();
    if(cont && !/:/.test(cont) && !/^\d/.test(cont) &&
       !/^(Building Type|Milwaukee|WI |Gross|Climate|Year|Score)/i.test(cont) &&
       /Project|Baseline|Improved|HOMES/i.test(cont))
      nm+=' '+cont;
  }
  d.name=nm;
  for(let i=0;i<lines.length;i++){
    if(/,\s*[A-Z]{2}\s*\d{5}/.test(lines[i])){
      // city/state/zip: cut at first 2+ space gap or at a known label
      d.cityStateZip=lines[i].split(/\s{2,}|\s+(?:Climate|Building|Gross|Year|Score)\b/)[0].trim();
      // street: previous line, cut at the Gross Floor Area / Building Type label
      d.street=lines[i-1].split(/\s+(?:Gross Floor Area|Building Type|Climate|Building ID|Year)\b/)[0]
                         .split(/\s{2,}/)[0].trim();
      const z=d.cityStateZip.match(/(.+),\s*([A-Z]{2})\s*(\d{5})/);
      if(z){d.city=z[1].trim();d.state=z[2];d.zip=z[3];
        // Some reports print the street as "1837 Alden Road - Janesville" —
        // strip a trailing " - <city>" so the street is just the street.
        if(d.city&&d.street&&d.street.toLowerCase().endsWith((' - '+d.city).toLowerCase()))
          d.street=d.street.slice(0,-(' - '+d.city).length).trim();
      }
      break;
    }
  }
  d.gfa=num(/Gross Floor Area:\s*([\d,]+)\s*ft/,t);
  d.buildingId=(t.match(/Building ID #:\s*(\d+)/)||[])[1];
  d.climateZone=(t.match(/Climate Zone:\s*(\S+)/)||[])[1];
  d.yearBuilt=num(/Year Built:\s*(\d+)/,t);
  const sd=t.match(/Score Date:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if(sd)d.scoreDate={month:parseInt(sd[1]),day:parseInt(sd[2]),year:parseInt(sd[3])};
  const cur=t.match(/Current\s+(\d+)\s+([\d.]+)/), upg=t.match(/Upgraded\s+(\d+)\s+([\d.]+)/);
  d.euiCurrent=cur?parseInt(cur[1]):null; d.euiUpgraded=upg?parseInt(upg[1]):null;
  // Per-fuel EUI from the "Energy Use Intensity by Fuel Type" table: "Fuel [current, upgraded]"
  const gEui=t.match(/Natural Gas\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/i);
  const eEui=t.match(/Electricity\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/i);
  d.gasEuiCur =gEui?parseFloat(gEui[1]):null; d.gasEuiUpg =gEui?parseFloat(gEui[2]):null;
  d.elecEuiCur=eEui?parseFloat(eEui[1]):null; d.elecEuiUpg=eEui?parseFloat(eEui[2]):null;
  // Precision refinement: the page-1 headline prints the EUI as an INTEGER
  // (88 / 54) while the per-fuel table keeps the decimal (88.1 / 54.5). When
  // the per-fuel sum is the same number just rounded (within 1 kBtu/ft²), use
  // its precision — the EUI, target EUI, and reported savings % all follow.
  // When the two genuinely diverge (attic R-15 workaround reports — e.g.
  // per-fuel 101.05 vs headline 115), the headline stays authoritative.
  {
    const pf=(e2,g2)=>((e2!=null||g2!=null)?((e2||0)+(g2||0)):null);
    const refine=(head,sum)=>(head!=null&&sum!=null&&sum>0&&Math.abs(sum-head)<1)?+sum.toFixed(1):head;
    d.euiCurrent =refine(d.euiCurrent ,pf(d.elecEuiCur,d.gasEuiCur));
    d.euiUpgraded=refine(d.euiUpgraded,pf(d.elecEuiUpg,d.gasEuiUpg));
  }
  d.savingsPct=num(/site energy savings:\s*([\d.]+)%/,t);
  d.occupants=num(/Number of Assumed Occupants\s+(\d+)/,t);
  // Footnote-tolerant: the summary prints superscript digits ("Wall Area 1 5709.0 ft2"),
  // so require the decimal-bearing number and skip a stray footnote digit.
  d.wallArea=num(/Total Gross Above Grade Wall Area[\s\d]*?([\d,]+\.\d+)\s*ft/,t);
  d.windowArea=num(/Total Window Area[\s\d]*?([\d,]+\.\d+)\s*ft/,t);
  d.roofArea=num(/Total Gross Roof Area[\s\d]*?([\d,]+\.\d+)\s*ft/,t);
  d.roofR=num(/Roof R-Value\s+([\d.]+)/,t);
  // ALL distinct roof R-values on the report (each block prints its own roof —
  // e.g. an R-0 kneewall attic plus an R-19 main roof are two roof systems).
  d.roofRs=[...new Set([...t.matchAll(/Roof R-Value\s+([\d.]+)/g)].map(m=>parseFloat(m[1])))];
  const _rt=t.match(/Roof Type\s+([^\n]+)/); d.roofType=_rt?_rt[1].trim():null;
  // Roof name ↔ R pairs ("Roof Multifamily Units Roof ... Roof R-Value 19.0"),
  // used to split the total roof area by use type (multifamily vs common).
  d.roofPairs=[...t.matchAll(/Roof\s+([A-Za-z][\w /-]*?Roof)(?:(?!Skylight)[\s\S]){0,180}?Roof R-Value\s+([\d.]+)/g)]
    .map(m=>({name:m[1].replace(/\s+/g,' ').trim(), r:parseFloat(m[2])}));
  // Exposed knee walls (e.g. "Hallway Roof - No Insulation and Exposed Knee
  // Wall") — drives the roof measure's kneewall-insulation clause.
  d.hasKneeWall=/knee\s*wall/i.test(t);
  d.wallR=num(/Wall R-value\s+([\d.]+)/,t);
  // WWR (EES rule): use the MULTIFAMILY UNITS' window-to-wall ratio — the
  // exterior walls that matter — taking the highest multifamily block value.
  // Fallbacks: highest block value of any use type, then the building-level %.
  const _wwrPairs=[...t.matchAll(/Window-to-Wall Ratio\s+([\d.]+)/g)].map(m=>{
    const pre=t.slice(Math.max(0,m.index-2600),m.index);
    const ut=[...pre.matchAll(/Use Type:\s*([^\n]+)/g)].pop();
    return {r:parseFloat(m[1]), common:!!(ut&&/common/i.test(ut[1]))};
  });
  const _mfW=_wwrPairs.filter(x=>!x.common).map(x=>x.r);
  if(_mfW.length) d.wwr=Math.max(..._mfW);
  else if(_wwrPairs.length) d.wwr=Math.max(..._wwrPairs.map(x=>x.r));
  else { const _bwwr=t.match(/Building Window to Wall Ratio\s+([\d.]+)\s*%/i);
    d.wwr=_bwwr?parseFloat(_bwwr[1])/100:null; }
  d.infiltration=num(/air leakage rate.*?([\d.]+)\s*CFM/,t);
  d.heatCap=num(/Capacity\s+([\d.]+)\s*kBtu\/hr/,t);
  d.coolCop=num(/Efficiency\s+([\d.]+)\s*COP/,t);
  d.coolTons=num(/Capacity\s+([\d.]+)\s*tons/,t);
  // Cooling equipment's own manufacture year ("Cooling Equipment ... Year of
  // Manufacture 2020") — the year-built rule applies to baseboards/DHW only.
  d.coolYear=num(/Cooling Equipment[\s\S]{0,200}?Year of Manufacture\s+(\d{4})/,t);
  // Water-heater efficiency is printed with varying units — UEF (Uniform Energy
  // Factor), EF, Et, or COP (heat-pump). Accept them all and remember the unit
  // so the export can pick the right WaterHeaterEfficiencyType.
  {const _wh=t.match(/Water Heater Efficiency\s+([\d.]+)\s*(UEF|EF|Et|COP)?/i);
   d.whe=_wh?parseFloat(_wh[1]):null; d.wheUnit=(_wh&&_wh[2])?_wh[2].toUpperCase():null;}
  // Boiler / heating plant thermal efficiency ("Thermal Efficiency 80.0% Et").
  d.boilerEff=num(/Thermal Efficiency\s+([\d.]+)%/,t);
  // Heating system: first REAL heating source on the block pages + its fuel.
  // (A "Through The Wall AC" system reports "Heating Source No Heating"; the
  // actual heat shows on the secondary system, e.g. "Convective Baseboard: Electric".)
  const _hs=[...t.matchAll(/Heating Source\s+([^\n]+)/g)].map(m=>m[1].trim()).filter(x=>!/^No Heating/i.test(x));
  d.heatingSource=_hs[0]||null;
  if(d.heatingSource){
    const _hi=t.indexOf('Heating Source '+d.heatingSource);
    const _hf=t.slice(Math.max(0,_hi),_hi+180).match(/Fuel Type\s+([^\n]+)/);
    d.heatingFuel=_hf?_hf[1].trim():null;
  }
  // Heating plant's OWN Year of Manufacture — scoped to the real heating-source
  // block. The COOLING block prints before heating, so the first global
  // "Year of Manufacture" is the AC's; sourcing the heating year from that made
  // an electric baseboard export the AC's year (e.g. 2000 instead of 1987).
  d.boilerYear=(function(){
    if(d.heatingSource){const _hyi=t.indexOf('Heating Source '+d.heatingSource);
      if(_hyi>=0){const _m=t.slice(_hyi,_hyi+300).match(/Year of Manufacture\s+(\d{4})/);
        if(_m)return parseInt(_m[1],10);}}
    const _g=t.match(/Year of Manufacture\s+(\d{4})/); return _g?parseInt(_g[1],10):null;
  })();
  // A heat pump ALWAYS runs on electricity — treat any heat-pump source as
  // electric even when the report's Fuel Type line doesn't spell out "Electric".
  // Without this, a heat-pump building fell through the electric-heating
  // conversion below, the template's gas boiler was never removed, and no
  // <HeatPump> element was emitted (the "template leak" the auto-check flagged).
  d.heatingIsElectric=!!((d.heatingSource&&/electric|heat pump/i.test(d.heatingSource))||(d.heatingFuel&&/electric/i.test(d.heatingFuel)));
  // A heat pump is electric but must be modeled as a HEAT PUMP (COP ~2-4), never
  // as electric resistance (COP 1.0). Capture the heating COP printed in the
  // Heating Equipment block ("... Thermal Efficiency 3.80 COP").
  d.heatingIsHeatPump=!!(d.heatingSource&&/heat pump/i.test(d.heatingSource));
  if(d.heatingIsHeatPump&&d.heatingSource){
    const _hpi=t.indexOf('Heating Source '+d.heatingSource);
    const _hc=t.slice(Math.max(0,_hpi),_hpi+240).match(/Efficiency\s+([\d.]+)\s*COP/);
    d.heatCop=_hc?parseFloat(_hc[1]):null;
  }
  const _sys=t.match(/Primary Heating\/Cooling System\s+([^\n]+)/);
  d.hvacSystemLabel=_sys?_sys[1].trim():null;
  const _csrc=[...t.matchAll(/Cooling Source\s+([^\n]+)/g)].map(m=>m[1].trim()).filter(x=>!/^No Cooling/i.test(x));
  d.coolingSourceLabel=_csrc[0]||null;
  d.coolingIsWallAC=!!(d.hvacSystemLabel&&/wall ac|window ac|through the wall/i.test(d.hvacSystemLabel));
  // Service water heating fuel ("Water Heater Natural Gas", not the Efficiency line).
  const _wf=t.match(/Water Heater\s+(?!Efficiency)([A-Za-z][^\n]*)/);
  d.whFuel=_wf?_wf[1].trim():null;
  // Envelope types printed per block.
  const _wt=t.match(/Wall Type\s+([^\n]+)/); d.wallType=_wt?_wt[1].trim():null;
  const _wfr=t.match(/Window Framing Type\s+([^\n]+)/);
  // DOE accepts ONLY Vinyl / Aluminum (no|with thermal break) / Other.
  if(_wfr){const v=_wfr[1]; d.windowFrame=/vinyl/i.test(v)?'Vinyl':(/alum/i.test(v)?'Aluminum no thermal break':'Other');}
  const _wg=t.match(/Window Glass Type\s+([^\n]+)/);
  if(_wg)d.windowGlassLayers=/triple/i.test(_wg[1])?'Triple pane':(/single/i.test(_wg[1])?'Single pane':'Double pane');
  const _lt=t.match(/Lighting Type\s+([^\n]+)/); d.lightingType=_lt?_lt[1].trim():null;
  // Lighting Power Density per block, paired with the block's use type
  // (tenant = multifamily-unit blocks, common = common-area blocks).
  d.lpdPairs=[...t.matchAll(/Lighting Power Density\s+([\d.]+)\s*W/g)].map(m=>{
    const pre=t.slice(Math.max(0,m.index-2600),m.index);
    const ut=[...pre.matchAll(/Use Type:\s*([^\n]+)/g)].pop();
    return {lpd:parseFloat(m[1]), common:!!(ut&&/common/i.test(ut[1]))};
  });
  d.lpdTenant=(d.lpdPairs.find(x=>!x.common)||{}).lpd!=null?(d.lpdPairs.find(x=>!x.common)).lpd:null;
  d.lpdCommon=(d.lpdPairs.find(x=>x.common)||{}).lpd!=null?(d.lpdPairs.find(x=>x.common)).lpd:null;
  // Floor types -> which foundation kinds actually exist (prunes reference leftovers).
  d.floorTypes=[...new Set([...t.matchAll(/Floor Type\s+([^\n]+)/g)].map(m=>m[1].trim()))];
  d.foundationKinds=[...new Set(d.floorTypes.map(x=>/slab/i.test(x)?'SlabOnGrade':(/basement/i.test(x)?'Basement':(/crawl/i.test(x)?'Crawlspace':null))).filter(Boolean))];
  // Use-type square footage from the "Building Use Types" section — gives the
  // conditioned/common split the Audit Template asks for (e.g. 5,796 + 701 = GFA).
  d.useMultifamilyArea=num(/Multi-family\s*\(fewer than 4 floors\):\s*([\d,]+)\s*ft/i,t);
  d.useCommonArea=num(/Common Area:\s*([\d,]+)\s*ft/i,t);
  // Floor count from block detail ("Above Ground: 2 floors / Below Ground: 0 floors")
  d.floorsAbove=num(/Above Ground:\s*(\d+)\s*floors?/i,t);
  d.floorsBelow=num(/Below Ground:\s*(\d+)\s*floors?/i,t);
  // Measures — parse ONLY the "Selected Upgrade Opportunities" summary section.
  // In the pdf.js line layout the dagger sits on its OWN line (superscript y),
  // cost markers ("Low $$") merge inline, and long names wrap onto a
  // continuation line ending in "- Learn More". The detail section repeats each
  // bullet with prose merged inline (no delimiter), so it must NOT be parsed.
  d.measures=(function(){
    const si=t.indexOf('Selected Upgrade Opportunities');
    if(si===-1)return [];
    let region=t.slice(si);
    const endM=region.slice(30).search(/Upgrade Opportunit|Health and Safety|BUILDING CHARACTERISTICS|\f/);
    if(endM>0)region=region.slice(0,30+endM);
    const out=[]; let cur=null;
    // A bullet ends when its accumulated text contains "Learn More" — but in
    // some report layouts the link wraps ("… - Learn <cost>\n More"), so the
    // test must run on the ACCUMULATED text, and a section boundary (the next
    // system heading or a no-opportunities notice) force-closes the bullet so
    // one measure can never swallow the sections after it.
    const boundary=/^(Building Envelope|Lighting Systems|HVAC Systems|Service Hot Water Systems|Water Systems|Health and Safety|No opportunities)/i;
    for(let line of region.split('\n')){
      line=line.trim();
      if(!line||line==='†')continue;
      if(/^•/.test(line)){ if(cur)out.push(cur); cur=line.replace(/^•\s*/,''); if(/Learn\s+More/.test(cur)){out.push(cur);cur=null;} continue; }
      if(cur&&boundary.test(line)){ out.push(cur); cur=null; continue; }
      if(cur){ cur+=' '+line; if(/Learn\s+More/.test(cur)){out.push(cur);cur=null;} }
    }
    if(cur)out.push(cur);
    const clean=x=>x.replace(/-?\s*Learn(\s+More)?\b.*$/,'')
      .replace(/\s+(?:Low|Medium|High)\s+\${1,3}(?=\s|$)/g,'')
      .replace(/\s+\${1,3}(?=\s|$)/g,'')
      .replace(/†/g,'').replace(/\s+/g,' ').trim();
    return [...new Set(out.map(clean).filter(x=>x&&x.length>8&&!/No opportunities/i.test(x)))];
  })();
  return d;
}

/* ---------- OpenStudio Results parser ---------- */
function parseOpenStudio(htmlText){
  const doc=new DOMParser().parseFromString(htmlText,'text/html');
  const tables=[...doc.querySelectorAll('table')];
  function captionFor(tbl){
    let n=tbl,hops=0;
    while(n&&hops<6){n=n.previousElementSibling||n.parentElement;hops++;
      if(n&&/Consumption|Demand|Load Profiles/.test(n.textContent||''))return n.textContent;}
    return tbl.previousElementSibling?tbl.previousElementSibling.textContent:'';
  }
  function totalRow(tbl){
    for(const tr of tbl.querySelectorAll('tr')){
      const c=[...tr.querySelectorAll('th,td')].map(x=>x.textContent.trim());
      if(c[0]==='Total')return c.slice(1,13).map(v=>{v=v.replace(/,/g,'');return v&&v!=='-'?parseFloat(v):0;});
    }
    return null;
  }
  let elec=null,gas=null,name=null;
  for(const tbl of tables) for(const tr of tbl.querySelectorAll('tr')){
    const c=[...tr.querySelectorAll('th,td')].map(x=>x.textContent.trim());
    if(c[0]==='Building Name'&&c[1])name=c[1];
  }
  for(const tbl of tables){
    const hdr=[...(tbl.querySelectorAll('tr')[0]?.querySelectorAll('th,td')||[])].map(x=>x.textContent.trim());
    if(hdr.slice(1,13).join()!==MONTHS.join())continue;
    const cap=captionFor(tbl);
    if(/Electricity Consumption \(kWh\)/.test(cap))elec=totalRow(tbl);
    else if(/Natural Gas Consumption \(MBtu\)/.test(cap)){const t=totalRow(tbl);gas=t?t.map(v=>v*MMBTU_THERM):null;}
  }
  // End-use breakdown: the "EUI - Electricity" / "EUI - Gas" two-column tables.
  function toggleLabel(tbl){
    // find the nearest preceding element whose text ends with "- view table"
    let n=tbl,hops=0;
    while(n&&hops<8){n=n.previousElementSibling||n.parentElement;hops++;
      const t=(n&&n.textContent||'').replace(/\s+/g,' ');
      const m=t.match(/([A-Za-z][\w \-\/()]+?) - view table/);
      if(m)return m[1].trim();}
    return '';
  }
  function endUseMap(tbl){
    const d={};
    for(const tr of tbl.querySelectorAll('tr')){
      const c=[...tr.querySelectorAll('th,td')].map(x=>x.textContent.trim());
      if(c.length>=2&&c[0]&&c[0]!=='End Use'&&c[0]!=='Total'){
        const v=parseFloat((c[1]||'').replace(/,/g,''));
        if(!isNaN(v))d[c[0]]=v;
      }
    }
    return d;
  }
  let elecEnd={},gasEnd={};
  for(const tbl of tables){
    const lab=toggleLabel(tbl);
    if(lab==='EUI - Electricity')elecEnd=endUseMap(tbl);
    else if(lab==='EUI - Gas')gasEnd=endUseMap(tbl);
  }
  // Full monthly-by-end-use matrices (each end use × 12 months), from the
  // "Electricity Consumption (kWh)" and "Natural Gas Consumption (MBtu)" tables.
  function monthlyMatrix(tbl,scale){
    const m={};
    for(const tr of tbl.querySelectorAll('tr')){
      const c=[...tr.querySelectorAll('th,td')].map(x=>x.textContent.trim());
      const label=c[0];
      if(!label||MONTHS.includes(label)||label===''||label==='Total')continue;
      const vals=c.slice(1,13).map(v=>{v=(v||'').replace(/,/g,'');const n=parseFloat(v);return isNaN(n)?0:n*(scale||1);});
      if(vals.length===12 && vals.some(x=>x!==0))m[label]=vals;  // drop all-zero end uses
    }
    return m;
  }
  let elecMonthly={},gasMonthly={};
  for(const tbl of tables){
    const hdr=[...(tbl.querySelectorAll('tr')[0]?.querySelectorAll('th,td')||[])].map(x=>x.textContent.trim());
    if(hdr.slice(1,13).join()!==MONTHS.join())continue;
    const cap=captionFor(tbl);
    if(/Electricity Consumption \(kWh\)/.test(cap))elecMonthly=monthlyMatrix(tbl,1);
    else if(/Natural Gas Consumption \(MBtu\)/.test(cap))gasMonthly=monthlyMatrix(tbl,MMBTU_THERM);
  }
  return {elec:elec||Array(12).fill(0),gas:gas||Array(12).fill(0),name,elecEnd,gasEnd,elecMonthly,gasMonthly};
}

/* Map OpenStudio end-use categories to Audit Template end uses.
   Electricity: Heating->Space Heating, Cooling->Space Cooling,
   Interior Lighting->Lighting, Interior Equipment->Plug Loads,
   Fans+Pumps+Water Systems+Heat Rejection+others->Other.
   Gas: Water Systems->Water Distribution, Heating->Space Heating, etc. */
function auditEndUses(os){
  const e=os.elecEnd||{}, g=os.gasEnd||{};
  const eOut={'Space Heating':0,'Space Cooling':0,'Lighting':0,'Plug Loads':0,'Other':0};
  for(const [k,v] of Object.entries(e)){
    if(!v)continue;
    if(/^Heating/.test(k))eOut['Space Heating']+=v;
    else if(/^Cooling/.test(k))eOut['Space Cooling']+=v;
    else if(/Interior Lighting|^Lighting/.test(k))eOut['Lighting']+=v;
    else if(/Interior Equipment|Plug/.test(k))eOut['Plug Loads']+=v;
    else eOut['Other']+=v;   // Fans, Pumps, Water Systems, Heat Rejection, Exterior, etc.
  }
  const gOut={};
  for(const [k,v] of Object.entries(g)){
    if(!v)continue;
    if(/Water Systems|Water Heating/.test(k))gOut['Water Distribution']=(gOut['Water Distribution']||0)+v;
    else if(/^Heating/.test(k))gOut['Space Heating']=(gOut['Space Heating']||0)+v;
    else if(/^Cooling/.test(k))gOut['Space Cooling']=(gOut['Space Cooling']||0)+v;
    else gOut['Other']=(gOut['Other']||0)+v;
  }
  return {elec:eOut,gas:gOut};
}
/* Measures for export/review: the improved report's parsed list PLUS the
   roof-insulation measure derived from the two reports — when the improved
   model's weakest roof R exceeds the baseline's weakest roof R, an attic
   insulation upgrade happened even though the report can't list it (Asset
   Score only offers the upgrade below R-15, so it gets modeled directly). */
// Measures as clean {title, desc} pairs (EES naming schema):
//  - title = the plain measure name, per-block suffixes stripped
//    ("... for Block in block for Multifamily Units - East and North." -> gone)
//  - identical measures repeated per block collapse into ONE measure
//  - roof/attic measure composed from the two reports' roof R-values, covering
//    every distinct baseline roof, plus the EES kneewall spec (R-15) when the
//    baseline names an exposed knee wall.

// --- ported: BANK (index.html 3548,3558) ---
const BANK={
  atticIns:b=>i=>`Upgrade existing attic insulation from R-${b} to R-${i}. Prepare attic areas for proper airflow and insulation depth consistency, install eave baffles with 48-inch extensions in each accessible bay to maintain ventilation and allow full coverage above exterior wall top plates, and install insulation rulers on both sides of each bay to verify uniform depth. Install blown-in fiberglass to a minimum final value of R-${i} across all accessible areas, and custom build and install insulated attic access hatches with insulation damming, insulated covers, and weatherstripping to minimize thermal bypass and air leakage. All materials and methods will comply with applicable codes, manufacturer's specifications, and the program installation and materials standards.`,
  airSeal:b=>`Removal and disposal of existing attic insulation and debris to prepare the attic space for proper air sealing of accessible air leakage pathways, to include dropped soffits, open bypasses, and wall top plates, to reduce infiltration and exfiltration into conditioned space.`,
  bath:'Installation of low flow faucet aerators in tenant bathrooms for water and energy savings. Model: Niagara 0.5 GPM Aerator N3205N',
  kitchen:'Installation of low flow faucet aerators in tenant kitchens for water and energy savings. Model: Niagara 1.0 GPM Aerator N3210N',
  shower:'Installation of low flow handheld showerheads in tenant bathrooms for water and energy savings. Model: Niagara Earth Handheld Showerhead N2945CH'
};

// Building state (2-letter, uppercase) from the Asset Score address, falling
// back to the entered install/owner city·state·zip. Drives the state-specific
// incentive rules (NC vs WI) in invoiceModel(). Empty string when unknown.



// --- ported: buildingState (index.html 3559,3567) ---
function buildingState(){
  const asB=data.asBase, asI=data.asImp;
  let st=(asB&&asB.state)||(asI&&asI.state)||'';
  if(!st){const m=/,\s*([A-Za-z]{2})\s+\d{5}/.exec(pj('pjCsz')||pj('pjOwnerCsz')||'');
    if(m)st=m[1];}
  return (st||'').toUpperCase();
}
// Full state name for the EES legal entity + program labels ("Energy Efficiency
// Services of <State>", "<State> Inflation Reduction Act HOMES Program").





// --- ported: invoiceModel (index.html 3571,3645) ---
function invoiceModel(){
  const asB=data.asBase, asI=data.asImp;
  setRatesForState(buildingState());   // rates follow the building location
  const units=_units;
  // Attic sq ft: straight from the Asset Score report's roof area — the audit
  // reports are the source of record for every quantity; no manual inputs.
  const _ovr=id=>{const v=parseFloat(pj(id)); return (Number.isFinite(v)&&v>0)?v:null;};
  const roofSqFt=_ovr('pjQtyAttic')!=null?_ovr('pjQtyAttic')
    :(asB&&asB.roofArea!=null?Math.round(asB.roofArea):null);
  const _msrs=(eemState||effectiveMeasures());
  const _hasAtticMeasure=_msrs.some(m=>/roof|attic|ceiling/i.test((m.title||'')+' '+(m.desc||'')));
  const _iRaw=(asI&&asI.roofRs&&asI.roofRs.length)?Math.min(...asI.roofRs):null;
  const _bRaw=(asB&&asB.roofRs&&asB.roofRs.length)?Math.min(...asB.roofRs):null;
  // Target attic R: the improved model's value when it actually restates a
  // higher assembly; otherwise (upgrade selected via the report checkbox, block
  // page unchanged) the EES standard R-49 — but only when an attic measure
  // exists in the improved report.
  const iMin=(_iRaw!=null&&_bRaw!=null&&_iRaw>_bRaw)?_iRaw:(_hasAtticMeasure?49:(_iRaw!=null?_iRaw:49));
  const bRs=(asB&&asB.roofRs)?asB.roofRs.filter(r=>r<iMin):[];
  const baseAtticR=bRs.length?Math.min(...bRs):null;
  const fmtR=r=>(r%1?r:Math.round(r));
  const savings=(asB&&asI&&asB.euiCurrent&&asI.euiUpgraded!=null)
    ?(asB.euiCurrent-asI.euiUpgraded)/asB.euiCurrent*100:null;
  // Building state (from the Asset Score address; falls back to the entered
  // install city/state/zip) selects the incentive rules below.
  const state=buildingState();
  // HOMES rebate $/unit is STATE-SPECIFIC:
  //  · North Carolina: flat $16,000/unit at 20%+ modeled savings (no super-tier).
  //  · Wisconsin (and default): 35%+ -> $10k/unit ; 20-34% -> $5k/unit ; <20% -> none.
  const tier=savings==null?null:(state==='NC'
    ?(savings>=20?{perUnit:16000,desc:'North Carolina HOMES - modeled energy savings of 20% or greater',note:'$16,000.00 per unit'}
      :{perUnit:0,desc:'Modeled savings below 20% - not HOMES eligible',note:''})
    :(savings>=35?{perUnit:10000,desc:'IQ at <80% AMI and modeled energy savings of 35% or greater',note:'$10,000.00 per unit'}
    :savings>=20?{perUnit:5000,desc:'IQ at <80% AMI and modeled energy savings of 20-34%',note:'$5,000.00 per unit'}
    :{perUnit:0,desc:'Modeled savings below 20% — not HOMES eligible',note:''}));
  const homesAmt=(units&&tier)?units*tier.perUnit:0;
  // Focus on Energy is a WISCONSIN utility program only — there is no utility
  // rebate for out-of-state (e.g. NC) buildings, so FOE is gated on state.
  const hasAttic=_hasAtticMeasure;
  let foe=null;
  if(state==='WI'&&hasAttic&&roofSqFt&&baseAtticR!=null){
    if(baseAtticR<11)      foe={rate:1.00,desc:'Air Sealing & Attic Insulation, Existing < R-11',  note:'$1.00 per Sq. Ft.'};
    else if(baseAtticR<=19)foe={rate:0.70,desc:'Air Sealing & Attic Insulation, Existing R-12 to R-19',note:'$0.70 per Sq. Ft.'};
    else if(baseAtticR<=38)foe={rate:0.55,desc:'Insulation & Air Sealing, Existing R20-R38',       note:'$0.55 per Sq. Ft.'};
    if(foe)foe.amt=Math.round(roofSqFt*foe.rate*100)/100;
  }
  const foeAmt=foe?foe.amt:0;
  const total=Math.round((homesAmt+foeAmt)*100)/100;
  // Measure lines: breakout fractions × total, largest row absorbs the drift.
  const rows=[];
  const push=(name,frac,qty,unit,desc)=>rows.push({name,frac,qty,unit,desc,cost:Math.round(total*frac*100)/100});
  if(hasAttic){
    // Order of operations: air sealing is always measure #1, insulation #2.
    push('Attic Air Sealing',0.5483,roofSqFt,'Sq Ft',BANK.airSeal(fmtR(baseAtticR!=null?baseAtticR:0)));
    push('Attic Insulation',0.44,roofSqFt,'Sq Ft',BANK.atticIns(fmtR(baseAtticR!=null?baseAtticR:0))(fmtR(iMin)));
  }
  push('Low Flow Devices: Bath Aerators',0.0033,_ovr('pjQtyBath')!=null?_ovr('pjQtyBath'):units,'Unit',BANK.bath);
  push('Low Flow Devices: Kitchen Aerators',0.0035,_ovr('pjQtyKitchen')!=null?_ovr('pjQtyKitchen'):units,'Unit',BANK.kitchen);
  push('Low Flow Devices: Showerheads',0.0049,_ovr('pjQtyShower')!=null?_ovr('pjQtyShower'):units,'Unit',BANK.shower);
  // renormalize when attic rows are absent, then reconcile to the exact total
  const fracSum=rows.reduce((a,r)=>a+r.frac,0);
  if(Math.abs(fracSum-1)>1e-6&&fracSum>0)rows.forEach(r=>{r.cost=Math.round(total*r.frac/fracSum*100)/100;});
  const drift=Math.round((total-rows.reduce((a,r)=>a+r.cost,0))*100)/100;
  if(drift&&rows.length){let mx=0;rows.forEach((r,i)=>{if(r.cost>rows[mx].cost)mx=i;});
    rows[mx].cost=Math.round((rows[mx].cost+drift)*100)/100;}
  // North Carolina proposals & invoices break every scope line into a 50/50
  // labor/material split (NC HOMES cost-documentation requirement). When the
  // line cost is an odd number of cents the half doesn't divide evenly, so
  // LABOR carries the extra cent and MATERIAL takes the clean floored half —
  // labor + material == the line total exactly. Computed on every model
  // (cheap); only the NC documents render the two columns.
  rows.forEach(r=>{r.material=Math.floor(r.cost*50)/100; r.labor=Math.round((r.cost-r.material)*100)/100;});
  return {units,roofSqFt,baseAtticR,iMin,savings,state,tier,homesAmt,foe,foeAmt,total,rows,
    euiBase:(asB&&asB.euiCurrent!=null)?asB.euiCurrent:null,
    euiImp:(asI&&asI.euiUpgraded!=null)?asI.euiUpgraded:null,
    fields:{..._fields}};
}


/* Footer for the Sealed proposal / invoice: the document number on every page
   (so shuffled pages can be traced) plus Page X of Y. Runs after all content. */


/* ===== HEAR model + proposal ================================================
   Low-income (<=80% AMI): 100% of project cost, up to the federal per-measure
   caps and $14,000 per dwelling unit (same schedule NC & WI). */

// --- ported: buildEesPdfBlob (index.html 3806,4043) ---
function buildEesPdfBlob(kind, signatureTabs = null){                       // 'audit' | 'proposal' | 'invoice'
  const m=invoiceModel(), F=m.fields;
  const isAudit=kind==='audit', isInv=kind==='invoice';
  const P=_pdfNew(34); const {d,W,H,M,CW,C,st,font,t,wrap,need,fill,stroke,tc}=P;
  const pv=v=>(v!=null&&String(v).trim()!=='')?String(v):'\u2014';
  const GL=[203,210,219], HB=[240,243,247];           // grid line + header fill
  const AMT=W-M-6;                                    // every dollar figure shares this right edge
  /* ================= EES brand palette — a blue accent distinguishes the EES
     proposals from the green Sealed documents; body text stays black. ========= */
  const BLUE=[33,102,172];
  const NAVY=BLUE, EM=[120,130,144], EMd=BLUE, EMlt=[120,130,144],
        PANEL=[246,249,252], HAIR=[223,230,238], INKM=[96,110,128], WHITE=[255,255,255];
  const _state=stateFullName(m.state);
  /* ---- letterhead: company (left) + document title/meta (right) over a thin
     rule with a short emerald tab. A formal business header — no color band, no
     logo badge, no bubbly meta panel. ---- */
  const _dt=isAudit?'AUDIT INVOICE':(isInv?'INVOICE':'PROPOSAL');
  const docNo=isAudit?(F.pjInvNo||''):(isInv?(F.pjProjInvNo||''):'');
  const dlab=isAudit?'Multifamily Energy Assessment':(isInv?'Project Invoice':'Project Proposal');
  /* ---- party blocks: EES contractor / project / customer. Drawn as part of the
     header so the WHOLE header — not just the title — repeats on any page 2. ---- */
  // Three balanced columns matching the Sealed layout: on the generic proposal
  // EES is the Primary IRA Contractor (name + phone follow the document's state,
  // like the footer), so the contractor block is Energy Efficiency Services'.
  const cLines=['Energy Efficiency Services of '+_state,'112 Owen Rd. PO Box 6141','Monona, WI 53716',
    _phone(m.state==='NC'?'7049905614':'6084607419'),
    (F.pjSecondaryContractor?('Support Contractor: '+F.pjSecondaryContractor):'')].filter(v=>v&&String(v).trim());
  const lLines=[F.pjInstallAddr,F.pjCsz,'Multi-Family',
    (m.units?('Total Units: '+m.units):''),
    (F.pjIQ?('IQ Number: '+F.pjIQ):'')].filter(v=>v&&String(v).trim());
  const rLines=[F.pjOwner,contactWithTitle(F),F.pjOwnerAddr,F.pjOwnerCsz,_phone(F.pjPhone),F.pjEmail]
    .filter(v=>v&&String(v).trim());
  // Three evenly spaced columns across the full width: contractor left, project
  // information left-aligned at the one-third mark, customer flush-right.
  const drawParties=()=>{
    const pT=st.y, colW=CW/3, x2=M+colW, wCol=colW-12;
    tc(EMd); font(8.5,'bold');
    t(M,pT+8,'PRIMARY IRA CONTRACTOR');
    t(x2,pT+8,'PROJECT INFORMATION');
    t(W-M,pT+8,'CUSTOMER INFORMATION',{align:'right'});
    let cy=pT+21,ly=pT+21,ry=pT+21; tc(C.ink); font(9);
    for(const v of cLines) for(const ln of wrap(v,wCol)){t(M,cy,ln); cy+=11.5;}
    for(const v of lLines) for(const ln of wrap(v,wCol)){t(x2,ly,ln); ly+=11.5;}
    for(const v of rLines) for(const ln of wrap(v,wCol)){t(W-M,ry,ln,{align:'right'}); ry+=11.5;}
    // isolate the header block from the sections below with a horizontal rule, kept close to the content
    st.y=Math.max(cy,ly,ry)+6; stroke(BLUE); d.setLineWidth(.8); d.line(M,st.y,W-M,st.y); st.y+=2; };
  const drawHead=(withParties)=>{
    st.y=18;                                                          // tight top margin — title sits near the top, not floating in white space
    tc(BLUE);       font(12,'bold');   t(W/2,st.y+11,'Energy Efficiency Services of '+_state,{align:'center'});
    tc(C.ink);      font(15,'bold');   t(W/2,st.y+31,dlab,{align:'center'});
    tc([70,82,98]); font(10.5,'bold'); t(W/2,st.y+47,_state+' IRA Multifamily HOMES Program',{align:'center'});
    st.y+=54; stroke(BLUE); d.setLineWidth(1); d.line(M,st.y,W-M,st.y);
    // party blocks appear on the FIRST page only; continuation pages carry just the title header
    if(withParties){ st.y+=10; drawParties(); } else { st.y+=14; } };
  const contPage=()=>{ d.addPage(); st.y=M; drawHead(false); };   // continuation page: title header only, no party columns
  const needH=h=>{ if(st.y+h>H-M-24) contPage(); };
  drawHead(true);
  /* ---- section heading: navy label, hairline rule with a short emerald tab ---- */
  const head=(txt,gap)=>{need(30); st.y+=(gap!=null?gap:14); tc(BLUE); font(10.5,'bold');
    t(W/2,st.y+9,txt.toUpperCase(),{align:'center'}); st.y+=13; stroke(BLUE); d.setLineWidth(.9);
    d.line(M,st.y,W-M,st.y); st.y+=5;};
  // A section total drawn on the RIGHT: label right-aligned just left of its
  // figure, both anchored to the right edge, so the eye lands on the money.
  const rlineE=(lbl,val,bold)=>{tc(C.ink); font(9,bold?'bold':'normal');
    const vw=d.getTextWidth(String(val));               // label sits a fixed gap left of the ACTUAL figure, so it never floats mid-page
    t(W-M,st.y+11,val,{align:'right'}); t(W-M-vw-14,st.y+11,lbl,{align:'right'});};
  /* ---- grid helpers: bordered cells, shaded header row ---- */
  const gridHeader=(cols)=>{ // cols: [{x0,x1,lbl,align}]
    const h=16; need(h+4);
    fill(HB); d.rect(M,st.y,CW,h,'F');
    stroke(GL); d.setLineWidth(.6); d.rect(M,st.y,CW,h);
    for(const c of cols) d.line(c.x0,st.y,c.x0,st.y+h);
    tc([70,82,98]); font(7.5,'bold');
    for(const c of cols)
      t(c.align==='right'?c.x1-5:c.x0+5,st.y+11,c.lbl,c.align==='right'?{align:'right'}:{});
    st.y+=h;};
  const gridBorders=(cols,h)=>{stroke(GL); d.setLineWidth(.6);
    d.line(M,st.y,M,st.y+h); d.line(W-M,st.y,W-M,st.y+h);
    for(const c of cols) d.line(c.x0,st.y,c.x0,st.y+h);
    d.line(M,st.y+h,W-M,st.y+h);};
  /* ---- line items ---- */
  head(isAudit?'Audit Services':'Project Scope of Work',24);
  if(isAudit){
    const CA=[{x0:M+22,x1:M+300,lbl:'SERVICE DESCRIPTION'},{x0:M+300,x1:M+340,lbl:'QTY',align:'right'},
      {x0:M+340,x1:M+400,lbl:'UNIT'},{x0:M+400,x1:M+466,lbl:'RATE',align:'right'},
      {x0:M+466,x1:W-M,lbl:'AMOUNT',align:'right'}];
    gridHeader(CA);
    tc([70,82,98]); font(7.5,'bold'); t(M+5,st.y-5,'#');
    const rows=[['1','Whole-Building Energy Audit \u2014 Multifamily','1','Building','$2,000.00','$2,000.00'],
      ['2','Whole Building Blower Door and Diagnostic Testing','1','Building','Included','Included'],
      ['3','Common Area and Building Envelope Assessment','1','Building','Included','Included'],
      ['4','Mechanical Systems Survey','1','Building','Included','Included'],
      ['5','Energy Modeling — Asset Score (HPXML / BuildingSync)','1','Building','Included','Included'],
      ['6','Program Energy Audit Report (ASHRAE Level II)','1','Building','Included','Included'],
      ['7','Customer Report / Building Assessment Tool Report','1','Building','Included','Included']];
    rows.forEach((r,i)=>{const h=16;
      if(st.y+h>H-M-20){d.addPage();st.y=M;}
      if(i%2===1){fill(C.zebra); d.rect(M,st.y,CW,h,'F');}
      gridBorders(CA,h);
      tc(C.mut); font(8.5); t(M+5,st.y+11,r[0]);
      tc(C.ink); t(M+27,st.y+11,r[1]);
      if(r[2])t(M+335,st.y+11,r[2],{align:'right'});
      t(M+345,st.y+11,r[3]);
      if(r[4])t(M+461,st.y+11,r[4],{align:'right'});
      t(AMT,st.y+11,r[5],{align:'right'});
      st.y+=h;});
  }else{
    /* Clean Sealed-style line-item table (Nicholas: "make it look a lot more like
       the sealed proposal template"): a blue rule, right-aligned amount columns,
       the numbered measure name + its dollar columns on one line and the
       description flowing below in the wide left column, zebra striping and a
       hairline between measures — NO boxed sub-grids or empty cells. NC keeps its
       Quantity / Labor / Material / Total split (the HOMES cost-documentation
       requirement); every other state shows Quantity / Unit / Amount. */
    const isNC=m.state==='NC';
    // Each column: [label, value(row), width]. Values are right-aligned at the
    // column's right edge; the description column takes whatever is left.
    const numCols=isNC
      ?[['QUANTITY/UNITS',r=>_qty(r.qty),84],
        ['LABOR',   r=>_money(r.labor),64],
        ['MATERIAL',r=>_money(r.material),68],
        ['TOTAL',   r=>_money(r.cost),72]]
      :[['QUANTITY',r=>_qty(r.qty),54],
        ['UNIT OF MEASURE',r=>String(r.unit||''),62],
        ['AMOUNT',  r=>_money(r.cost),78]];
    const numTotW=numCols.reduce((a,c)=>a+c[2],0);
    const descW=CW-numTotW;                       // wide left column for name + description
    // Precompute each column's right edge (rightmost first, walking left from W-M).
    let _rx=W-M; for(let c=numCols.length-1;c>=0;c--){numCols[c][3]=_rx; _rx-=numCols[c][2];}
    // vertical grid: a line at each column boundary so the numbers read as real
    // columns instead of floating in space.
    const colXs=[M].concat(numCols.map(c=>c[3]-c[2])).concat([W-M]);
    const colRules=(yTop,yBot)=>{stroke(HAIR); d.setLineWidth(.6); colXs.forEach(x=>d.line(x,yTop,x,yBot));};
    // header row — repeats at the top of every page the table spills onto.
    const headH=26;
    const tableHeader=()=>{
      need(headH+8);
      fill(PANEL); d.rect(M,st.y,CW,headH,'F');
      stroke(BLUE); d.setLineWidth(1); d.line(M,st.y,W-M,st.y);
      tc(NAVY); font(8,'bold'); t(M+5,st.y+headH/2+3,'ENERGY EFFICIENCY MEASURE');
      numCols.forEach(([lbl,,w,rx])=>{const wl=wrap(lbl,w-8); const ty=st.y+(headH-wl.length*9)/2+7;
        wl.forEach((ln,k)=>t(rx-4,ty+k*9,ln,{align:'right'}));});
      colRules(st.y,st.y+headH);
      stroke(HAIR); d.setLineWidth(.8); d.line(M,st.y+headH,W-M,st.y+headH);
      st.y+=headH;
    };
    tableHeader();
    const nameLH=12.5, descLH=10.5, padT=8, gapND=5, padB=9;
    m.rows.forEach((r,i)=>{
      font(10,'bold'); const nameLines=wrap((i+1)+'.  '+r.name,descW-10);
      font(8.5);       const dl=wrap(r.desc,descW-10);
      const nameH=nameLines.length*nameLH, descH=dl.length?dl.length*descLH:0;
      const h=padT+nameH+(descH?gapND+descH:0)+padB;
      // page break BEFORE drawing the row, then repeat the header. A measure block
      // never splits across pages.
      if(st.y+h>H-M-24){contPage(); tableHeader();}
      const y0=st.y;
      if(i%2===1){fill(C.zebra); d.rect(M,y0,CW,h,'F');}   // subtle zebra for scanning
      // measure name (numbered) + description, left column
      tc(C.ink); font(10,'bold');
      nameLines.forEach((ln,k)=>t(M+5,y0+padT+k*nameLH+9,ln));
      if(dl.length){const dy=y0+padT+nameH+gapND; font(8.5); tc([70,82,98]);
        dl.forEach((ln,k)=>t(M+5,dy+k*descLH+8,ln));}
      // quantity / dollar columns — top-aligned on the measure's first line so
      // they sit in a clear grid cell, not stranded in the middle of the row.
      const numY=y0+h/2+3;
      numCols.forEach(([lbl,fn,w,rx],c)=>{
        font(9.5,c===numCols.length-1?'bold':'normal');
        tc(c===numCols.length-1?C.ink:[64,78,96]);
        t(rx-4,numY,fn(r),{align:'right'});});
      st.y=y0+h;
      colRules(y0,st.y);                                        // vertical separators
      stroke(HAIR); d.setLineWidth(.6); d.line(M,st.y,W-M,st.y); // row bottom
    });
  }
  /* ---- rebates as credit lines in a gridded table ---- */
  const gross=isAudit?2000:m.total, foeAmt=isAudit?0:m.foeAmt, iraAmt=isAudit?2000:m.homesAmt;
  // close the Scope of Work with its total — the full cost of the work above
  {needH(34); st.y+=6; stroke(HAIR); d.setLineWidth(.6); d.line(M,st.y,W-M,st.y); st.y+=2;
   rlineE('Total Project Cost',_money(gross),true); st.y+=14;
   stroke(BLUE); d.setLineWidth(.9); d.line(M,st.y,W-M,st.y);}
  const credits=[];
  if(isAudit) credits.push(['IRA HOMES Incentive \u2014 Instant Discount','Income-Qualified Multifamily Energy Assessment Rebate per Building',iraAmt]);
  else{
    if(m.foe&&foeAmt) credits.push(['Focus on Energy \u2014 Instant Discount',m.foe.desc+' ('+m.foe.note+')',foeAmt]);
    if(m.tier&&iraAmt) credits.push(['IRA HOMES \u2014 Instant Discount',m.tier.desc+'  \u00b7  '+(m.units||0)+' units \u00d7 '+_money(m.tier.perUnit)+' per unit = '+_money(iraAmt),iraAmt]);
  }
  // clean rebate rows (matching the line-item table), heading kept with the
  // column header and first credit line so a title is never orphaned.
  needH((m.foe?250:190));   // keep rebates + totals together on one page
  head(isAudit?'Rebates & Incentives Applied':'Available Rebates & Incentives',24);
  {stroke(BLUE); d.setLineWidth(1); d.line(M,st.y,W-M,st.y);
   tc(NAVY); font(8,'bold'); t(M+2,st.y+13,'PROGRAM'); t(W-M,st.y+13,'AMOUNT',{align:'right'});
   st.y+=17; stroke(HAIR); d.setLineWidth(1.2); d.line(M,st.y,W-M,st.y); st.y+=3;
   credits.forEach(([nm,desc,amt])=>{
     font(9.5,'bold'); const nl=wrap(nm,CW-160);
     font(8.5);        const dl=wrap(desc,CW-160);
     const h=8+nl.length*12+(dl.length?dl.length*10.5+2:0)+8;
     if(st.y+h>H-M-24){contPage();}
     const y0=st.y;
     tc(C.ink); font(9.5,'bold'); nl.forEach((ln,k)=>t(M+2,y0+8+k*12+9,ln));
     if(dl.length){font(8.5); tc([70,82,98]); const dy=y0+8+nl.length*12+2;
       dl.forEach((ln,k)=>t(M+2,dy+k*10.5+8,ln));}
     tc(C.ink); font(10,'bold'); t(W-M,y0+h/2+3,_money(amt),{align:'right'});
     st.y=y0+h; stroke(C.line); d.setLineWidth(.5); d.line(M,st.y,W-M,st.y); st.y+=3;});}
  const reb=foeAmt+iraAmt, due=Math.round((gross-reb)*100)/100;
  const dueVal=Math.abs(due)<0.005?0:due;
  // close the rebate section with its total (positive — a contribution)
  {st.y+=4; stroke(HAIR); d.setLineWidth(.6); d.line(M,st.y,W-M,st.y); st.y+=2;
   rlineE('Total Rebate Amount',_money(reb),true); st.y+=14;
   stroke(BLUE); d.setLineWidth(.9); d.line(M,st.y,W-M,st.y);}
  /* ---- Project Summary: a full-width section mirroring the Sealed layout ---- */
  head('Project Summary',32);
  {const trows=[['Total Project Cost',_money(gross),false],
     ['Total Rebate Amount Applied as Instant Discount','('+_money(reb)+')',false],
     [isInv?'Total Due':'Total Remaining Amount',_money(dueVal),true]];
   for(const [lb,v,strong] of trows){
     if(strong){ rlineE(lb,v,true); }
     else{ tc(C.ink); font(9,'normal'); t(M,st.y+11,lb); t(W-M,st.y+11,v,{align:'right'}); }
     stroke(HAIR); d.setLineWidth(.6); d.line(M,st.y+15,W-M,st.y+15); st.y+=16;}}
  /* deliverables now appear as line items in the audit service table above */
  /* ---- acknowledgment + signature: INVOICES ONLY. Proposals carry no
     acknowledgment/signature block (Nicholas). ---- */
  if(isAudit||isInv){
    head('Acknowledgment & Acceptance',20);
    const _ees='EES-'+(m.state||'WI');
    const ack='Receipt of this invoice constitutes acknowledgment of the services delivered. The property owner confirms the work performed and authorizes '+_ees+' to submit for and receive the corresponding program incentive on their behalf.';
    {const al=wrap(ack,CW); need(al.length*10+6); tc(C.ink); font(9);
     al.forEach((ln,k)=>t(W/2,st.y+9+k*10,ln,{align:'center'})); st.y+=al.length*10+4;}
    need(46); st.y+=28; stroke([68,88,110]); d.setLineWidth(1);
    d.line(M,st.y,M+280,st.y); d.line(W-M-150,st.y,W-M,st.y);
    tc(C.mut); font(8.5); t(M,st.y+10,'Property Owner / Authorized Representative');
    t(W-M-150,st.y+10,'Date');
    // Record where the signature and date go, for the e-signature route.
    // Taken from the SAME values that just drew the rules, so a tab can never
    // describe a layout the signer did not see. jsPDF y is top-origin; the
    // signing pipeline stores tab y bottom-origin, hence H - st.y. Both boxes
    // sit ABOVE their rule, bottom edge on the line.
    if(Array.isArray(signatureTabs)){
      const page=d.getNumberOfPages(), boxH=26;
      signatureTabs.push(
        {recipient_order:1,tab_type:'sig', page,x:M,        y:H-st.y,width:280,height:boxH},
        {recipient_order:1,tab_type:'date',page,x:W-M-150,y:H-st.y,width:150,height:boxH},
      );
    }
  }
  _stampEesFooters(P,m.state,pv(F.pjInvDate));
  return d.output('blob');
}
/* Footer on EVERY page + "Page X of Y" on multi-page documents, so shuffled
   proposal pages can be identified. Runs after all content is laid out. */

// --- ported: buildSealedPdfBlob (index.html 4225,4342) ---
function buildSealedPdfBlob(kind, signatureTabs = null){                    // 'proposal' | 'invoice'
  const m=invoiceModel(), F=m.fields;
  const isInv=kind==='invoice';
  const P=_pdfNew(20); const {d,W,H,M,CW,C,st,font,t,wrap,need,fill,stroke,tc}=P;
  // ---- one deliberate type scale, used everywhere ----
  //  18 title · 12 program · 11 stage + section headers · 9 labels/body/totals · 8 table + fine print
  const SGAP=26;                                   // clear space above every section header, so each section reads as its own block
  const GREEN=[33,131,82];                          // Sealed brand accent (green) — visually distinguishes Sealed documents from the EES proposals
  const bh=(txt,x,yy,al)=>{tc(GREEN); font(9,'bold'); t(x,yy,txt.toUpperCase(),al?{align:al}:{});};
  // one identical section-header treatment for all three sections — Sealed orange
  const sh=(txt)=>{st.y+=SGAP; need(48); tc(GREEN); font(10.5,'bold'); t(W/2,st.y+9,txt.toUpperCase(),{align:'center'});
    stroke(GREEN); d.setLineWidth(1); d.line(M,st.y+13,W-M,st.y+13); st.y+=20;};
  const lines9=(arr,x,yy,al)=>{tc(C.ink); font(9); arr.filter(v=>v).forEach((ln,k)=>t(x,yy+k*8.6,String(ln),al?{align:al}:{})); return yy+arr.filter(v=>v).length*8.6;};
  // A total drawn on the RIGHT: the label right-aligns just left of its figure,
  // both anchored to the page's right edge, so the reader's eye lands on the money.
  const rline=(lbl,val,bold)=>{tc(C.ink); font(9,bold?'bold':'normal');
    const vw=d.getTextWidth(String(val));               // label sits a fixed gap left of the ACTUAL figure, so it never floats mid-page
    t(W-M,st.y+10,val,{align:'right'}); t(W-M-vw-14,st.y+10,lbl,{align:'right'});};
  const docLabel=isInv?'Project Invoice':'Project Proposal';
  const docNo=F.pjProjInvNo||F.pjIQ||'';
  const stageLabel=isInv?'Final Project Payment Request':'Project Reservation';
  st.y=M-6;   // tight top margin above the title
  // centered title block; drawn on page 1 and repeated atop any continuation page
  const drawTitle=()=>{
    tc(C.ink); font(14,'bold'); t(W/2,st.y+11,docLabel,{align:'center'});
    tc(C.ink);      font(11,'bold'); t(W/2,st.y+25,stateFullName(m.state)+' IRA Multifamily HOMES Program - '+stageLabel,{align:'center'});
    st.y+=32; stroke(GREEN); d.setLineWidth(1); d.line(M,st.y,W-M,st.y); st.y+=13; };
  const contPage=()=>{ d.addPage(); st.y=M-6; drawTitle(); };   // a continuation page keeps the header
  const needH=h=>{ if(st.y+h>H-M-16) contPage(); };             // page break that redraws the header
  drawTitle();
  // three balanced columns across the page: Contractor | Project Information | Proposal Details
  const CX2=M+200, CX3=W-M;
  // Date lines print ONLY when a value exists — a bare "Est. Start Date:" with
  // nothing after it reads as an unfinished document, not a project detail.
  const projInfo=isInv
    ?[F.pjInstallAddr,F.pjCsz,'Multi-Family',(m.units?('Total Units: '+m.units):''),(F.pjIQ?('IQ Number: '+F.pjIQ):''),(F.pjStart?('Start Date: '+F.pjStart):''),(F.pjEnd?('Completion Date: '+F.pjEnd):'')]
    :[F.pjInstallAddr,F.pjCsz,'Multi-Family',(m.units?('Total Units: '+m.units):''),(F.pjIQ?('IQ Number: '+F.pjIQ):''),(F.pjEstStart?('Est. Start Date: '+F.pjEstStart):''),(F.pjEstEnd?('Est. Completion Date: '+F.pjEstEnd):'')];
  const ci=[F.pjOwner,contactWithTitle(F),F.pjOwnerAddr,F.pjOwnerCsz,_phone(F.pjPhone),F.pjEmail];
  bh('Primary IRA Contractor:',M,st.y);
  bh('Project Information:',CX2,st.y);
  bh('Customer Information:',CX3,st.y,'right');
  // Wrap the contractor column to its own width (up to the Project Information
  // column) so a long support-contractor name can't bleed into the next column.
  const cW1=CX2-M-8;
  const contractorLines=['Sealed, Inc.','200 E Verona Ave','Verona, WI 53593',_phone('(949) 832-6798'),
    (F.pjSecondaryContractor?('Support Contractor: '+F.pjSecondaryContractor):'')]
    .filter(v=>v&&String(v).trim()).flatMap(v=>wrap(String(v),cW1));
  let y1=lines9(contractorLines,M,st.y+13);
  let y2=lines9(projInfo,CX2,st.y+13);
  let y3=lines9(ci,CX3,st.y+13,'right');
  st.y=Math.max(y1,y2,y3);
  // isolate the header block from the sections below with a horizontal rule
  st.y+=8; stroke(GREEN); d.setLineWidth(.8); d.line(M,st.y,W-M,st.y); st.y+=2;
  /* ===== Section 1: Project Scope of Work ===== */
  sh('Project Scope of Work');
  /* items table — narrow Contractor/Measure columns, wide readable Description;
     every cell is vertically centered in its row, the way an Excel table reads. */
  const cW=84, mX=M+cW, mW=86, dX=mX+mW, dW=(W-M-64)-dX;   // column geometry
  tc(C.ink); font(8,'bold');
  t(M,st.y+12,'CONTRACTOR'); t(mX,st.y+12,'MEASURE'); t(dX,st.y+12,'DESCRIPTION'); t(W-M,st.y+12,'TOTAL',{align:'right'});
  st.y+=16; stroke(GREEN); d.setLineWidth(1.2); d.line(M,st.y,W-M,st.y); st.y+=2;
  const CLH=9, RH=10;
  m.rows.forEach((r,i)=>{
    const desc='Qty: '+_qty(r.qty)+' '+(r.unit==='Sq Ft'?'Sq Ft.':'Units.')+' '+r.desc.replace(/\n/g,' ');
    font(8.5);        const cl=wrap('Energy Efficiency Services of '+stateFullName(m.state),cW-6);
    font(8.5,'bold'); const nml=wrap(r.name,mW-6);
    font(9);          const dl=wrap(desc,dW);
    const h=Math.max(dl.length*RH, cl.length*CLH, nml.length*CLH)+4;
    if(st.y+h>H-M-16){contPage();}
    if(i%2===1){fill(C.zebra); d.rect(M,st.y,CW,h,'F');}
    tc(C.ink);
    font(8.5);        let y0=st.y+(h-cl.length*CLH)/2+7;  cl.forEach((ln,k)=>t(M,y0+k*CLH,ln));
    font(8.5,'bold'); y0=st.y+(h-nml.length*CLH)/2+7;     nml.forEach((ln,k)=>t(mX,y0+k*CLH,ln));
    font(9,'bold');   t(W-M,st.y+h/2+3,_money(r.cost),{align:'right'});
    font(9);          y0=st.y+(h-dl.length*RH)/2+8;       dl.forEach((ln,k)=>t(dX,y0+k*RH,ln));
    st.y+=h; stroke(C.line); d.setLineWidth(.5); d.line(M,st.y,W-M,st.y); st.y+=2;
  });
  // Section 1 total — the full cost of all the work above
  {need(28); st.y+=6; stroke(C.line); d.setLineWidth(.6); d.line(M,st.y,W-M,st.y); st.y+=3;
   rline('Total Project Cost',_money(m.total),true); st.y+=13;
   stroke(C.line); d.setLineWidth(.6); d.line(M,st.y,W-M,st.y); st.y+=4;}
  /* ===== Section 2: Rebates & Incentives ===== keep the whole rebate block and
     the project summary together so the summary never lands nearly alone. */
  needH((m.foe?244:198)+(isInv?150:0));             // keep rebates + summary (+ invoice acknowledgment) together
  sh('Available Rebates & Incentives');
  const sect=(title,desc,name,amt)=>{need(36); st.y+=9; bh(title,M,st.y);
    st.y+=4; stroke(C.line); d.setLineWidth(1); d.line(M,st.y,W-M,st.y);
    const dl=wrap(desc,270), h=Math.max(dl.length*9,18)+8; need(h);
    tc(C.ink); font(8); dl.forEach((ln,k)=>t(M,st.y+11+k*9,ln));
    wrap(name,150).forEach((ln,k)=>t(M+300,st.y+11+k*9,ln));
    tc(C.ink); font(9,'bold'); t(W-M,st.y+11,_money(amt),{align:'right'});
    st.y+=h; stroke(C.line); d.line(M,st.y,W-M,st.y);};
  sect('Inflation Reduction Act HOMES Rebate','Incentive Description: '+(m.tier?m.tier.desc:'')+'. Notes: '+(m.tier?m.tier.note:'')+'.',
    'IRA HOMES '+(isInv?'Incentive ':'')+'- Instant Discount',m.homesAmt);
  if(m.foe) sect('Other Non-IRA Rebates','Incentive Description: '+m.foe.desc+'. Notes: '+m.foe.note+'.',
    'Focus on Energy - Instant Discount',m.foeAmt);
  // total of every rebate available toward the project cost
  {need(26); st.y+=8; stroke(C.line); d.setLineWidth(.6); d.line(M,st.y,W-M,st.y); st.y+=3;
   rline('Total Rebate Amount',_money(m.total),true); st.y+=13;
   stroke(C.line); d.setLineWidth(.6); d.line(M,st.y,W-M,st.y); st.y+=4;}
  /* ===== Section 3: Project Summary ===== */
  sh('Project Summary');
  const trows=[['Total Project Cost',_money(m.total),false],
    ['Total Rebate Amount Applied as Instant Discount','('+_money(m.total)+')',false],
    [isInv?'Total Due':'Total Remaining Amount','$0.00',true]];
  // A real table: labels on the left, figures on the right; only the final
  // emphasized total is pulled right, next to its figure.
  for(const [lbl,val,strong] of trows){
    if(strong){ rline(lbl,val,true); }
    else{ tc(C.ink); font(9,'normal'); t(M,st.y+10,lbl); t(W-M,st.y+10,val,{align:'right'}); }
    stroke(C.line); d.setLineWidth(.5); d.line(M,st.y+14,W-M,st.y+14); st.y+=14;}
  // Acknowledgment & Acceptance — invoice / payment request only, matching the
  // EES invoice; reserved with the block above so it is never orphaned.
  if(isInv){
    sh('Acknowledgment & Acceptance');
    const _ees='EES-'+(m.state||'WI');
    const ack='Receipt of this invoice constitutes acknowledgment of the services delivered. The property owner confirms the work performed and authorizes '+_ees+' to submit for and receive the corresponding program incentive on their behalf.';
    const al=wrap(ack,CW); tc(C.ink); font(9); al.forEach((ln,k)=>t(W/2,st.y+9+k*10,ln,{align:'center'})); st.y+=al.length*10+4;
    st.y+=28; stroke([68,88,110]); d.setLineWidth(1);
    d.line(M,st.y,M+280,st.y); d.line(W-M-150,st.y,W-M,st.y);
    tc(C.mut); font(8.5); t(M,st.y+10,'Property Owner / Authorized Representative'); t(W-M-150,st.y+10,'Date');
    // Record where the signature and date go, for the e-signature route.
    // Taken from the SAME values that just drew the rules, so a tab can never
    // describe a layout the signer did not see. jsPDF y is top-origin; the
    // signing pipeline stores tab y bottom-origin, hence H - st.y. Both boxes
    // sit ABOVE their rule, bottom edge on the line.
    if(Array.isArray(signatureTabs)){
      const page=d.getNumberOfPages(), boxH=26;
      signatureTabs.push(
        {recipient_order:1,tab_type:'sig', page,x:M,        y:H-st.y,width:280,height:boxH},
        {recipient_order:1,tab_type:'date',page,x:W-M-150,y:H-st.y,width:150,height:boxH},
      );
    }
  }
  _stampSealedFooters(P,docLabel,docNo,F.pjInvDate);
  return d.output('blob');
}

