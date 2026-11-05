'use strict';

// Cost-only, fail-closed gate for CampusPool Azure staging backup architecture.
// This never authorizes resource creation or accesses Azure/credentials.
const fs = require('node:fs');

const CAP_PAISE = 50000;
const REQUIRED = Object.freeze([
  'image_registry',
  'key_vault',
  'container_job',
  'blob_storage',
  'blob_transactions',
  'monitoring_and_alerts',
  'network_and_egress',
  'existing_backup_charges',
  'taxes_and_fx'
]);
const ALLOWED_SOURCES = new Set([
  'azure.microsoft.com', 'learn.microsoft.com',
  'prices.azure.com', 'portal.azure.com'
]);

function paise(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
      || value > 1000000 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7)
    return null;
  return Math.round(value * 100);
}
function fresh(date, today) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t=Date.parse(date+'T00:00:00Z');
  const n=Date.parse(today+'T00:00:00Z');
  if (!Number.isFinite(t) || !Number.isFinite(n) ||
      new Date(t).toISOString().slice(0,10)!==date) return false;
  return t<=n && n-t<=14*86400000;
}
function verifiedSource(url) {
  if(typeof url!=='string'||url.length>500)return false;
  try{
    const u=new URL(url);
    return u.protocol==='https:' && ALLOWED_SOURCES.has(u.hostname) &&
      !u.username && !u.password && !u.hash && !u.search;
  }catch{return false;}
}
function money(p){return Math.round(p)/100;}

function reviewQuote(quote,{today=new Date().toISOString().slice(0,10)}={}){
  const blocks=[];
  if(!quote||typeof quote!=='object'||Array.isArray(quote))
    return {status:'BLOCKED',reasons:['QUOTE_MISSING'],provisioningAuthorized:false};

  if(quote.schemaVersion!==1)blocks.push('SCHEMA_UNSUPPORTED');
  if(quote.region!=='malaysiawest'||quote.currency!=='INR'||
     quote.periodDays!==31||quote.budgetInr!==500)
    blocks.push('BUDGET_SCOPE_MISMATCH');
  if(quote.billingScopeConfirmed!==true)
    blocks.push('OWNER_BILLING_SCOPE_NOT_VERIFIED');
  if(quote.taxesAndFxIncluded!==true)
    blocks.push('TAX_FX_NOT_INCLUDED');
  if(quote.studentCreditDeducted===true)
    blocks.push('STUDENT_CREDIT_MUST_NOT_REDUCE_SPEND_ESTIMATE');
  if(!fresh(quote.quoteDate,today))blocks.push('QUOTE_NOT_CURRENT');

  const itemAmounts=new Map();
  if(!Array.isArray(quote.items)||quote.items.length!==REQUIRED.length)
    blocks.push('INCOMPLETE_COST_ITEMS');
  for(const item of Array.isArray(quote.items)?quote.items:[]){
    if(!item||typeof item!=='object'||!REQUIRED.includes(item.category)||
       itemAmounts.has(item.category)){
      blocks.push('COST_CATEGORY_INVALID_OR_DUPLICATED');continue;
    }
    const amt=paise(item.monthlyUpperBoundInr);
    if(amt===null)blocks.push('COST_UNVERIFIED_'+item.category);
    if(!verifiedSource(item.sourceUrl)||!fresh(item.evidenceDate,today)||
       typeof item.evidenceId!=='string'||item.evidenceId.trim().length<8||
       item.evidenceId.length>120||
       typeof item.assumptions!=='string'||item.assumptions.trim().length<12||
       item.assumptions.length>800)
      blocks.push('EVIDENCE_INSUFFICIENT_'+item.category);
    itemAmounts.set(item.category,amt);
  }
  for(const cat of REQUIRED){
    if(!itemAmounts.has(cat))blocks.push('COST_CATEGORY_MISSING_'+cat);
  }

  const contingency=paise(quote.contingencyInr);
  if(contingency===null)blocks.push('CONTINGENCY_NOT_VERIFIED');
  const totalItems=[...itemAmounts.values()];
  const allNumeric=totalItems.length===REQUIRED.length && totalItems.every(v=>v!==null);
  let upperBound=null,minimumReserve=null;
  if(allNumeric&&contingency!==null){
    const subtotal=totalItems.reduce((a,b)=>a+b,0);
    minimumReserve=Math.max(5000,Math.ceil(subtotal*0.15));
    if(contingency<minimumReserve)blocks.push('INSUFFICIENT_15_PERCENT_OR_50_INR_RESERVE');
    upperBound=subtotal+contingency;
    if(upperBound>CAP_PAISE)blocks.push('OVER_OWNER_500_INR_LIMIT');
  }
  const reasons=[...new Set(blocks)];
  return {
    status:reasons.length===0?'COST_REVIEW_ELIGIBLE':'BLOCKED',
    reasons,
    budgetInr:500,
    estimatedUpperBoundInr:upperBound===null?null:money(upperBound),
    minimumReserveInr:minimumReserve===null?null:money(minimumReserve),
    // This tool is evidence preparation, never a provisioning approval or trigger.
    provisioningAuthorized:false,
    needsIndependentSecurityApproval:true,
    needsResourceAndIamApproval:true,
    needsActualAzureBillingVerification:true
  };
}

if(require.main===module){
  let output;
  try{
    if(process.argv.length!==3)throw Error('QUOTE_FILE_REQUIRED');
    const raw=fs.readFileSync(process.argv[2]);
    if(raw.length>65536)throw Error('QUOTE_TOO_LARGE');
    output=reviewQuote(JSON.parse(raw.toString('utf8')));
  }catch{
    output={status:'BLOCKED',reasons:['QUOTE_UNREADABLE_OR_INVALID'],
      provisioningAuthorized:false};
  }
  process.stdout.write(JSON.stringify(output,null,2)+'\n');
  if(output.status!=='COST_REVIEW_ELIGIBLE')process.exitCode=1;
}
module.exports={reviewQuote,REQUIRED,paise,fresh,verifiedSource};
