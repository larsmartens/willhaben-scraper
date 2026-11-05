import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getProvider, buildSearchLink} from '../src/providers.mjs';
const live=()=>getProvider('live',{LIVE_ACCESS:'authorized'});
const code=c=>error=>error.code===c;
const embed=props=>new Response('<html><script type="application/json" id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:props}})+'</script></html>',{headers:{'content-type':'text/html'}});
const rawRow=(id)=>({id:String(id),verticalId:5,description:'Kugel',attributes:{attribute:[{name:'PRICE',values:['12.5']},{name:'SEO_URL',values:['kaufen-und-verkaufen/d/kugel-'+id]}]}});
const page=(ids,page=1,total=null)=>({searchResult:{verticalId:5,pageRequested:page,...(total===null?{}:{rowsFound:total}),rowsReturned:ids.length,advertSummaryList:{advertSummary:ids.map(rawRow)}}});
test('native search links encode user input and scope filters without fetching',()=>{
  const q='Lampen+Glas &Set', u=new URL(buildSearchLink(q,{areaId:900,priceMax:30,condition:'as_new',attributeIds:[725],categoryId:123,paylivery:true}));
  assert.equal(u.origin,'https://www.willhaben.at');
  assert.equal(u.searchParams.get('keyword'),q);
  assert.equal(u.searchParams.get('areaId'),'900');
  assert.deepEqual(u.searchParams.getAll('treeAttributes'),['2546','725']);
  for(const [filters,err] of [[{city:'Vienna'},'invalid_input'],[{shipping:'shipping'},'unsupported_filter'],[{paylivery:false},'unsupported_filter'],[{priceMin:100,priceMax:1},'invalid_input']]) assert.throws(()=>buildSearchLink('x',filters),code(err));
});
test('demo data distinguishes evidence for shape and unknown dimensions from contradictory offers',async()=>{
  const p=getProvider('demo'), record=await p.detail('demo-glass-03');
  assert.equal(record.attributes.shape,'round');
  assert.equal(record.attributes.openingMm,undefined);
  assert.equal((await p.detail('demo-glass-04')).attributes.shape,'cylinder');
  const facets=await p.facets({query:'iPhone',filters:{condition:'used',areaId:900}});
  assert.equal(facets.scope,'synthetic catalogue');assert.equal(facets.total,7);
  assert.equal(facets.dimensions.areaId[0].label,'Wien');
});
test('provided data: keyword/exclusions, price sort, known/unknown filters, opaque indices, validation',async()=>{
  const rows=Array.from({length:45},(_,i)=>({id:String(i+1),title:i===1?'Lampe kaputt':'Lampe',price:i===3?null:45-i,location:'Wien',areaId:900,categoryId:1,condition:'used',...(i===3?{shipping:'both',paylivery:false}:{})}));
  const p=getProvider('provided',{},rows), spec={query:'Lampe -kaputt',filters:{areaId:900,sort:'price_asc'}};
  const a=await p.search(spec),b=await p.search({...spec,cursor:a.nextCursor});
  assert.equal(a.total,44);assert.equal(a.items[0].price,1);assert.equal(a.items.length,30);assert.equal(a.end,false);
  assert.equal(b.items.length,14);assert.equal(b.items.at(-1).price,null);assert.equal(b.end,true);
  assert.equal((await p.search({query:'lampe',filters:{shipping:'pickup',paylivery:false}})).items.length,1);
  assert.equal((await p.search({query:'lampe',filters:{sellerType:'dealer'}})).items.length,0);
  assert.equal((await p.detail('4')).price,null);
  assert.equal(await p.detail('no-such'),null);
  for(const listings of [[rows[0],rows[0]],[{...rows[0],url:'https://evil.test/iad/object?adId=1'}],[{...rows[0],price:-1}],[{...rows[0],attributes:{a:[]}}]])assert.throws(()=>getProvider('provided',{},listings),code('invalid_input'));
  await assert.rejects(p.search({query:'lampe',cursor:'https://test.invalid'}),code('invalid_input'));
});
test('server-side permission is required and there is no fallback from live to demo',t=>{
  const fetcher=t.mock.method(globalThis,'fetch',()=>{assert.fail("unexpected upstream fetch");});
  assert.throws(()=>getProvider('live',{}),code('live_access_not_configured'));
  assert.throws(()=>getProvider('live',{LIVE_ACCESS:'true'}),code('live_access_not_configured'));
  assert.equal(fetcher.mock.callCount(),0);
});
test('a smaller upstream page or absent upstream total does not silently truncate',async t=>{
  const responses=[page([1,2],1,5),page([3,4],2,5),page([5],3,5),page([],4,5)];
  const fetcher=t.mock.method(globalThis,'fetch',async (url,init)=>{
    assert.equal(url.origin,'https://www.willhaben.at');assert.equal(init.redirect,'manual');assert.equal(init.headers.Cookie,undefined);
    return embed(responses[Number(url.searchParams.get('page'))-1]);
  });
  const read=live(), ids=[];let cursor=null,pageResult;
  do{pageResult=await read.search({query:'q',cursor});ids.push(...pageResult.items.map(i=>i.id));cursor=pageResult.nextCursor;}while(!pageResult.end);
  assert.deepEqual(ids,['1','2','3','4','5']);assert.equal(fetcher.mock.callCount(),4);
  responses[0]=page([1,2]);const missing=await read.search({query:'q'});
  assert.equal(missing.total,null);assert.equal(missing.end,false);
});
test('schema changes, wrong page, rate limiting, off-site redirect and empty search differ',async t=>{
  let response=()=>embed(page([],1,0));
  t.mock.method(globalThis,'fetch',async()=>response());
  assert.deepEqual(await live().search({query:'q'}),{items:[],end:true,nextCursor:null,total:0});
  for(const [fn,err] of [[()=>embed({searchResult:{rowsFound:0}}),'upstream_schema'],[()=>embed({initialSearchResult:page([1]).searchResult}),'upstream_schema'],[()=>embed(page([1],2,1)),'upstream_schema'],[()=>new Response('',{status:429}),'upstream_rate_limited'],[()=>new Response('',{status:403}),'upstream_forbidden'],[()=>new Response('',{status:301,headers:{Location:'https://evil.invalid'}}),'upstream_redirect']]){
    response=fn;await assert.rejects(live().search({query:'q'}),code(err));
  }
});
test('detail resolves only numeric ids, same-host paths and exact ad identity; omits seller fields',async t=>{
  let calls=[];
  const detail=rawRow(10);detail.attributes.attribute.push({name:'Übergabe',values:['Selbstabholung','Versand']},{name:'CONTACT/PHONE',values:['SECRET']},{name:'Zustand',values:['Wie neu']});
  detail.organisationDetails={orgEmail:'SECRET'};detail.advertImageList={advertImage:[{mainImageUrl:'https://cache.willhaben.at/mmo/i.jpg'},{mainImageUrl:'https://evil.invalid/p'}]};
  t.mock.method(globalThis,'fetch',async u=>{calls.push(u.pathname);return u.pathname==='/iad/object'?new Response('',{status:302,headers:{location:'/iad/kaufen-und-verkaufen/d/glas-10'}}):embed({advertDetails:detail});});
  await assert.rejects(live().detail('https://evil.invalid'),code('invalid_input'));assert.equal(calls.length,0);
  const hit=await live().detail('10');assert.equal(hit.shipping,'both');assert.equal(hit.condition,'as_new');assert.equal(hit.paylivery,undefined);
  assert.equal(hit.images.length,1);assert.equal(JSON.stringify(hit).includes('SECRET'),false);assert.equal(calls.length,2);
  await assert.rejects(live().detail('11'),code('upstream_schema'));
});
test('dynamic facet values round-trip through documented filter inputs only',async t=>{
  const props=page([1],1,1);
  props.searchResult.navigatorGroups=[{navigatorList:[{id:'color',label:'Farbe',possibleValues:[{label:'blau',urlParamRepresentationForValue:[{urlParameterName:'treeAttributes',value:'1234'},{urlParameterName:'redirect',value:'1'}]}]}]}];
  t.mock.method(globalThis,'fetch',async()=>embed(props));
  const f=await live().facets({query:'Lampenschirm'});assert.deepEqual(f.dimensions[0].values,[{label:'blau',filter:'attributeIds',value:1234,count:null}]);
});
test('a page-local count never ends pagination on a populated page',async t=>{
  t.mock.method(globalThis,'fetch',async()=>embed(page([1,2],1,2)));
  const first=await live().search({query:'q'});assert.equal(first.end,false);assert.equal(first.nextCursor,'2');
});
test('structured detail values, title fallback, inactive offers and evidence on category ancestry',async t=>{
  const row=rawRow(100);delete row.description;row.taggingData={tmsDataValues:{tmsData:{ad_title:'Vier Opalgläser'}}};
  row.advertStatus={id:'inactive'};
  row.attributes.attribute.push({name:'categorytreeids',values:['4;22;390']},{name:'REGION_AREA_ID',values:['900']},{name:'AREA_ID',values:['221']},{name:'ALL_IMAGE_URLS',values:['3/aa.jpg;3/bb.jpg']});
  row.attributeInformation=['Modell','Stückzahl','Versandkosten','Öffnungsdurchmesser'].map((k,i)=>({treeAttributeElement:{label:k},values:[{label:['Kugeln M1','4 Stück','EUR 5,30','24 mm'][i]}]}));
  t.mock.method(globalThis,'fetch',async()=>embed({advertDetails:row}));
  const hit=await live().detail('100');
  assert.deepEqual(hit.categoryPathIds,[4,22,390]);assert.deepEqual(hit.areaPathIds,[900,221]);
  assert.deepEqual(hit.images,['https://cache.willhaben.at/mmo/3/aa.jpg','https://cache.willhaben.at/mmo/3/bb.jpg']);
  assert.equal(hit.model,'Kugeln M1');assert.equal(hit.quantity,4);assert.equal(hit.shippingCost,5.3);
  assert.equal(hit.attributes['Öffnungsdurchmesser'],'24 mm');assert.equal(hit.status,'inactive');
});
