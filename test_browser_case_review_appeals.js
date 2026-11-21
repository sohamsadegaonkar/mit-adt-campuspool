'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
const store=fs.readFileSync(path.join(__dirname,'stage1-otp','rides-store.js'),'utf8');
const sql=fs.readFileSync(path.join(__dirname,'stage1-otp','migrations','014_case_review_appeals_foundation.sql'),'utf8');

test('review and appeal features require explicit opt-in and have no self-service reviewer grant',()=>{
 assert.match(server,/CASE_REVIEW_ENABLED_VALUE=process\.env\.CASE_REVIEW_ENABLED\|\|'false'/);
 assert.match(server,/CASE_REVIEW_ENABLED && \(!CASE_RESPONSE_ENABLED/);
 assert.match(sql,/GRANT SELECT ON public\.campus_case_reviewer_grants/);
 assert.doesNotMatch(sql,/GRANT (?:INSERT|UPDATE|DELETE) ON public\.campus_case_reviewer_grants/);
 assert.match(store,/revoked_at IS NULL AND g\.expires_at>clock_timestamp\(\)/);
 assert.match(server,/\/api\/reviewer\/cases\/decision/);
 assert.doesNotMatch(server,/\/api\/reviewer\/(?:grants|assign-role|promote|grant-role)/);
});
test('reviewer records and appeals cannot mutate booking or financial status',()=>{
 const begin=store.indexOf('async assertReviewer(');
 const end=store.indexOf('async pickupWaitStatus(',begin);
 assert.ok(begin>0&&end>begin);
 const review=store.slice(begin,end);
 assert.doesNotMatch(review,/UPDATE\s+public\.campus_(?:bookings|rides|users)/i);
 assert.doesNotMatch(review,/DELETE\s+FROM\s+public\.campus_(?:bookings|rides|users)/i);
 assert.doesNotMatch(review,/payment_status\s*=/i);
 assert.match(review,/BOTH_PARTIES_NOT_HEARD/);
 assert.match(review,/REVIEWER_CONFLICT_OF_INTEREST/);
 assert.match(review,/APPEAL_ALREADY_SUBMITTED/);
 assert.match(review,/CASE_ALREADY_REVIEWED/);
});
test('appeal UI stays private and hidden until server accepts it',()=>{
 assert.match(html,/caseReviewEnabled: false/);
 assert.match(html,/caseReviewEnabled=data\.caseReviewEnabled===true/);
 assert.match(html,/id="caseAppealForm"[^>]*hidden/);
 assert.match(html,/appealForm\.hidden=!\(appState\.caseReviewEnabled&&data\.canAppeal===true\)/);
 assert.match(html,/id="caseAppealReason" required/);
 assert.match(html,/option value="missing_evidence"/);
 assert.match(html,/option value="safety_context"/);
 assert.match(html,/id="caseReviewStatus"[^>]*role="status"/);
 assert.match(html,/\/api\/bookings\/cases\/appeal/);
 assert.match(html,/caseAppealHistory.*replaceChildren\(\)/);
 assert.match(html,/caseResponseTimeline.*replaceChildren\(\)/);
 assert.match(html,/caseReviewEnabled=false/);
 assert.match(html,/cannot be edited or used to charge anyone automatically/);
});
test('appeal reasons of the other passenger or driver remain private',()=>{
 assert.match(html,/item\.mine\s*\?/);
 assert.match(html,/Other participant appealed · reason kept private/);
 assert.match(html,/li\.textContent=/);
 assert.match(html,/result\.textContent=/);
 assert.match(store,/reason:a\.actor_user_id===actorUserId\?a\.reason_code:null/);
});
test('forms have labels, safe focus, reduced motion and no forced payment',()=>{
 assert.match(html,/aria-label="Your appeals and review outcomes"/);
 assert.match(html,/for="caseAppealReason"/);
 assert.match(html,/No fee|no automatic penalty|No penalty or payment change/i);
 assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
 assert.doesNotMatch(html.slice(html.indexOf('id="caseAppealForm"'),html.indexOf('id="caseResponseClose"')),
   /₹|UPI|Payment Gateway|Pay Now/i);
});
test('all classic inline scripts compile after new appeal wiring',()=>{
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
   if(m[1].trim())assert.doesNotThrow(()=>new vm.Script(m[1]));
});
