'use strict';
/**
 * Staging-only, server-feature-gated mobility UI.
 * No exact location is stored in localStorage, cookies or URL parameters.
 * Never interprets geometric suggestions as route-verified or reserved seats.
 */
(function (root) {
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const HOUR=3600000, DAY=24*HOUR;
  function buildIntentPayload(values, now=Date.now()){
    function location(prefix){
      const lat=Number(values[prefix+'Lat']), lon=Number(values[prefix+'Lon']);
      if(values[prefix+'Lat']===''||values[prefix+'Lon']===''||
         !Number.isFinite(lat)||!Number.isFinite(lon)||
         lat<6||lat>37||lon<68||lon>98)throw Error('Choose valid coordinates in India for both locations.');
      return {lat,lon};
    }
    const pickup=location('pickup'),dropoff=location('dropoff');
    const earliest=new Date(values.earliest),latest=new Date(values.latest);
    const start=earliest.getTime(),end=latest.getTime();
    if(!values.earliest||!values.latest||!Number.isFinite(start)||!Number.isFinite(end)||
       start<now-10*60000||start>now+7*DAY||
       end<=start||end-start>3*HOUR||end>now+7*DAY+3*HOUR)
      throw Error('Choose a future departure window of up to 3 hours, within the next 7 days.');
    return {pickup,dropoff,earliestDeparture:earliest.toISOString(),latestDeparture:latest.toISOString()};
  }
  function candidateView(item){
    if(!item || !UUID.test(String(item.rideId||'')) ||
       item.candidateOnly!==true || item.roadRouteVerificationRequired!==true)
      return null;
    const fare=Number(item.studentFare),seats=Number(item.seatsLeft);
    const pickup=Number(item.pickupDistanceMeters),dropoff=Number(item.dropoffDistanceMeters);
    const when=new Date(item.departureAt);
    if(!['Bike','Car'].includes(item.vehicle) ||
       !Number.isFinite(fare)||fare<0||!Number.isInteger(seats)||seats<1||
       !Number.isFinite(pickup)||pickup<0||pickup>1500||
       !Number.isFinite(dropoff)||dropoff<0||dropoff>1500||
       !Number.isFinite(when.getTime()))return null;
    return {rideId:item.rideId,vehicle:item.vehicle,studentFare:fare,
      seatsLeft:seats,pickupDistanceMeters:Math.round(pickup),
      dropoffDistanceMeters:Math.round(dropoff),
      departureLabel:when.toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})};
  }
  function failureMessage(status){
    if(status===401||status===403)return 'Sign in with your verified campus account to continue.';
    if(status===409)return 'An active travel request already exists. Refresh your request below.';
    if(status===429)return 'You have reached the matching search limit. Try again later.';
    if(status===404)return 'This request or ride is no longer available.';
    return 'The request could not be completed. Check your connection and try again.';
  }
  const exported={buildIntentPayload,candidateView,failureMessage};
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
  if(!root || !root.document || !root.fetch)return;

  const document=root.document;
  const byId=id=>document.getElementById(id);
  const state={enabled:false,csrf:null,intent:null,busy:false,map:null,markers:{},mode:null,requestSeq:0};
  const fields=['pickupLat','pickupLon','dropoffLat','dropoffLon'];
  function message(text){const node=byId('mobilityStatus');if(node)node.textContent=text;}
  function clearLocations(){
    for(const id of fields){const el=byId('mobility'+id[0].toUpperCase()+id.slice(1));if(el)el.value='';}
    for(const m of Object.values(state.markers))m.remove();
    state.markers={};
  }
  function setEnabled(enabled){
    const panel=byId('mobilityIntentPanel');
    if(!panel)return;
    panel.hidden=!enabled;panel.classList.toggle('hidden',!enabled);
    state.enabled=enabled;
    if(!enabled){
      state.intent=null;state.csrf=null;state.requestSeq++;
      clearLocations();
      byId('mobilityMatches').replaceChildren();
      if(state.map){state.map.remove();state.map=null;state.mode=null;}
      byId('mobilityMap').hidden=true;
      message('');
    }
  }
  function setBusy(value){
    state.busy=value;
    for(const id of ['mobilityCreate','mobilityCancel','mobilitySearch']){
      const button=byId(id);if(button)button.disabled=value;
    }
  }
  async function request(path,options={}){
    const res=await root.fetch(path,{credentials:'same-origin',cache:'no-store',...options});
    let data={};try{data=await res.json();}catch(_){}
    return {status:res.status,ok:res.ok,data};
  }
  function renderIntent(){
    const active=!!state.intent;
    byId('mobilityIntentForm').hidden=active;
    byId('mobilityActive').hidden=!active;
    byId('mobilityMatches').replaceChildren();
    if(active){
      const dates=[state.intent.earliestDeparture,state.intent.latestDeparture]
        .map(x=>new Date(x).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}));
      byId('mobilityWindow').textContent=dates.join(' – ');
      message('Travel request saved privately. Search for candidate rides when ready.');
    }else message('Choose pickup, drop-off and a departure window to search.');
  }
  function renderMatches(items){
    const container=byId('mobilityMatches');
    container.replaceChildren();
    if(!Array.isArray(items))return message('Matching service returned an invalid response.');
    const accepted=items.slice(0,10).map(candidateView).filter(Boolean);
    if(!accepted.length){message('No matching rides yet. Try again later or browse available rides.');return;}
    message(accepted.length+' geometric candidate(s) found. Distances are straight-line estimates, not safe walking routes.');
    for(const match of accepted){
      const card=document.createElement('article');
      card.className='rounded-xl border border-slate-700 bg-slate-950 p-3 space-y-2';
      const headline=document.createElement('p');
      headline.className='font-bold text-white text-sm';
      headline.textContent=match.vehicle+' · ₹'+match.studentFare+' per seat · '+match.seatsLeft+' seat(s) left';
      const info=document.createElement('p');
      info.className='text-xs text-slate-300';
      info.textContent=match.departureLabel+' · pickup ~'+match.pickupDistanceMeters+
        ' m · drop-off ~'+match.dropoffDistanceMeters+' m';
      const warning=document.createElement('p');
      warning.className='text-xs text-amber-300';
      warning.textContent='Unverified road route. No seat is reserved.';
      const button=document.createElement('button');
      button.type='button';
      button.className='rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs px-3 py-2';
      button.textContent='View ride & booking options';
      button.addEventListener('click',async()=>{
        // Only navigate through the existing booking flow and its restrictions.
        // Never reserve a seat directly from a candidate result.
        if(typeof root.syncLiveRides==='function')await root.syncLiveRides();
        if(typeof root.appState==='object'&&
           root.appState?.rides?.some(r=>r.id===match.rideId&&r.seatsLeft>0)&&
           typeof root.handleBookSeatClick==='function'){
          root.handleBookSeatClick(match.rideId);
        }else {
          message('This candidate is not in the current ride feed. Browse available rides and refresh.');
          byId('ridesGridContainer')?.scrollIntoView({behavior:'smooth',block:'start'});
        }
      });
      card.append(headline,info,warning,button);
      container.append(card);
    }
  }
  async function refresh(){
    const seq=++state.requestSeq;
    try{
      const me=await request('/api/auth/me');
      if(seq!==state.requestSeq)return;
      if(!me.ok||me.data?.user?.isVerified!==true||
         !/^[a-f0-9]{64}$/i.test(me.data?.csrfToken||'')){setEnabled(false);return;}
      const response=await request('/api/mobility/intent');
      if(seq!==state.requestSeq)return;
      // Feature-disabled 404 and unauthorized users must not see the form.
      if(!response.ok){setEnabled(false);return;}
      state.csrf=me.data.csrfToken;
      setEnabled(true);
      state.intent=response.data?.intent||null;
      renderIntent();
    }catch(_){if(seq===state.requestSeq)setEnabled(false);}
  }
  function values(){
    const read=id=>byId(id)?.value ?? '';
    return {pickupLat:read('mobilityPickupLat'),pickupLon:read('mobilityPickupLon'),
      dropoffLat:read('mobilityDropoffLat'),dropoffLon:read('mobilityDropoffLon'),
      earliest:read('mobilityEarliest'),latest:read('mobilityLatest')};
  }
  async function post(path,body){
    if(!state.csrf)throw Error('Session expired');
    // The key provides compatibility with the separate idempotency branch;
    // this UI never blindly retries an ambiguous write with a fresh key.
    return request(path,{method:'POST',headers:{'Content-Type':'application/json',
      'X-CSRF-Token':state.csrf,'Idempotency-Key':root.crypto.randomUUID()},
      body:JSON.stringify(body)});
  }
  async function onCreate(event){
    event.preventDefault();if(state.busy||!state.enabled||state.intent)return;
    let payload;
    try{payload=buildIntentPayload(values());}
    catch(err){message(err.message);return;}
    setBusy(true);
    try{
      const res=await post('/api/mobility/intents',payload);
      if(res.ok && UUID.test(res.data?.intent?.intentId||'')){
        clearLocations();state.intent=res.data.intent;renderIntent();
      }else{message(failureMessage(res.status));if(res.status===409)await refresh();}
    }catch(_){message('Request status is uncertain. Check your active request before trying again.');}
    finally{setBusy(false);}
  }
  async function onCancel(){
    if(state.busy||!state.intent||!state.enabled)return;
    setBusy(true);
    try{
      const res=await post('/api/mobility/intents/cancel',{intentId:state.intent.intentId});
      if(res.ok){state.intent=null;clearLocations();renderIntent();}
      else message(failureMessage(res.status));
    }catch(_){message('Cancellation status is uncertain. Refresh to verify before retrying.');}
    finally{setBusy(false);}
  }
  async function onSearch(){
    if(state.busy||!state.intent||!state.enabled)return;
    setBusy(true);
    try{
      const res=await request('/api/mobility/matches?intentId='+encodeURIComponent(state.intent.intentId));
      if(res.ok&&res.data?.routeVerificationRequired===true)renderMatches(res.data.candidates);
      else message(failureMessage(res.status));
    }catch(_){message('Matching search failed. Try again later.');}
    finally{setBusy(false);}
  }
  function chooseOnMap(mode){
    const box=byId('mobilityMap');
    if(!root.L){message('Map is unavailable. Enter coordinates manually.');return;}
    box.hidden=false;state.mode=mode;
    if(!state.map){
      state.map=root.L.map(box).setView([18.5103,73.9232],12);
      root.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
        attribution:'© OpenStreetMap contributors',maxZoom:18
      }).addTo(state.map);
      state.map.on('click',event=>{
        const kind=state.mode;if(!kind)return;
        const point=event.latlng;
        if(point.lat<6||point.lat>37||point.lng<68||point.lng>98){
          message('Please select a location within India.');return;
        }
        byId('mobility'+kind+'Lat').value=point.lat.toFixed(6);
        byId('mobility'+kind+'Lon').value=point.lng.toFixed(6);
        if(state.markers[kind])state.markers[kind].remove();
        state.markers[kind]=root.L.marker(point).addTo(state.map);
        message(kind+' selected on map. Select the other location, then set your time window.');
      });
    }
    root.setTimeout(()=>state.map?.invalidateSize(),0);
    message('Click the map to choose '+(mode==='Pickup'?'your pickup':'your destination')+'. Exact points stay in this form until submitted.');
  }
  function boot(){
    if(!byId('mobilityIntentPanel'))return;
    byId('mobilityIntentForm').addEventListener('submit',onCreate);
    byId('mobilityCancel').addEventListener('click',onCancel);
    byId('mobilitySearch').addEventListener('click',onSearch);
    byId('mobilityRefresh').addEventListener('click',refresh);
    byId('mobilityPickPickup').addEventListener('click',()=>chooseOnMap('Pickup'));
    byId('mobilityPickDropoff').addEventListener('click',()=>chooseOnMap('Dropoff'));
    root.addEventListener('campuspool:session-changed',refresh);
    refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
  else boot();
})(typeof window!=='undefined'?window:null);
