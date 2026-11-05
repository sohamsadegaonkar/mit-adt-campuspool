'use strict';
// Official unauthenticated retail rates ONLY, not user's contracted subscription costs.
const fs=require('node:fs');
const API='https://prices.azure.com/api/retail/prices';
const REGION='malaysiawest';
const SERVICES=['Container Registry','Key Vault','Azure Container Apps','Storage','Azure Monitor'];

function queryUrl(service){
  if(!SERVICES.includes(service))throw Error('SERVICE_NOT_ALLOWLISTED');
  const u=new URL(API);
  u.searchParams.set('currencyCode',"'INR'");
  u.searchParams.set('$filter',"serviceName eq '"+service+"' and armRegionName eq '"+REGION+"' and priceType eq 'Consumption'");
  return u.toString();
}
function safeNextPage(url){
  const u=new URL(url);
  if(u.protocol!=='https:'||u.hostname!=='prices.azure.com'||
     u.pathname!=='/api/retail/prices'||u.username||u.password||u.hash||
     !['INR',"'INR'"].includes(u.searchParams.get('currencyCode')))
    throw Error('UNTRUSTED_RETAIL_API_PAGE');
  const f=u.searchParams.get('$filter')||'';
  if(!f.includes("armRegionName eq 'malaysiawest'"))throw Error('REGION_FILTER_DROPPED');
  return u.toString();
}
async function fetchJson(url,fetchImpl=fetch){
  const response=await fetchImpl(safeNextPage(url),{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{Accept:'application/json'}
  });
  if(!response?.ok)throw Error('RETAIL_API_UNAVAILABLE');
  const ctype=response.headers?.get?.('content-type')||'';
  if(!ctype.toLowerCase().includes('json'))throw Error('RETAIL_API_NOT_JSON');
  if(!response.body?.getReader)throw Error('RETAIL_API_RESPONSE_NOT_STREAMED');
  const reader=response.body.getReader();let bytes=0;const parts=[];
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>3500000)throw Error('RETAIL_API_RESPONSE_TOO_LARGE');
      parts.push(Buffer.from(value));
    }
  }finally{reader.releaseLock();}
  const j=JSON.parse(Buffer.concat(parts).toString('utf8'));
  if(!j||!Array.isArray(j.Items))throw Error('RETAIL_API_ITEMS_MISSING');
  return j;
}
function normalize(item){
  if(item.armRegionName!==REGION||item.currencyCode!=='INR'||
     item.type!=='Consumption'||typeof item.retailPrice!=='number'||
     !Number.isFinite(item.retailPrice)||item.retailPrice<0)return null;
  return {service:item.serviceName||'',sku:item.skuName||'',
    meter:item.meterName||'',unit:item.unitOfMeasure||'',
    priceInr:item.retailPrice,product:item.productName||'',
    effective:item.effectiveStartDate||''};
}
function registryDaily(items){
  const matching=items.map(normalize).filter(Boolean).filter(x=>
    x.service==='Container Registry'&&x.meter==='Basic Registry Unit' &&
    (/\/Day/i.test(x.unit)||/1 Day/i.test(x.unit)));
  if(matching.length!==1)return {status:'UNVERIFIED',reason:'BASIC_DAILY_METER_NOT_UNIQUE'};
  return {status:'PUBLIC_RETAIL_RATE_ONLY',rateInrPerDay:matching[0].priceInr,
    thirtyOneDayInr:Math.ceil(matching[0].priceInr*31*100)/100,
    effective:matching[0].effective,
    caveat:'Not an authenticated subscription quote; excludes taxes, existing charges, job/Blob/monitoring/egress.'};
}
async function collect({fetchImpl=fetch,services=SERVICES}={}){
  const details={};
  for(const service of services){
    const items=[];let url=queryUrl(service),pages=0;
    while(url&&pages<4){
      const j=await fetchJson(url,fetchImpl);
      for(const it of j.Items)if(normalize(it))items.push(it);
      pages++;url=j.NextPageLink?safeNextPage(j.NextPageLink):null;
    }
    const partial=Boolean(url);
    details[service]={rows:items.length,pages,partial,
      sample:items.map(normalize).filter(Boolean).filter(x=>{
        if(service==='Container Registry')return /Basic Registry Unit|Data Stored|Task/.test(x.meter);
        if(service==='Key Vault')return /Secret|Operation/i.test(x.meter);
        if(service==='Azure Container Apps')return /vCPU|Memory|Execution/i.test(x.meter);
        if(service==='Storage')return /Hot LRS|LRS.*Hot|Blob.*Hot/i.test(x.meter+' '+x.product);
        return /Data Ingestion|Log Analytics/i.test(x.meter+' '+x.product);
      }).slice(0,25)};
    if(service==='Container Registry'){
      details[service].basicRegistry=partial?
        {status:'UNVERIFIED',reason:'PAGINATED_RETAIL_RATE_INCOMPLETE'}:
        registryDaily(items);
    }
  }
  return {generatedAt:new Date().toISOString(),type:'PUBLIC_RETAIL_NOT_OWNER_BILLING',
    region:REGION,currency:'INR',details,notSubscriptionVerified:true,
    provisioningAuthorized:false,requiresOwnerCostManagement:true,
    requiresTaxesAndReserve:true};
}
if(require.main===module){
 collect().then(result=>{
   const data=JSON.stringify(result,null,2)+'\n';
   process.stdout.write(data);
   if(process.env.GITHUB_STEP_SUMMARY){
     const a=result.details['Container Registry']?.basicRegistry;
     fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
       '### Malaysia West public Azure retail meters (NOT subscription billing)\n\n'+
       'ACR Basic: '+(a?.status==='PUBLIC_RETAIL_RATE_ONLY'?
        'INR '+a.thirtyOneDayInr+' for 31 days before tax/other services':
        'not independently priced')+'\n\n'+
       'No paid resource or billing scope was accessed.\n');
   }
 }).catch(e=>{
   process.stderr.write('PUBLIC_RETAIL_FETCH_BLOCKED '+e.message+'\n');
   process.exitCode=1;
 });
}
module.exports={API,REGION,SERVICES,queryUrl,safeNextPage,normalize,registryDaily,collect};
