'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {reviewQuote,REQUIRED}=require('./scripts/check-azure-backup-budget');
const TODAY='2026-11-06';

function syntheticQuote(){
  const amounts=[160,30,20,40,20,25,25,5,25];
  return {
    schemaVersion:1,currency:'INR',region:'malaysiawest',
    periodDays:31,budgetInr:500,quoteDate:TODAY,
    billingScopeConfirmed:true,taxesAndFxIncluded:true,
    studentCreditDeducted:false,
    // Synthetically complete evidence for unit testing ONLY.
    items:REQUIRED.map((category,i)=>({
      category,
      monthlyUpperBoundInr:amounts[i],
      sourceUrl:'https://azure.microsoft.com/en-in/pricing/calculator/',
      evidenceDate:TODAY,
      evidenceId:'SYNTHETIC_QA_EVIDENCE_'+i,
      assumptions:'Synthetic upper-bound 31-day budget test only. Not a real Azure quote.'
    })),
    contingencyInr:60
  };
}
test('template remains blocked before actual quote, subscription validation and approvals',()=>{
  const raw=fs.readFileSync('ops/cloud-backup/azure-cost-review.template.json','utf8');
  const result=reviewQuote(JSON.parse(raw),{today:TODAY});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.provisioningAuthorized,false);
  assert.equal(result.estimatedUpperBoundInr,null);
  assert.ok(result.reasons.includes('OWNER_BILLING_SCOPE_NOT_VERIFIED'));
});
test('complete synthetic quote can only become cost-review eligible, never cloud authorization',()=>{
  const result=reviewQuote(syntheticQuote(),{today:TODAY});
  assert.equal(result.status,'COST_REVIEW_ELIGIBLE');
  assert.equal(result.estimatedUpperBoundInr,410);
  assert.equal(result.minimumReserveInr,52.5);
  assert.equal(result.provisioningAuthorized,false);
  assert.equal(result.needsResourceAndIamApproval,true);
  assert.equal(result.needsActualAzureBillingVerification,true);
});
test('monthly total includes contingency and blocks over INR 500',()=>{
  const q=syntheticQuote();
  q.items[0].monthlyUpperBoundInr=300;
  const result=reviewQuote(q,{today:TODAY});
  assert.equal(result.status,'BLOCKED');
  assert.ok(result.reasons.includes('OVER_OWNER_500_INR_LIMIT'));
});
test('insufficient 15% or INR 50 margin blocks even if raw total is cheap',()=>{
  const q=syntheticQuote();
  q.contingencyInr=20;
  const result=reviewQuote(q,{today:TODAY});
  assert.ok(result.reasons.includes('INSUFFICIENT_15_PERCENT_OR_50_INR_RESERVE'));
});
test('missing item, duplicated item, and unknown category block',()=>{
  const q=syntheticQuote();q.items.pop();
  assert.ok(reviewQuote(q,{today:TODAY}).reasons.includes('INCOMPLETE_COST_ITEMS'));
  const dup=syntheticQuote();dup.items[8].category=dup.items[0].category;
  assert.ok(reviewQuote(dup,{today:TODAY}).reasons.includes('COST_CATEGORY_INVALID_OR_DUPLICATED'));
  const unknown=syntheticQuote();unknown.items[0].category='payroll';
  assert.ok(reviewQuote(unknown,{today:TODAY}).reasons.includes('COST_CATEGORY_INVALID_OR_DUPLICATED'));
});
test('no omission of billing scope, tax or foreign-exchange forecast',()=>{
  for(const bad of [
    {billingScopeConfirmed:false},{taxesAndFxIncluded:false},
    {studentCreditDeducted:true},{periodDays:30},
    {budgetInr:750},{region:'southeastasia'}
  ]){
    assert.equal(reviewQuote({...syntheticQuote(),...bad},{today:TODAY}).status,'BLOCKED');
  }
});
test('unknown zero, negative, fractional-paise, string and infinity prices block',()=>{
  for(const amount of [null,-1,0.0001,'0',Infinity]){
    const q=syntheticQuote();q.items[0].monthlyUpperBoundInr=amount;
    assert.ok(reviewQuote(q,{today:TODAY}).reasons.includes('COST_UNVERIFIED_image_registry'));
  }
});
test('fake, credential-bearing, untrusted or stale evidence URLs block',()=>{
  for(const bad of [
    'http://azure.microsoft.com/en-in/pricing/calculator/',
    'https://azure.microsoft.com.evil.test/',
    'https://user:pass@azure.microsoft.com/',
    'https://azure.microsoft.com/path?token=secret',
    'https://azure.microsoft.com/path#token'
  ]){
    const q=syntheticQuote();q.items[0].sourceUrl=bad;
    assert.ok(reviewQuote(q,{today:TODAY}).reasons.includes('EVIDENCE_INSUFFICIENT_image_registry'));
  }
  for(const date of ['2026-10-01','2026-11-07','not-a-date']){
    const q=syntheticQuote();q.items[0].evidenceDate=date;
    assert.ok(reviewQuote(q,{today:TODAY}).reasons.includes('EVIDENCE_INSUFFICIENT_image_registry'));
  }
});
test('quote date must be recent, exact day and not in future',()=>{
  for(const date of ['2026-10-01','2026-11-07','2026-11-31']){
    assert.ok(reviewQuote({...syntheticQuote(),quoteDate:date},{today:TODAY})
      .reasons.includes('QUOTE_NOT_CURRENT'));
  }
});
test('must not interpret student credits as reducing actual Azure consumption',()=>{
  const q=syntheticQuote();
  q.studentCreditDeducted=true;
  assert.ok(reviewQuote(q,{today:TODAY})
    .reasons.includes('STUDENT_CREDIT_MUST_NOT_REDUCE_SPEND_ESTIMATE'));
});
