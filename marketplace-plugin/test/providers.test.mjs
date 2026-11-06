import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getProvider, buildSearchLink, parseSearchUrl, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE} from '../src/providers.mjs';
const live=()=>getProvider('live',{LIVE_ACCESS:'authorized'});
const code=c=>error=>error.code===c;
const embed=props=>new Response('<html><script type="application/json" id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:props}})+'</script></html>',{headers:{'content-type':'text/html'}});
const rawRow=(id)=>({id:String(id),verticalId:5,description:'Kugel',attributes:{attribute:[{name:'PRICE',values:['12.5']},{name:'SEO_URL',values:['kaufen-und-verkaufen/d/kugel-'+id]}]}});
const page=(ids,page=1,total=null)=>({searchResult:{verticalId:5,pageRequested:page,...(total===null?{}:{rowsFound:total}),rowsReturned:ids.length,advertSummaryList:{advertSummary:ids.map(rawRow)}}});
function cacheEnv() {
  const entries = new Map(), batches = [];
  const validKey=/^(?:search:[a-f0-9]{64}|(?:detail|summary):\d{1,20})$/;
  const gate = {
    async acquire() { return {granted:true}; },
    async getCached(key) { assert.match(key,validKey);return structuredClone(entries.get(key) ?? null); },
    async putCached(values) {
      assert.ok(values.length>0&&values.length<=101);
      batches.push(values.length);
      for (const value of values) {
        assert.match(value.key,validKey);assert.ok(value.value&&typeof value.value==='object'&&!Array.isArray(value.value));
        entries.set(value.key,{...structuredClone(value),expiresAt:new Date(Date.parse(value.observedAt)+value.ttlSeconds*1000).toISOString()});
      }
    }
  };
  return {entries,batches,gate,env:{LIVE_ACCESS:'personal_test',ORIGIN_GATE:{getByName(origin){assert.equal(origin,'https://www.willhaben.at');return gate;}}}};
}
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
  const p=getProvider('provided',{},rows), spec={query:'Lampe -kaputt',filters:{areaId:900,sort:'price_asc'},pageSize:30};
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
  const empty=await live().search({query:'q'});
  assert.deepEqual({items:empty.items,end:empty.end,nextCursor:empty.nextCursor,total:empty.total},{items:[],end:true,nextCursor:null,total:0});
  assert.equal(empty.requestedPageSize,50);assert.equal(empty.returnedCount,0);assert.ok(Number.isFinite(Date.parse(empty.observedAt)));
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
test('personal access supports 50/100 rows, more than 32 pages and repeatable detail reads',async t=>{
  const responses=[];
  const fetcher=t.mock.method(globalThis,'fetch',async (url,init)=>{
    assert.equal(init.headers['User-Agent'].includes('authorized'),false);
    assert.match(init.headers['User-Agent'],/Marktplatz-Studie/);
    assert.equal(init.headers.Authorization,undefined);
    assert.equal(init.headers.Cookie,undefined);
    assert.equal(init.redirect,'manual');
    responses.push(url.pathname);
    if(url.pathname==='/iad/object')return embed({advertDetails:rawRow(url.searchParams.get('adId'))});
    const size=Number(url.searchParams.get('rows')),number=Number(url.searchParams.get('page'));
    assert.ok([50,100].includes(size));
    const ids=number<36?Array.from({length:size},(_,i)=>(number-1)*size+i+1):[];
    const props=page(ids,number,2000);
    props.searchResult.rowsRequested=size;
    props.searchResult.navigatorGroups=[];
    return embed(props);
  });
  const env={LIVE_ACCESS:'personal_test'}, p=getProvider('live',env);
  const first=await p.search({query:'BANKAMP'});
  assert.equal(first.nextCursor,'2');assert.equal(first.end,false);
  assert.equal(first.items.length,DEFAULT_PAGE_SIZE);assert.equal(first.returnedCount,50);
  assert.equal(fetcher.mock.callCount(),1);
  const larger=await p.search({query:'BANKAMP',pageSize:MAX_PAGE_SIZE});
  assert.equal(larger.items.length,100);assert.equal(larger.requestedPageSize,100);
  let last=first;
  while(last.nextCursor)last=await p.search({query:'BANKAMP',cursor:last.nextCursor});
  assert.equal(last.page,36);assert.equal(last.end,true);
  assert.equal((await p.search({query:'BANKAMP',cursor:'100001'})).page,100001);
  assert.deepEqual((await p.facets({query:'BANKAMP'})).dimensions,[]);
  for(const id of ['7','8','9','10'])await p.detail(id);
  assert.equal(responses.filter(v=>v==='/iad/object').length,4);
  for(const pageSize of [0,101,1.5,'100'])await assert.rejects(p.search({query:'BANKAMP',pageSize}),code('invalid_input'));
});
test('origin refusal or challenge stops subsequent reads on the same request',async t=>{
  let response;
  const fetcher=t.mock.method(globalThis,'fetch',async()=>response);
  for(const [status,headers,expected] of [[401,{},'upstream_forbidden'],[403,{},'upstream_forbidden'],[429,{},'upstream_rate_limited'],[200,{'cf-mitigated':'challenge'},'upstream_blocked']]){
    const p=getProvider('live',{LIVE_ACCESS:'personal_test'}), calls=fetcher.mock.callCount();
    response=new Response('stop',{status,headers});
    await assert.rejects(p.search({query:'test'}),code(expected));
    await assert.rejects(p.detail('7'),code(expected));
    assert.equal(fetcher.mock.callCount(),calls+1);
  }
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
test('provided pagination defaults to 50 and supports 100 without losing records or photos',async()=>{
  const photos=Array.from({length:20},(_,i)=>'https://cache.willhaben.at/mmo/a/'+i+'.jpg');
  const rows=Array.from({length:151},(_,i)=>({id:String(i+1),title:'Lampe',price:i,model:'Modell '+i,...(i===0?{images:photos}:{})}));
  const p=getProvider('provided',{},rows);
  const first=await p.search({query:'Lampe'});
  assert.equal(first.items.length,50);assert.equal(first.nextCursor,'2');assert.equal(first.total,151);
  const large=await p.search({query:'Lampe',pageSize:100});
  const rest=await p.search({query:'Lampe',pageSize:100,cursor:large.nextCursor});
  assert.equal(large.items.length,100);assert.equal(rest.items.length,51);assert.equal(rest.end,true);
  assert.equal(new Set([...large.items,...rest.items].map(row=>row.id)).size,151);
  assert.deepEqual((await p.detail('1')).images,photos);
  assert.equal((await p.summary('1')).imageCount,20);
  assert.equal((await p.facets({query:'Lampe'})).dimensions.model.length,151);
});
test('native search URLs preserve keyword, filters, category-only pages and native row offsets',()=>{
  const parsed=parseSearchUrl('https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz/lampen-4000?keyword=Glas+%26+Lampe&PRICE_FROM=0&PRICE_TO=42.5&areaId=900&ISPRIVATE=1&sort=3&paylivery=true&treeAttributes=2546&treeAttributes=725&page=3&rows=100');
  assert.equal(parsed.query,'Glas & Lampe');
  assert.deepEqual(parsed.filters,{priceMin:0,priceMax:42.5,areaId:900,categoryId:4000,sellerType:'private',sort:'price_asc',paylivery:true,condition:'as_new',attributeIds:[725]});
  assert.equal(parsed.page,3);assert.equal(parsed.pageSize,100);assert.equal(parsed.fullyRepresented,true);
  const category=parseSearchUrl('https://willhaben.at/iad/kaufen-und-verkaufen/marktplatz/lampen-4000?page=2');
  assert.equal(category.query,'');assert.equal(category.filters.categoryId,4000);assert.equal(category.pageSize,30);
  assert.equal(category.page,2);
  const link=new URL(buildSearchLink(parsed.query,parsed.filters));
  assert.equal(link.searchParams.get('ATTRIBUTE_TREE'),'4000');
  assert.deepEqual(link.searchParams.getAll('treeAttributes'),['2546','725']);
});
test('native URL parser discloses unsupported filters and rejects conflicting or unsafe URLs',()=>{
  const url='https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz?keyword=Glas&sort=99&paylivery=false&treeAttributes=22&treeAttributes=23&treeAttributes=725&colour=blue&colour=red';
  const parsed=parseSearchUrl(url);
  assert.equal(parsed.fullyRepresented,false);
  assert.deepEqual(parsed.filters,{attributeIds:[725]});
  assert.deepEqual(parsed.unsupportedParameters,[{name:'sort',values:['99']},{name:'paylivery',values:['false']},{name:'treeAttributes',values:['22','23']},{name:'colour',values:['blue','red']}]);
  for(const value of [
    'https://example.org/iad/kaufen-und-verkaufen/marktplatz',
    'https://user:secret@www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz',
    'https://www.willhaben.at/iad/immobilien',
    'https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz?rows=101',
    'https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz?page=1&page=2',
    'https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz?PRICE_FROM=30&PRICE_TO=10'
  ])assert.throws(()=>parseSearchUrl(value),code('invalid_input'));
});
test('three native summary photos merge with twelve full image paths without repeating variants',async t=>{
  const references=Array.from({length:12},(_,i)=>'4/890/209/104_'+i+'.jpg');
  const row=rawRow(890209104);
  row.advertImageList={advertImage:references.slice(0,3).map(reference=>({
    id:1,reference,mainImageUrl:'https://cache.willhaben.at/mmo/'+reference.replace('.jpg','_hoved.jpg'),
    thumbnailImageUrl:'https://cache.willhaben.at/mmo/'+reference.replace('.jpg','_thumb.jpg')
  }))};
  row.attributes.attribute.push({name:'ALL_IMAGE_URLS',values:[references.join(';')]});
  const props=page([],1,40);props.searchResult.advertSummaryList.advertSummary=[row];props.searchResult.rowsReturned=1;
  t.mock.method(globalThis,'fetch',async()=>embed(props));
  const hit=(await live().search({query:'BANKAMP'})).items[0];
  assert.equal(hit.imageCount,12);assert.equal(hit.gallery.length,12);assert.equal(hit.galleryComplete,true);
  assert.deepEqual(hit.gallery.map(photo=>photo.index),Array.from({length:12},(_,i)=>i));
  assert.equal(hit.images[0],'https://cache.willhaben.at/mmo/4/890/209/104_0_hoved.jpg');
  assert.equal(hit.thumbnailUrl,'https://cache.willhaben.at/mmo/4/890/209/104_0_thumb.jpg');
  assert.equal(hit.images[3],'https://cache.willhaben.at/mmo/'+references[3]);
  assert.equal(hit.gallery[3].thumbnailUrl,null);
});
test('full detail galleries retain more than twelve ordered photos and distinct full paths',async t=>{
  const references=Array.from({length:19},(_,i)=>'photos/'+i+'/same.jpg');
  const row=rawRow(120);
  row.advertImageList={advertImage:references.map(reference=>({id:1,reference,mainImageUrl:'https://cache.willhaben.at/mmo/'+reference}))};
  row.advertImageList.advertImage.push({...row.advertImageList.advertImage[0],mainImageUrl:'https://cache.willhaben.at/mmo/photos/0/same_hoved.jpg'});
  row.attributes.attribute.push({name:'DESCRIPTION',values:['a'.repeat(6500)]});
  t.mock.method(globalThis,'fetch',async()=>embed({advertDetails:row}));
  const detail=await live().detail('120');
  assert.equal(detail.imageCount,19);assert.equal(detail.galleryComplete,true);
  assert.deepEqual(detail.images,references.map(path=>'https://cache.willhaben.at/mmo/'+path));
  assert.equal(detail.thumbnailUrl,null);
  assert.ok(detail.gallery.every(photo=>photo.thumbnailUrl===null));
  assert.equal(detail.description.length,6000);assert.equal(detail.descriptionLength,6500);assert.equal(detail.descriptionTruncated,true);
});
test('a partial search gallery is identified as incomplete and unsafe CDN URLs are omitted',async t=>{
  const row=rawRow(120);
  row.advertImageList={advertImage:[{mainImageUrl:'https://cache.willhaben.at/mmo/a.jpg'},{mainImageUrl:'https://cache.willhaben.at/not-mmo/b.jpg'}]};
  const props=page([],1,1);props.searchResult.advertSummaryList.advertSummary=[row];props.searchResult.rowsReturned=1;
  t.mock.method(globalThis,'fetch',async()=>embed(props));
  const hit=(await live().search({query:'Lampe'})).items[0];
  assert.equal(hit.galleryComplete,false);assert.equal(hit.imageCount,1);
});
test('a detail cover fallback does not claim an authoritative full gallery',async t=>{
  const row=rawRow(120);
  row.attributes.attribute.push({name:'MMO',values:['photos/cover.jpg']});
  t.mock.method(globalThis,'fetch',async()=>embed({advertDetails:row}));
  const detail=await live().detail('120');
  assert.equal(detail.imageCount,1);assert.equal(detail.galleryComplete,false);
});
test('search cache preserves observation times, seeds cover summaries and reuses facets across row sizes',async t=>{
  const storage=cacheEnv();
  const props=page(Array.from({length:100},(_,i)=>i+1),1,200);
  props.searchResult.navigatorGroups=[{navigatorList:[{id:'colour',label:'Farbe',possibleValues:[{label:'blau',urlParamRepresentationForValue:[{urlParameterName:'treeAttributes',value:'725'}]}]}]}];
  props.searchResult.advertSummaryList.advertSummary[0].advertImageList={advertImage:[{mainImageUrl:'https://cache.willhaben.at/mmo/cover_hoved.jpg',thumbnailImageUrl:'https://cache.willhaben.at/mmo/cover_thumb.jpg'}]};
  const fetcher=t.mock.method(globalThis,'fetch',async()=>embed(props));
  const query={query:'Lampe',pageSize:100};
  const first=await getProvider('live',storage.env).search(query);
  assert.equal(first.cacheHit,false);assert.deepEqual(storage.batches,[101,1]);
  assert.equal(Object.hasOwn(first,'facets'),false);
  const original=Date.parse(first.observedAt), now=t.mock.method(Date,'now',()=>original+31000);
  const again=await getProvider('live',storage.env).search(query);
  assert.equal(again.observedAt,first.observedAt);assert.equal(again.cacheAgeSeconds,31);assert.equal(again.cacheHit,true);
  const cover=await getProvider('live',storage.env).summary('1');
  assert.equal(cover.thumbnailUrl,'https://cache.willhaben.at/mmo/cover_thumb.jpg');assert.equal(cover.observedAt,first.observedAt);
  const facets=await getProvider('live',storage.env).facets({query:'Lampe'});
  assert.equal(facets.dimensions[0].values[0].value,725);assert.equal(facets.observedAt,first.observedAt);
  assert.equal(fetcher.mock.callCount(),1);
  now.mock.restore();
  const fresh=await getProvider('live',storage.env).search({...query,fresh:true});
  assert.equal(fresh.cacheHit,false);assert.equal(fetcher.mock.callCount(),2);
});
test('detail reuses a cached canonical URL, caches results and refreshes deleted listings',async t=>{
  const storage=cacheEnv(),paths=[];
  let gone=false;
  const fetcher=t.mock.method(globalThis,'fetch',async url=>{
    paths.push(url.pathname);
    if(url.pathname.endsWith('/marktplatz'))return embed(page([7],1,1));
    return gone?new Response('',{status:410}):embed({advertDetails:rawRow(7)});
  });
  const p=getProvider('live',storage.env);
  await p.search({query:'Kugel'});
  const first=await p.detail('7');
  assert.deepEqual(paths,['/iad/kaufen-und-verkaufen/marktplatz','/iad/kaufen-und-verkaufen/d/kugel-7']);
  const cached=await getProvider('live',storage.env).detail('7');
  assert.equal(cached.observedAt,first.observedAt);assert.equal(cached.cacheHit,true);assert.equal(fetcher.mock.callCount(),2);
  assert.equal(storage.entries.get('detail:7').ttlSeconds,900);
  gone=true;
  assert.equal(await getProvider('live',storage.env).detail('7',{fresh:true}),null);
  assert.equal(await getProvider('live',storage.env).detail('7'),null);
  assert.equal(fetcher.mock.callCount(),3);assert.equal(storage.entries.get('detail:7').ttlSeconds,60);
  assert.deepEqual(storage.entries.get('detail:7').value,{id:'7',gone:true});
  assert.equal(await getProvider('live',storage.env).summary('7'),null);
});
test('expired and malformed cache entries are ignored',async t=>{
  const storage=cacheEnv(),now=Date.now();
  storage.entries.set('detail:7',{value:{id:'7'},observedAt:new Date(now-10000).toISOString(),expiresAt:new Date(now-1).toISOString()});
  storage.entries.set('summary:7',{value:{id:'7'},observedAt:new Date(now).toISOString(),expiresAt:'invalid'});
  const fetcher=t.mock.method(globalThis,'fetch',async()=>embed({advertDetails:rawRow(7)}));
  const p=getProvider('live',storage.env);
  assert.equal(await p.summary('7'),null);
  assert.equal((await p.detail('7')).title,'Kugel');assert.equal(fetcher.mock.callCount(),1);
});
test('all recognized facet dimensions and values remain accessible for tool-level pagination',async t=>{
  const props=page([1],1,1);
  props.searchResult.navigatorGroups=[{navigatorList:Array.from({length:35},(_,dimension)=>({
    id:'dimension-'+dimension,label:'Dimension '+dimension,
    possibleValues:Array.from({length:60},(_,i)=>({label:'Wert '+i,urlParamRepresentationForValue:[{urlParameterName:'treeAttributes',value:String(dimension*100+i+1)}]}))
  }))}];
  t.mock.method(globalThis,'fetch',async()=>embed(props));
  const result=await live().facets({query:'Kugel'});
  assert.equal(result.dimensions.length,35);assert.ok(result.dimensions.every(dimension=>dimension.values.length===60&&!dimension.truncated));
});
test('expired explicit and request deadlines stop before fetching',async t=>{
  const fetcher=t.mock.method(globalThis,'fetch',()=>assert.fail('unexpected fetch'));
  await assert.rejects(live().detail('7',{deadline:Date.now()-1}),code('time_budget'));
  await assert.rejects(getProvider('live',{LIVE_ACCESS:'personal_test',REQUEST_DEADLINE:Date.now()-1}).search({query:'Kugel'}),code('time_budget'));
  assert.equal(fetcher.mock.callCount(),0);
});
test('cache reads and writes respect explicit and request deadlines',async t=>{
  const storage=cacheEnv();
  const fetcher=t.mock.method(globalThis,'fetch',async()=>embed(page([1],1,1)));
  storage.gate.getCached=()=>new Promise(()=>{});
  await assert.rejects(getProvider('live',{...storage.env,REQUEST_DEADLINE:Date.now()+20}).search({query:'Kugel'}),code('time_budget'));
  await assert.rejects(getProvider('live',storage.env).detail('7',{deadline:Date.now()+20}),code('time_budget'));
  assert.equal(fetcher.mock.callCount(),0);
  storage.gate.getCached=async()=>null;
  storage.gate.putCached=()=>new Promise(()=>{});
  await assert.rejects(getProvider('live',storage.env).search({query:'Kugel',deadline:Date.now()+150}),code('time_budget'));
  assert.equal(fetcher.mock.callCount(),1);
});
test('an early cache timer preserves task-budget errors and distinguishes coordinator timeouts',async t=>{
  const storage=cacheEnv(),now=1800000000000;
  storage.gate.getCached=()=>new Promise(()=>{});
  t.mock.method(Date,'now',()=>now);
  t.mock.method(globalThis,'setTimeout',callback=>{queueMicrotask(callback);return 0;});
  t.mock.method(globalThis,'fetch',()=>assert.fail('Cache timeout must not fetch upstream'));
  await assert.rejects(getProvider('live',storage.env).summary('7',{deadline:now+20}),code('time_budget'));
  await assert.rejects(getProvider('live',storage.env).summary('7',{deadline:now+5000}),code('traffic_unavailable'));
});
