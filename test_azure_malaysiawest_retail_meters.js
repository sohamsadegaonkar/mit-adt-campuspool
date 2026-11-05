'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {queryUrl,safeNextPage,normalize,registryDaily,collect}=require('./scripts/azure-malaysiawest-retail-meters');
const good={
 armRegionName:'malaysiawest',currencyCode:'INR',type:'Consumption',
 serviceName:'Container Registry',meterName:'Basic Registry Unit',
 unitOfMeasure:'1/Day',retailPrice:15.5,effectiveStartDate:'2026-11-01T00:00:00Z'
};
test('public rate API URI is anchored to Malaysia West and INR without secrets',()=>{
 const u=new URL(queryUrl('Container Registry'));
 assert.equal(u.hostname,'prices.azure.com');
 assert.ok(u.searchParams.get('$filter').includes("armRegionName eq 'malaysiawest'"));
 assert.equal(u.searchParams.get('currencyCode'),'INR');
 assert.throws(()=>queryUrl('OtherService'),/SERVICE_NOT_ALLOWLISTED/);
});
test('pagination cannot redirect pricing retrieval or change region/currency',()=>{
 for(const u of [
   'http://prices.azure.com/api/retail/prices',
   'https://attacker.test/api/retail/prices',
   'https://prices.azure.com/api/retail/prices?currencyCode=USD',
   'https://prices.azure.com/api/retail/prices?currencyCode=INR',
   "https://prices.azure.com/api/retail/prices?currencyCode=INR&%24filter=armRegionName%20eq%20'eastus'"
 ])assert.throws(()=>safeNextPage(u),/UNTRUSTED_RETAIL_API_PAGE|REGION_FILTER_DROPPED/);
});
test('31-day ACR fixed rate is computed from exact daily meter',()=>{
 const x=registryDaily([good]);
 assert.equal(x.status,'PUBLIC_RETAIL_RATE_ONLY');
 assert.equal(x.thirtyOneDayInr,480.5);
 assert.equal(x.rateInrPerDay,15.5);
});
test('duplicate/missing ACR Basic price cannot be treated as zero',()=>{
 assert.equal(registryDaily([]).status,'UNVERIFIED');
 assert.equal(registryDaily([good,good]).status,'UNVERIFIED');
});
test('exclude unrelated region, currency, pricing types and invalid amounts',()=>{
 for(const delta of [
   {armRegionName:'eastus'},{currencyCode:'USD'},
   {type:'Reservation'},{retailPrice:-5},{retailPrice:'0'}
 ])assert.equal(normalize({...good,...delta}),null);
});
test('full synthetic public meter response never authorizes provisioning',async()=>{
 const fixture={
  Items:[good],NextPageLink:null
 };
 const fetchImpl=async(url,opts)=>{
   assert.equal(opts.method,'GET');
   assert.equal(opts.redirect,'error');
   assert.equal(new URL(url).hostname,'prices.azure.com');
   const bytes=new TextEncoder().encode(JSON.stringify(fixture));
   return {ok:true,headers:{get:()=> 'application/json'},
     body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})};
 };
 const r=await collect({services:['Container Registry'],fetchImpl});
 assert.equal(r.details['Container Registry'].basicRegistry.thirtyOneDayInr,480.5);
 assert.equal(r.provisioningAuthorized,false);
 assert.equal(r.notSubscriptionVerified,true);
});
