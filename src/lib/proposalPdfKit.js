// ---------------------------------------------------------------------------
// proposalPdfKit — the drawing primitives every EES / Sealed proposal document
// shares: the letter-size jsPDF page with LEAP's palette and its cursor, the
// money / quantity / phone formatters, the state name, the contact-with-title
// line, and the two page footers.
//
// Why this file exists: these helpers were ported once into homesProposal.js
// for the HOMES proposal. The HEAR proposal draws on exactly the same page
// furniture, and a second copy is a second chance for one of them to be wrong —
// the lesson `pinnedTableHeader.js` and `dateDisplay.js` already record. Every
// body below is byte-for-byte the standalone Audit Builder's
// (audit-template-builder/frontend/index.html), so the documents render
// identically to the approved output.
//
// The one deliberate difference from the original: stampEesFooters takes an
// optional bottom margin. The HOMES proposal draws its footer 40pt off the
// bottom and the HEAR proposal 28pt (its page is tighter); the default is 40,
// so the HOMES documents are unchanged.
// ---------------------------------------------------------------------------

/* eslint-disable */

// --- ported: stateFullName (index.html 3568) ---
export function stateFullName(st){return {WI:'Wisconsin',NC:'North Carolina',CO:'Colorado',MI:'Michigan',IN:'Indiana'}[st]||'Wisconsin';}

// --- ported: contactWithTitle (index.html 3265,3266) ---
export function contactWithTitle(F){const n=(F.pjContact||'').trim(),tt=(F.pjContactTitle||'').trim();
  return n?(tt?n+' - '+tt:n):'';}

// --- ported: _pdfNew (index.html 3773,3789) ---
// `jsPDF` is passed in rather than imported: the constructor is loaded lazily by
// the caller (jspdf is a heavy vendor chunk and must stay off the record-open
// path — see the Vite hazards note in CLAUDE.md).
export function newProposalPdf(jsPDF, margin){
  const d=new jsPDF({unit:'pt',format:'letter'});
  const W=612,H=792,M=margin||40,CW=W-2*M;
  const C={navy:[28,61,94],teal:[29,120,116],tealD:[21,94,91],soft:[251,246,234],obrd:[224,196,140],
    line:[217,224,232],green:[241,247,242],ink:[34,43,53],mut:[122,135,152],
    blueBg:[234,242,250],blueBr:[185,211,234],blueTx:[31,78,121],accent:[91,127,166],red:[192,57,43],
    sealBlue:[47,128,214],zebra:[242,247,253]};
  const st={y:M};
  const font=(sz,style)=>{d.setFont('helvetica',style||'normal');d.setFontSize(sz);};
  const t=(x,yy,txt,o)=>d.text(String(txt),x,yy,o||{});
  const wrap=(txt,w)=>d.splitTextToSize(String(txt),w);
  const need=h=>{if(st.y+h>H-M-16){d.addPage();st.y=M;}};
  return {d,W,H,M,CW,C,st,font,t,wrap,need,
    fill:c=>d.setFillColor(c[0],c[1],c[2]), stroke:c=>d.setDrawColor(c[0],c[1],c[2]),
    tc:c=>d.setTextColor(c[0],c[1],c[2])};
}

// --- ported: _money/_qty (index.html 3790,3791) ---
export function money(v){return '$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
export function qty(q){return q!=null?Number(q).toLocaleString('en-US'):'';}

// --- ported: _phone (index.html 3794,3805) ---
export function phone(s){
  if(!s) return '';
  const raw=String(s).trim();
  const em=raw.match(/(?:ext\.?|x|extension)\s*(\d+)\s*$/i);
  const ext=em?em[1]:'';
  let digits=(em?raw.slice(0,em.index):raw).replace(/\D/g,'');
  if(digits.length===11 && digits[0]==='1') digits=digits.slice(1);
  if(digits.length!==10) return raw;
  const out='('+digits.slice(0,3)+') '+digits.slice(3,6)+'-'+digits.slice(6);
  return ext?out+' ext. '+ext:out;
}

/* Footer on EVERY page + "Page X of Y" on multi-page documents, so shuffled
   proposal pages can be identified. Runs after all content is laid out. */
// --- ported: _stampEesFooters (index.html 4044,4060) ---
export function stampEesFooters(P,state,docDate,botMargin){
  const {d,W,H,M,font,t,stroke,tc}=P;
  const fy=H-(botMargin||40), N=d.getNumberOfPages();
  const line1='Energy Efficiency Services of '+stateFullName(state)+'    |    112 Owen Rd. PO Box 6141, Monona, WI 53716';
  const line2=state==='NC'?'ncira@ees-nc.org    |    (704) 990-5614':'ira@ees-wi.org    |    (608) 460-7419';
  for(let p=1;p<=N;p++){
    d.setPage(p);
    stroke([200,206,214]); d.setLineWidth(.75); d.line(M,fy,W-M,fy);
    tc([122,135,152]); font(8,'normal');   t(W/2,fy+12,line1,{align:'center'});
    tc([122,135,152]); font(7.5,'italic');  t(W/2,fy+22,line2,{align:'center'});
    if(docDate){tc([122,135,152]); font(8,'normal'); t(M,fy+12,'Date: '+docDate);}
    if(N>1){tc([122,135,152]); font(8,'normal'); t(W-M,fy+12,'Page '+p+' of '+N,{align:'right'});}
  }
}

/* Footer for the Sealed proposal / invoice: the document number on every page
   (so shuffled pages can be traced) plus Page X of Y. Runs after all content. */
// --- ported: _stampSealedFooters (index.html 4061,4076) ---
export function stampSealedFooters(P,docLabel,docNo,docDate){
  const {d,W,H,M,font,t,stroke,tc}=P;
  const fy=H-24, N=d.getNumberOfPages();
  const left=[docNo?(docLabel+' No.: '+docNo):'', docDate?('Date: '+docDate):''].filter(Boolean).join('    ·    ');
  for(let p=1;p<=N;p++){
    d.setPage(p);
    stroke([200,206,214]); d.setLineWidth(.75); d.line(M,fy,W-M,fy);
    tc([122,135,152]); font(8,'normal');
    if(left) t(M,fy+12,left);
    t(W-M,fy+12,'Page '+p+' of '+N,{align:'right'});
  }
}
