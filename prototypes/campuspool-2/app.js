/* CampusPool 2.0 — standalone, local-only frontend prototype.
 * No production APIs, authentication, payment requests, or database writes.
 */
(function () {
  'use strict';
  var KEY = 'campuspool2_demo_v1';
  var fee = 5;
  var nav = [
    { id: 'home', title: 'Home', icon: 'home' },
    { id: 'rides', title: 'Rides', icon: 'car' },
    { id: 'errands', title: 'Errands', icon: 'bag' },
    { id: 'activity', title: 'Activity', icon: 'clipboard' },
    { id: 'profile', title: 'Profile', icon: 'user' }
  ];
  var sampleRides = [
    { id: 'RD-201', name: 'Aditya P.', initials: 'AP', from: 'MIT-ADT Main Gate', to: 'Hadapsar', when: 'Today · 5:30 PM', price: 65, seats: 2, vehicle: 'Car', rating: '4.8' },
    { id: 'RD-202', name: 'Riya K.', initials: 'RK', from: 'MIT-ADT Main Gate', to: 'Pune Railway Station', when: 'Today · 6:15 PM', price: 120, seats: 2, vehicle: 'Car', rating: '4.9' },
    { id: 'RD-203', name: 'Arjun S.', initials: 'AS', from: 'MIT-ADT Main Gate', to: 'Wagholi', when: 'Tomorrow · 9:00 AM', price: 45, seats: 1, vehicle: 'Bike', rating: '4.7' }
  ];
  var sampleRequests = [
    { id:'ER-1024', item:'Cold coffee × 1', shop:'Main Canteen', location:'Hostel B gate', cost:35, reward:10, fee:5, status:'open', paid:true, requester:'Aarav M.', requesterInitials:'AM', pin:'4827', runner:null, created:'2 min ago', demo:true },
    { id:'ER-1025', item:'A4 notebook', shop:'Campus Stationery', location:'Hostel A reception', cost:55, reward:15, fee:5, status:'open', paid:true, requester:'Meera D.', requesterInitials:'MD', pin:'7419', runner:null, created:'6 min ago', demo:true },
    { id:'ER-1026', item:'Samosa × 2', shop:'Main Canteen', location:'Hostel C gate', cost:30, reward:10, fee:5, status:'open', paid:true, requester:'Kabir R.', requesterInitials:'KR', pin:'3168', runner:null, created:'9 min ago', demo:true }
  ];
  function fresh() {
    return {page:'home',rideMode:'find',rideFilter:'All',errandMode:'requester',errandFilter:'All',requests:JSON.parse(JSON.stringify(sampleRequests)),rides:JSON.parse(JSON.stringify(sampleRides)),bookings:[],trips:[],activeId:null,draft:null,selectedPayment:'upi',wallet:0,deliveryCount:0,toast:''};
  }
  var state;
  try {
    var stored = JSON.parse(localStorage.getItem(KEY) || 'null');
    state = stored && Array.isArray(stored.requests) && Array.isArray(stored.rides) ? Object.assign(fresh(), stored) : fresh();
  } catch(e) { state = fresh(); }
  state.page = 'home';
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch(e) {} }
  function escapeHtml(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function ico(n){return '<svg class="icon" aria-hidden="true"><use href="#i-'+n+'"></use></svg>';}
  function rupees(n){return '₹'+Number(n || 0).toLocaleString('en-IN');}
  function btn(action,label,type,extra){return '<button type="button" class="btn '+(type||'ghost')+'" data-action="'+action+'" '+(extra||'')+'>'+label+'</button>';}
  function title(kicker,heading,desc,compact) {
    return '<div class="page-head'+(compact?' compact':'')+'"><div><div class="eyebrow">'+kicker+'</div><h1>'+heading+'</h1><p>'+desc+'</p></div></div>';
  }
  function back(target){return '<button class="back" data-go="'+target+'">'+ico('left')+' Back to '+(target==='errands'?'errands':target==='rides'?'rides':'activity')+'</button>';}
  function tag(txt,type){return '<span class="tag '+(type||'')+'">'+txt+'</span>';}
  function cardEmpty(icon,titleText,body,action,actionText) {return '<div class="empty">'+ico(icon)+'<h3>'+titleText+'</h3><p>'+body+'</p>'+(action?btn(action,actionText,'primary'):'')+'</div>';}
  function moneyRow(label,value,extra){return '<div class="money-row '+(extra||'')+'"><span>'+label+'</span><strong>'+rupees(value)+'</strong></div>';}
  function totalFor(o){return Number(o.cost)+Number(o.reward)+Number(o.fee);}
  function orderStatus(o){return ({open:'Broadcasting',accepted:'Runner assigned',picking:'At the shop',picked:'On the way',delivered:'Delivered',cancelled:'Cancelled'})[o.status]||o.status;}
  function statusTag(o){return tag(orderStatus(o),o.status==='delivered'?'green':o.status==='cancelled'?'red':o.status==='open'?'yellow':'');}
  function findOrder(id){return state.requests.find(function(x){return x.id === id;});}
  function getActive(){return findOrder(state.activeId);}
  function myOrder(o){return !o.demo;}
  function notify(msg){var node=document.getElementById('toast');node.innerHTML=ico('check')+escapeHtml(msg);node.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(function(){node.hidden=true;},4000);}
  function setPage(page){state.page=page;save();render();window.scrollTo({top:0,behavior:'auto'});}
  function goOrder(id,mode){state.activeId=id;if(mode){state.errandMode=mode;}setPage('order');}
  function renderNav() {
    var active = ['request','payment','order','trip'].indexOf(state.page)>=0?'errands':['ride-offer','ride-booking'].indexOf(state.page)>=0?'rides':state.page;
    ['sideNav','mobileNav'].forEach(function(id){
      var el=document.getElementById(id);
      el.innerHTML=nav.map(function(n){return '<button class="'+(id==='mobileNav'?'':'nav-button ')+(active===n.id?'active':'')+'" data-go="'+n.id+'" aria-current="'+(active===n.id?'page':'false')+'">'+ico(n.icon)+'<span>'+n.title+'</span></button>';}).join('');
    });
  }
  function home(){
    var open=state.requests.filter(function(o){return o.status==='open';}).length;
    var live=state.requests.filter(function(o){return ['accepted','picking','picked'].indexOf(o.status)>=0;}).length;
    return title('MIT-ADT campus network','Good to see you.','One campus. Shared journeys. Everyday help.')+
      '<div class="hero"><div class="hero-copy"><div class="eyebrow" style="color:#594c12">Go together · Get things done</div><h2>A little help,<br>a lot closer.</h2><p>Find a ride or get something picked up by a student already heading your way.</p>'+btn('new-request','Request an item '+ico('arrow'),'dark')+'</div><div class="hero-art"><div class="art-circle">'+ico('route')+'</div></div></div>'+
      '<div class="service-grid">'+
      '<div class="service-card"><div class="tile-icon">'+ico('car')+'</div><h3>Pool a ride</h3><p>Find a seat, or offer your next trip.</p>'+btn('find-ride','Explore rides '+ico('arrow'),'ghost sm')+'</div>'+
      '<div class="service-card alt"><div class="tile-icon">'+ico('bag')+'</div><h3>Pool an errand</h3><p>Request essentials or earn on an existing trip.</p>'+btn('show-errands','Explore errands '+ico('arrow'),'ghost sm')+'</div></div>'+
      '<div class="section-row"><h2 class="section-title">Around campus</h2>'+btn('show-errands','Browse requests '+ico('arrow'),'ghost sm')+'</div>'+
      '<div class="three-stats"><div class="stat"><div class="stat-number">'+open+'</div><div class="stat-label">Sample open errands</div></div><div class="stat"><div class="stat-number">'+live+'</div><div class="stat-label">In progress</div></div><div class="stat"><div class="stat-number">'+state.rides.length+'</div><div class="stat-label">Sample rides</div></div></div>'+
      '<div class="section-row"><h2 class="section-title">Recent requests</h2></div><div class="list">'+state.requests.slice(0,3).map(function(o){return orderCard(o,true);}).join('')+'</div>'+
      '<div class="section-row"><h2 class="section-title">Built around students</h2></div>'+
      '<div class="two-col"><div class="banner">'+ico('shield')+'<span><strong>One campus identity</strong><br>Future production verification can use the existing CampusPool student identity system. Every profile shown here is fictional.</span></div><div class="banner">'+ico('wallet')+'<span><strong>Payments are simulated</strong><br>No money is collected, held, transferred or paid out by this prototype.</span></div></div>';
  }
  function rideCard(r) {
    var booked=state.bookings.some(function(x){return x.rideId===r.id;});
    var mine=!!r.mine;
    return '<article class="list-item"><div class="avatar">'+escapeHtml(r.initials)+'</div><div class="item-content">'+
      '<div class="item-title">'+escapeHtml(r.from)+' → '+escapeHtml(r.to)+'</div><div class="item-sub">'+escapeHtml(r.when)+' · '+escapeHtml(r.vehicle)+' · '+escapeHtml(r.name)+'</div><div class="item-meta">★ '+escapeHtml(r.rating||'New')+' · '+(r.seats)+' seat'+(r.seats===1?'':'s')+' available</div></div>'+
      '<div class="item-right"><span class="amount">'+rupees(r.price)+'</span><span class="item-sub">per seat</span>'+
      (mine?tag('Your offer','green'):booked?tag('Requested','green'):btn('book-ride','Request seat','primary sm','data-id="'+escapeHtml(r.id)+'"'))+
      '</div></article>';
  }
  function rides(){
    var filtered=state.rides.filter(function(r){return state.rideFilter==='All'||r.vehicle===state.rideFilter;});
    return title('Shared journeys','Rides','Find a carpool or offer a seat. These listings are examples for the prototype.')+
      '<div class="toolbar"><div class="segment">'+
      '<button data-action="ride-mode" data-value="find" class="'+(state.rideMode==='find'?'selected':'')+'">Find a ride</button>'+
      '<button data-action="ride-mode" data-value="offer" class="'+(state.rideMode==='offer'?'selected':'')+'">My offers</button></div>'+
      btn('new-ride',ico('plus')+' Offer a ride','primary')+'</div>'+
      (state.rideMode==='find'?'<div class="chips">'+['All','Car','Bike'].map(function(v){return '<button class="chip '+(state.rideFilter===v?'active':'')+'" data-action="ride-filter" data-value="'+v+'">'+v+'</button>';}).join('')+'</div>'+
      '<div class="list">'+(filtered.length?filtered.map(rideCard).join(''):cardEmpty('car','No rides match','Try a different vehicle filter.'))+'</div>':
      '<div class="list">'+(state.rides.filter(function(r){return r.mine;}).map(rideCard).join('')||cardEmpty('car','No ride offers yet','Create a demo ride to see it listed here.','new-ride','Offer a ride'))+'</div>')+
      '<div class="section-row"><h2 class="section-title">Ride experience</h2></div><div class="banner">'+ico('info')+'<span>The existing production ride service is not loaded here. Ride bookings and offers in this prototype are locally simulated, and do not interact with current listings.</span></div>';
  }
  function requestForm(){
    var d=state.draft||{item:'',shop:'Main Canteen',location:'Hostel B gate',cost:40,reward:10,notes:''};
    var cost=Number(d.cost)||0,reward=Number(d.reward)||0;
    return '<div class="page-head compact"><div>'+back('errands')+'<div class="eyebrow">Errands / Step 1 of 2</div><h1>Request an item</h1><p>Tell nearby students what you need and what you will pay.</p></div></div>'+
      '<div class="stepper"><span class="step done"></span><span class="step"></span></div>'+
      '<div class="two-col"><form id="requestForm" class="card" novalidate>'+
      '<div class="field"><label for="item">What do you need?</label><input id="item" name="item" required maxlength="90" placeholder="e.g. One cold coffee" value="'+escapeHtml(d.item)+'"><div class="help">Campus essentials only. No age-restricted or prohibited goods.</div></div>'+
      '<div class="form-grid"><div class="field"><label for="shop">From which shop?</label><select id="shop" name="shop">'+['Main Canteen','Campus Stationery','Main Gate Tea Stall','Food Court','Campus Convenience Store'].map(function(v){return '<option '+(d.shop===v?'selected':'')+'>'+v+'</option>';}).join('')+'</select></div>'+
      '<div class="field"><label for="location">Deliver to</label><select id="location" name="location">'+['Hostel B gate','Hostel A reception','Hostel C gate','Library entrance','Main academic block'].map(function(v){return '<option '+(d.location===v?'selected':'')+'>'+v+'</option>';}).join('')+'</select></div></div>'+
      '<div class="form-grid"><div class="field"><label for="cost">Estimated item cost (₹)</label><input id="cost" name="cost" type="number" min="1" max="500" step="1" required value="'+escapeHtml(d.cost)+'"></div>'+
      '<div class="field"><label for="notes">Notes (optional)</label><input id="notes" name="notes" maxlength="140" placeholder="e.g. Less sugar" value="'+escapeHtml(d.notes||'')+'"></div></div>'+
      '<div class="field"><span class="field-title">Reward for the runner</span><div class="radio-row">'+[5,10,15,20].map(function(n){return '<button type="button" class="choice '+(reward===n?'active':'')+'" data-action="reward" data-value="'+n+'">'+rupees(n)+'</button>';}).join('')+'</div><div class="help">This is what a student earns on top of reimbursement.</div></div>'+
      '<div id="requestError" class="field error" role="alert" hidden></div>'+
      '<button type="submit" class="btn primary block">Review order '+ico('arrow')+'</button></form>'+
      '<div><div class="card soft"><h3>Estimated total</h3><div id="draftSummary">'+moneyRow('Item estimate',cost)+moneyRow('Runner reward',reward)+moneyRow('Platform fee (demo)',fee)+moneyRow('Your total',cost+reward+fee,'total')+'</div></div><div class="notice" style="margin-top:14px">'+ico('pin')+'<span>Choose a shared campus handover point. Do not include private hostel room numbers.</span></div></div></div>';
  }
  function payView(){
    var d=state.draft;
    if(!d) return cardEmpty('bag','No draft order','Start a request to continue.','new-request','Create request');
    var total=Number(d.cost)+Number(d.reward)+fee;
    return '<div class="page-head compact"><div>'+back('errands')+'<div class="eyebrow">Errands / Step 2 of 2</div><h1>Review & simulate payment</h1><p>Preview the amount before your request is broadcast.</p></div></div>'+
    '<div class="stepper"><span class="step done"></span><span class="step done"></span></div>'+
    '<div class="two-col"><div class="card"><div class="eyebrow">Order summary</div><h3 style="margin-top:10px">'+escapeHtml(d.item)+'</h3>'+
    '<div class="item-sub">'+ico('pin')+' '+escapeHtml(d.shop)+' → '+escapeHtml(d.location)+'</div>'+
    '<div class="summary" style="margin:19px 0">'+moneyRow('Item estimate',d.cost)+moneyRow('Runner reward',d.reward)+moneyRow('Platform fee (demo)',fee)+moneyRow('Total',total,'total')+'</div>'+
    '<div class="field"><span class="field-title">Payment method (simulation only)</span><div class="radio-row">'+
    '<button class="choice '+(state.selectedPayment==='upi'?'active':'')+'" data-action="payment-method" data-value="upi">UPI simulation</button>'+
    '<button class="choice '+(state.selectedPayment==='wallet'?'active':'')+'" data-action="payment-method" data-value="wallet">Wallet simulation</button></div></div>'+
    '<div class="notice green">'+ico('lock')+'<span>Demo checkout. No payment provider, UPI intent, bank authorization, escrow account or real settlement is involved.</span></div>'+
    btn('simulate-payment','Simulate payment · '+rupees(total)+' '+ico('arrow'),'primary block','style="margin-top:18px"')+'</div>'+
    '<div class="card soft"><h3>What happens next?</h3><div class="list">'+
    '<div class="item-sub">1. Your request appears in the nearby request feed.</div>'+
    '<div class="item-sub">2. Switch to runner mode to accept it.</div>'+
    '<div class="item-sub">3. Simulate pickup and confirm the 4-digit handover PIN.</div>'+
    '<div class="item-sub">4. The prototype marks the simulated payout complete.</div>'+
    '</div></div></div>';
  }
  function orderCard(o,compact) {
    var completed=o.status==='delivered';
    return '<article class="list-item"><div class="item-icon">'+ico(o.shop.toLowerCase().includes('stationery')?'book':'coffee')+'</div>'+
      '<div class="item-content"><div class="item-title">'+escapeHtml(o.item)+'</div><div class="item-sub">'+escapeHtml(o.shop)+' → '+escapeHtml(o.location)+'</div><div class="item-meta">'+statusTag(o)+' <span style="margin-left:7px">'+escapeHtml(o.created)+'</span></div></div>'+
      '<div class="item-right"><span class="amount green">+'+rupees(o.reward)+' reward</span>'+
      btn('open-order',completed?'View details':'View order','ghost sm','data-id="'+escapeHtml(o.id)+'"')+'</div></article>';
  }
  function errands(){
    var runner=state.errandMode==='runner';
    var requests=state.requests.filter(function(o){
      var canSee = runner ? (o.status==='open' || o.runner==='Demo student') : !o.demo;
      return canSee && (state.errandFilter==='All'||(state.errandFilter==='Food'?(o.shop.toLowerCase().includes('canteen')||o.shop.toLowerCase().includes('tea')||o.shop.toLowerCase().includes('food')):o.shop.toLowerCase().includes('stationery')));
    });
    return title('Student-to-student delivery','Errands','Get something from a nearby shop, or earn while you are already out.')+
      '<div class="toolbar"><div class="segment">'+
      '<button data-action="errand-mode" data-value="requester" class="'+(!runner?'selected':'')+'">I need something</button>'+
      '<button data-action="errand-mode" data-value="runner" class="'+(runner?'selected':'')+'">I am going out</button></div>'+
      (runner?btn('new-trip',ico('plus')+' Announce a trip','primary'):btn('new-request',ico('plus')+' New request','primary'))+'</div>'+
      (runner?'<div class="banner">'+ico('route')+'<span><strong>Earn on your existing route.</strong> Accept only requests you can carry, buy and hand over without an unwanted detour. This is a demonstration feed.</span></div>':
      '<div class="banner">'+ico('shield')+'<span>Requests are shown to a limited campus audience in the prototype. Real-money transactions and student verification are not enabled.</span></div>')+
      (runner && state.trips.length?'<div class="section-row"><h2 class="section-title">Your announced trips</h2></div><div class="list">'+state.trips.map(function(t){return '<div class="list-item"><div class="item-icon">'+ico('pin')+'</div><div class="item-content"><div class="item-title">'+escapeHtml(t.shop)+'</div><div class="item-sub">Returning to '+escapeHtml(t.location)+' · '+escapeHtml(t.eta)+'</div></div>'+tag('Active','green')+'</div>';}).join('')+'</div>':'')+
      '<div class="section-row"><h2 class="section-title">'+(runner?'Available requests':'Your requests')+'</h2><span class="section-desc">'+requests.length+' shown</span></div>'+
      '<div class="chips">'+['All','Food','Stationery'].map(function(x){return '<button class="chip '+(state.errandFilter===x?'active':'')+'" data-action="errand-filter" data-value="'+x+'">'+x+'</button>';}).join('')+'</div>'+
      '<div class="list">'+(requests.length?requests.map(orderCard).join(''):cardEmpty('bag',runner?'Nothing available right now':'No requests placed yet',runner?'New requests will appear here as the demo progresses.':'Your simulated orders will show up here.',runner?'new-trip':'new-request',runner?'Announce a trip':'Create a request'))+'</div>'+
      '<div class="section-row"><h2 class="section-title">How it works</h2></div><div class="three-stats"><div class="stat"><div class="stat-number">01</div><div class="stat-label">Post or pick a request</div></div><div class="stat"><div class="stat-number">02</div><div class="stat-label">Buy on your existing trip</div></div><div class="stat"><div class="stat-number">03</div><div class="stat-label">Confirm delivery with PIN</div></div></div>';
  }
  function tripForm() {
    return '<div class="page-head compact"><div>'+back('errands')+'<div class="eyebrow">Runner / Trip announcement</div><h1>I am going somewhere</h1><p>Let nearby students know where you are already headed.</p></div></div>'+
    '<div class="two-col"><form class="card" id="tripForm">'+
    '<div class="field"><label for="tripShop">Where are you going?</label><select id="tripShop" name="shop" required>'+['Main Canteen','Campus Stationery','Main Gate Tea Stall','Food Court','Campus Convenience Store'].map(function(v){return '<option>'+v+'</option>';}).join('')+'</select></div>'+
    '<div class="field"><label for="tripLocation">Where are you returning?</label><select id="tripLocation" name="location">'+['Hostel B gate','Hostel A reception','Hostel C gate','Library entrance','Main academic block'].map(function(v){return '<option>'+v+'</option>';}).join('')+'</select></div>'+
    '<div class="field"><label for="tripEta">Approximate arrival</label><select id="tripEta" name="eta"><option>In 5 minutes</option><option>In 10 minutes</option><option>In 15 minutes</option><option>In 20 minutes</option></select></div>'+
    '<button class="btn primary block" type="submit">Announce demo trip '+ico('arrow')+'</button></form>'+
    '<div class="notice">'+ico('info')+'<span>This announces a simulated trip locally in your browser. No location tracking, push notification or real matching occurs.</span></div></div>';
  }
  function orderView() {
    var o=getActive();if(!o)return cardEmpty('clipboard','Order not found','Choose an existing errand from Activity.','show-errands','Browse errands');
    var runner=state.errandMode==='runner';
    var current = ({open:0,accepted:1,picking:1,picked:2,delivered:3,cancelled:-1})[o.status];
    var stages=['Requested','Accepted','Picked up','Delivered'];
    var receipt=moneyRow('Item estimate',o.cost)+moneyRow('Runner reward',o.reward)+moneyRow('Platform fee',o.fee)+moneyRow('Customer total',totalFor(o),'total');
    var instructions='';
    if(runner){
      if(o.status==='open') instructions='<div class="notice">'+ico('info')+'<span>Accept this request only if it suits your trip. The customer payment is simulated.</span></div>'+btn('accept-order','Accept request · Earn '+rupees(o.reward),'primary block');
      else if(o.runner !== 'Demo student') instructions='<div class="notice">'+ico('alert')+'<span>This request is assigned to another demo runner.</span></div>';
      else if(o.status==='accepted') instructions='<div class="notice">'+ico('pin')+'<span>Head to '+escapeHtml(o.shop)+' and purchase the requested item using your own money (simulated).</span></div>'+btn('start-pickup','I am at the shop '+ico('arrow'),'primary block');
      else if(o.status==='picking') instructions='<div class="notice">'+ico('receipt')+'<span>Check the item and estimated amount. In this prototype no money is spent or receipt uploaded.</span></div>'+btn('mark-picked','Mark as picked up '+ico('arrow'),'primary block');
      else if(o.status==='picked') instructions='<div class="notice">'+ico('lock')+'<span>Ask the requester for their 4-digit handover PIN. Do not confirm before the item is handed over.</span></div><form id="pinForm"><div class="field"><label for="handoverPin">Delivery PIN</label><input id="handoverPin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" minlength="4" placeholder="4-digit PIN" autocomplete="off" required></div><div id="pinError" class="field error" hidden role="alert"></div><button type="submit" class="btn primary block">Confirm simulated delivery</button></form>';
      else if(o.status==='delivered') instructions='<div class="notice green">'+ico('check')+'<span>Delivery complete. Simulated reimbursement and reward recorded in your demo earnings.</span></div>';
    } else {
      if(o.status==='open') instructions='<div class="notice">'+ico('bell')+'<span>Broadcasting your request in the demo. Switch to runner mode below to simulate acceptance.</span></div>'+btn('switch-runner','Switch to runner view','ghost block');
      if(['accepted','picking','picked'].indexOf(o.status)>=0) instructions='<div class="notice green">'+ico('check')+'<span>A demo runner accepted your request. Only share the PIN at handover.</span></div><div style="margin:13px 0 0"><div class="eyebrow">Your handover PIN</div><div class="pin">'+o.pin.split('').map(function(s){return '<span>'+s+'</span>';}).join('')+'</div></div>'+btn('switch-runner','Switch to runner view','ghost block');
      if(o.status==='delivered') instructions='<div class="notice green">'+ico('check')+'<span>Your order was delivered in the simulation. The payment and payout are demo records only.</span></div>';
    }
    if(o.status==='cancelled')instructions='<div class="notice">'+ico('info')+'<span>This demo request was cancelled. No real refund is necessary.</span></div>';
    return '<div class="page-head compact"><div>'+back('activity')+'<div class="eyebrow">Errand / '+escapeHtml(o.id)+'</div><h1>'+escapeHtml(o.status==='delivered'?'Order completed':orderStatus(o))+'</h1><p>'+escapeHtml(o.item)+' · '+escapeHtml(o.location)+'</p></div></div>'+
    '<div class="toolbar"><div class="segment"><button data-action="errand-mode" data-value="requester" class="'+(!runner?'selected':'')+'">Requester view</button><button data-action="errand-mode" data-value="runner" class="'+(runner?'selected':'')+'">Runner view</button></div>'+statusTag(o)+'</div>'+
    '<div class="two-col"><div class="card"><h3>Delivery progress</h3><div class="progress">'+stages.map(function(s,i){return '<div class="progress-node '+(i<current?'done':i===current?'current':'')+'">'+escapeHtml(s)+'</div>';}).join('')+'</div>'+
    '<div class="list-item" style="margin-bottom:17px"><div class="item-icon">'+ico('bag')+'</div><div class="item-content"><div class="item-title">'+escapeHtml(o.item)+'</div><div class="item-sub">From '+escapeHtml(o.shop)+'<br>To '+escapeHtml(o.location)+'</div></div></div>'+
    (o.runner?'<div class="list-item" style="margin-bottom:17px"><div class="avatar sm">DS</div><div class="item-content"><div class="item-title">Demo student · Runner</div><div class="item-sub">Sample identity · Not a verified real person</div></div>'+tag('Assigned','green')+'</div>':'')+
    '<div style="display:grid;gap:12px">'+instructions+'</div>'+
    (o.status==='open'&&!runner&&!o.demo?'<div style="margin-top:14px">'+btn('cancel-order','Cancel demo request','danger block')+'</div>':'')+'</div>'+
    '<div><div class="card soft"><h3>Payment breakdown</h3><div class="summary">'+receipt+'</div><p style="margin:12px 0 0">Simulation only · No money is held or transferred.</p></div><div class="notice" style="margin-top:15px">'+ico('shield')+'<span>Production version: use campus verification, safe handover locations, disputes, and regulated payment-provider settlement.</span></div></div></div>';
  }
  function activity(){
    var mine=state.requests.filter(function(o){return !o.demo;});
    var delivery=state.requests.filter(function(o){return o.runner==='Demo student';});
    return title('Your campus activity','Activity','Track your demo requests, runner deliveries and ride bookings.')+
      '<div class="section-row first"><h2 class="section-title">My errands</h2>'+btn('new-request',ico('plus')+' New request','ghost sm')+'</div>'+
      '<div class="list">'+(mine.length?mine.map(orderCard).join(''):cardEmpty('bag','No personal requests','Create a request and complete its simulated payment to see it here.','new-request','New request'))+'</div>'+
      '<div class="section-row"><h2 class="section-title">Runner deliveries</h2></div><div class="list">'+(delivery.length?delivery.map(orderCard).join(''):cardEmpty('route','No accepted errands','Switch to runner mode and accept a request.','show-runner','Browse requests'))+'</div>'+
      '<div class="section-row"><h2 class="section-title">Ride seat requests</h2></div>'+
      '<div class="list">'+(state.bookings.length?state.bookings.map(function(b){var r=state.rides.find(function(x){return x.id===b.rideId;});return '<div class="list-item"><div class="item-icon">'+ico('car')+'</div><div class="item-content"><div class="item-title">'+escapeHtml(r?r.to:'Ride')+'</div><div class="item-sub">Seat request '+escapeHtml(b.id)+' · '+escapeHtml(r?r.when:'')+'</div></div>'+tag('Simulated','yellow')+'</div>';}).join(''):cardEmpty('car','No seat requests','Find a sample ride to try the booking flow.','find-ride','Explore rides'))+'</div>';
  }
  function profile(){
    var earned=state.requests.filter(function(o){return o.status==='delivered'&&o.runner==='Demo student';}).reduce(function(a,o){return a+o.cost+o.reward;},0);
    var delivery=state.requests.filter(function(o){return o.status==='delivered'&&o.runner==='Demo student';}).length;
    return title('Campus account','Your profile','An example student profile. No login or identity verification is performed in this prototype.')+
      '<div class="two-col"><div><div class="card"><div class="profile-header"><div class="avatar lg">CP</div><div><h2>Demo student</h2><p>MIT-ADT University · Concept account</p><div style="margin-top:8px">'+tag('Verification preview','yellow')+'</div></div></div>'+
      '<div class="profile-row"><span>Campus</span><strong>MIT-ADT University</strong></div>'+
      '<div class="profile-row"><span>Student verification</span><strong>Demo only</strong></div>'+
      '<div class="profile-row"><span>Preferred pickup</span><strong>Hostel B gate</strong></div>'+
      '<div class="profile-row"><span>Notifications</span><strong>In-app demo</strong></div></div>'+
      '<div class="section-row"><h2 class="section-title">Preferences</h2></div><div class="card">'+
      '<div class="profile-row"><span>Campus visibility</span>'+tag('Campus-only preview')+'</div>'+
      '<div class="profile-row"><span>Location tracking</span>'+tag('Off')+'</div>'+
      '<div class="profile-row"><span>Payment account</span>'+tag('Not connected')+'</div>'+
      '<div class="profile-row"><span>Demo data</span>'+btn('reset','Reset all','ghost sm')+'</div></div></div>'+
      '<div><div class="card soft"><div class="eyebrow">Simulated earnings</div><div class="order-total">'+rupees(earned)+'</div><p>Reimbursements and rewards from completed demo deliveries.</p>'+
      '<div class="three-stats" style="margin-top:19px"><div class="stat"><div class="stat-number">'+delivery+'</div><div class="stat-label">Deliveries</div></div><div class="stat"><div class="stat-number">'+state.bookings.length+'</div><div class="stat-label">Seat requests</div></div><div class="stat"><div class="stat-number">'+state.trips.length+'</div><div class="stat-label">Shop trips</div></div></div></div>'+
      '<div class="notice" style="margin-top:15px">'+ico('lock')+'<span>No identity documents, personal location data, bank details or UPI credentials are requested or saved in this prototype.</span></div></div></div>';
  }
  function rideOffer(){
    return '<div class="page-head compact"><div>'+back('rides')+'<div class="eyebrow">Ride sharing / Demo</div><h1>Offer a ride</h1><p>Preview how posting a ride fits into CampusPool 2.0.</p></div></div>'+
      '<div class="two-col"><form class="card" id="rideOfferForm">'+
      '<div class="field"><label for="rideDest">Destination</label><select id="rideDest" name="to">'+['Hadapsar','Pune Railway Station','Wagholi','Viman Nagar','Swargate'].map(function(t){return '<option>'+t+'</option>';}).join('')+'</select></div>'+
      '<div class="form-grid"><div class="field"><label for="rideVehicle">Vehicle</label><select name="vehicle" id="rideVehicle"><option>Car</option><option>Bike</option></select></div><div class="field"><label for="ridePrice">Seat price (₹)</label><input type="number" min="1" max="2000" name="price" id="ridePrice" required value="65"></div></div>'+
      '<div class="form-grid"><div class="field"><label for="rideSeats">Seats</label><select name="seats" id="rideSeats"><option>1</option><option selected>2</option><option>3</option><option>4</option></select></div><div class="field"><label for="rideWhen">Departure</label><select id="rideWhen" name="when"><option>Today · 5:30 PM</option><option>Today · 6:15 PM</option><option>Tomorrow · 9:00 AM</option></select></div></div>'+
      '<button class="btn primary block" type="submit">Create demo ride '+ico('arrow')+'</button></form>'+
      '<div class="notice">'+ico('info')+'<span>Offers created here stay in your browser. Existing ride inventory, pricing rules and live bookings remain untouched.</span></div></div>';
  }
  function rideBooking(){
    var r=state.rides.find(function(x){return x.id===state.activeId;});if(!r)return cardEmpty('car','Ride unavailable','Choose a sample ride from the feed.','find-ride','Find rides');
    return '<div class="page-head compact"><div>'+back('rides')+'<div class="eyebrow">Seat request / Demo</div><h1>Confirm ride request</h1><p>This is an interactive preview. The driver will not receive a real booking.</p></div></div>'+
      '<div class="two-col"><div class="card"><div class="list-item"><div class="avatar">'+escapeHtml(r.initials)+'</div><div class="item-content"><div class="item-title">'+escapeHtml(r.name)+'</div><div class="item-sub">'+escapeHtml(r.vehicle)+' · '+escapeHtml(r.when)+'</div></div></div>'+
      '<div style="margin:17px 0"><div class="item-title">'+escapeHtml(r.from)+' → '+escapeHtml(r.to)+'</div></div>'+
      '<div class="summary">'+moneyRow('Seat price',r.price)+moneyRow('Total shown (simulation)',r.price,'total')+'</div>'+
      btn('confirm-ride','Request seat (demo) '+ico('arrow'),'primary block','style="margin-top:19px"')+'</div>'+
      '<div class="notice">'+ico('shield')+'<span>No payment is initiated, and the real CampusPool ride booking endpoint is not called.</span></div></div>';
  }
  function render(){
    renderNav();
    var pages={home:home,rides:rides,errands:errands,request:requestForm,payment:payView,order:orderView,trip:tripForm,activity:activity,profile:profile,'ride-offer':rideOffer,'ride-booking':rideBooking};
    document.getElementById('view').innerHTML = (pages[state.page]||home)();
    document.title='CampusPool 2.0 · '+state.page.charAt(0).toUpperCase()+state.page.slice(1)+' (Demo)';
    save();
  }
  function captureDraft(){
    var form=document.getElementById('requestForm');if(!form)return;
    var data=new FormData(form);
    state.draft={item:String(data.get('item')||'').trim(),shop:String(data.get('shop')||''),location:String(data.get('location')||''),cost:Number(data.get('cost')),reward:state.draft?Number(state.draft.reward):10,notes:String(data.get('notes')||'').trim()};
    save();
  }
  document.addEventListener('input',function(e){
    if(e.target.closest('#requestForm') && e.target.name){captureDraft();var sum=document.getElementById('draftSummary');if(sum){var d=state.draft;sum.innerHTML=moneyRow('Item estimate',d.cost)+moneyRow('Runner reward',d.reward)+moneyRow('Platform fee (demo)',fee)+moneyRow('Your total',d.cost+d.reward+fee,'total');}}
  });
  document.addEventListener('change',function(e){
    if(e.target.closest('#requestForm') && e.target.name)captureDraft();
  });
  document.addEventListener('submit',function(e){
    if(e.target.id==='requestForm'){
      e.preventDefault();captureDraft();
      var d=state.draft;var el=document.getElementById('requestError');
      var restricted=/\b(cigarette|cigarettes|tobacco|vape|alcohol|beer|whisky|vodka|medicine|drug|drugs)\b/i;
      if(d.item.length<3 || d.cost<1 || d.cost>500 || !Number.isFinite(d.cost) || restricted.test(d.item)){
        el.hidden=false;el.textContent=restricted.test(d.item)?'This category is not permitted in this campus prototype.':'Enter a valid item (at least 3 characters) and estimated cost from ₹1 to ₹500.';return;
      }
      setPage('payment');return;
    }
    if(e.target.id==='tripForm'){
      e.preventDefault();var t=new FormData(e.target);
      state.trips.unshift({id:'TR-'+Date.now(),shop:String(t.get('shop')),location:String(t.get('location')),eta:String(t.get('eta'))});
      state.errandMode='runner';save();notify('Your demo shop trip is now active.');setPage('errands');return;
    }
    if(e.target.id==='pinForm'){
      e.preventDefault();
      var o=getActive();var val=String(document.getElementById('handoverPin').value||'').trim();var error=document.getElementById('pinError');
      if(!o || o.status!=='picked' || o.runner!=='Demo student')return;
      if(val!==o.pin){error.hidden=false;error.textContent='Incorrect PIN. Ask the requester for the handover code.';return;}
      o.status='delivered';o.deliveredAt=Date.now();state.deliveryCount++;state.wallet+=o.cost+o.reward;
      save();notify('Delivery completed. Demo earnings recorded.');setPage('order');return;
    }
    if(e.target.id==='rideOfferForm'){
      e.preventDefault();var v=new FormData(e.target),price=Number(v.get('price')),vehicle=String(v.get('vehicle')),seats=Number(v.get('seats'));
      if(!Number.isFinite(price)||price<1||price>2000){notify('Enter a fare between ₹1 and ₹2,000.');return;}
      if(vehicle==='Bike') seats=1;
      state.rides.unshift({id:'RD-'+Date.now(),name:'Demo student',initials:'CP',from:'MIT-ADT Main Gate',to:String(v.get('to')),when:String(v.get('when')),price:price,seats:seats,vehicle:vehicle,rating:'New',mine:true});
      state.rideMode='offer';save();notify('Your demo ride has been created.');setPage('rides');
    }
  });
  document.addEventListener('click',function(e){
    var navBtn=e.target.closest('[data-go]');
    if(navBtn){e.preventDefault();setPage(navBtn.getAttribute('data-go'));return;}
    var el=e.target.closest('[data-action]');if(!el)return;
    var action=el.getAttribute('data-action'),value=el.getAttribute('data-value'),id=el.getAttribute('data-id');
    if(action==='new-request'){state.draft={item:'',shop:'Main Canteen',location:'Hostel B gate',cost:40,reward:10,notes:''};setPage('request');return;}
    if(action==='reward'){captureDraft();state.draft.reward=Number(value);save();render();return;}
    if(action==='simulate-payment'){
      var d=state.draft;if(!d){setPage('request');return;}
      var record={id:'ER-'+String(Date.now()).slice(-7),item:d.item,shop:d.shop,location:d.location,cost:d.cost,reward:d.reward,fee:fee,notes:d.notes,status:'open',paid:true,requester:'Demo student',requesterInitials:'CP',pin:String(Math.floor(1000+Math.random()*9000)),runner:null,created:'Just now',demo:false,paymentMethod:state.selectedPayment};
      state.requests.unshift(record);state.draft=null;state.activeId=record.id;state.errandMode='requester';save();notify('Payment simulated. Request broadcast in demo.');setPage('order');return;
    }
    if(action==='payment-method'){state.selectedPayment=value;save();render();return;}
    if(action==='open-order'){goOrder(id);return;}
    if(action==='ride-mode'){state.rideMode=value;setPage('rides');return;}
    if(action==='ride-filter'){state.rideFilter=value;setPage('rides');return;}
    if(action==='errand-mode'){state.errandMode=value;if(state.page==='order'){save();render();}else setPage('errands');return;}
    if(action==='errand-filter'){state.errandFilter=value;setPage('errands');return;}
    if(action==='show-errands'){setPage('errands');return;}
    if(action==='show-runner'){state.errandMode='runner';setPage('errands');return;}
    if(action==='switch-runner'){state.errandMode='runner';save();render();return;}
    if(action==='find-ride'){state.rideMode='find';setPage('rides');return;}
    if(action==='new-trip'){setPage('trip');return;}
    if(action==='new-ride'){setPage('ride-offer');return;}
    if(action==='book-ride'){state.activeId=id;setPage('ride-booking');return;}
    if(action==='confirm-ride'){
      var ride=state.rides.find(function(x){return x.id===state.activeId;});if(!ride)return;
      if(!state.bookings.some(function(x){return x.rideId===ride.id;}))state.bookings.unshift({id:'BK-'+Date.now(),rideId:ride.id});
      save();notify('Seat request saved as a demo.');setPage('activity');return;
    }
    if(action==='accept-order'){
      var order=getActive();if(!order||order.status!=='open')return;
      order.status='accepted';order.runner='Demo student';save();notify('Request accepted. Your simulated errand has begun.');render();return;
    }
    if(action==='start-pickup'){
      var order=getActive();if(order&&order.runner==='Demo student'&&order.status==='accepted'){order.status='picking';save();notify('Marked as at the shop.');render();}return;
    }
    if(action==='mark-picked'){
      var order=getActive();if(order&&order.runner==='Demo student'&&order.status==='picking'){order.status='picked';save();notify('Item marked as picked up.');render();}return;
    }
    if(action==='cancel-order'){
      var order=getActive();if(order && !order.demo&&order.status==='open'){order.status='cancelled';save();notify('Demo request cancelled. No money was moved.');render();}return;
    }
    if(action==='notifications'){notify('This concept does not send real notifications.');return;}
    if(action==='reset'){
      if(window.confirm('Reset all locally simulated orders, bookings, rides and earnings?')){
        try{localStorage.removeItem(KEY);}catch(err){}
        state=fresh();notify('Demo data reset.');setPage('home');
      }return;
    }
  });
  window.addEventListener('storage',function(e){if(e.key===KEY){try{var s=JSON.parse(e.newValue);if(s){state=Object.assign(fresh(),s);render();}}catch(err){}}});
  render();
})();