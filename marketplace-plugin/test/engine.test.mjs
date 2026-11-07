import test from 'node:test';
import assert from 'node:assert/strict';
import { runStudy, evaluateListing } from '../src/engine.mjs';

const listing = (i, extra = {}) => ({id:String(i), title:`Kugel ${i}`, url:`https://www.willhaben.at/iad/object?adId=${i}`,
  price:i, quantity:1, category:'Lampengläser', condition:'used', model:'Kugel 60', ...extra});
const sample = (n = 120) => Array.from({length:n}, (_,i) => listing(i+1));

function pages(items, {size=30,total=items.length,effectiveTotal=total,detail = async id => items.find(i => i.id === id) ?? null} = {}) {
  return {kind:'demo', async search({cursor}) {
    const start = Number(cursor ?? 0), slice = items.slice(start,start+size), end = start+size >= items.length;
    return {items:slice, nextCursor:end ? null : String(start+size), end, total:typeof effectiveTotal === 'function' ? effectiveTotal(start) : effectiveTotal};
  }, detail};
}
const run = (p,s={}) => runStudy(p,{queries:['Kugel'],maxDetails:0,...s});

test('does not use requested rows or missing total as pagination boundary', async () => {
  for (const size of [100,30]) for (const total of [120,null]) {
    const r = await run(pages(sample(),{size,total}));
    assert.equal(r.coverage.searchExhausted,true);
    assert.equal(r.coverage.queries[0].pages,Math.ceil(120/size));
    assert.equal(r.counts.unique,120);
    assert.equal(r.coverage.queries[0].reportedTotal,total);
    assert.equal(r.shortlist.length,24);
  }
});

test('advances past locally filtered empty pages and reports their source continuation', async () => {
  const provider = {kind:'live', async search({cursor}) {
    const end = cursor === '2';
    return {items:end ? [listing(1)] : [], end, nextCursor:end ? null : '2', total:51,
      totalScope:'upstream_before_local_filters', scannedCount:end ? 1 : 50, filteredOutCount:end ? 0 : 50};
  }};
  const partial = await run(provider,{filters:{excludeTerms:['unrelated']},maxPages:1});
  assert.equal(partial.counts.unique,0);
  assert.equal(partial.coverage.queries[0].stopReason,'page_budget');
  assert.deepEqual(partial.coverage.queries[0].continuation,{cursor:'2',firstPage:false});

  const complete = await run(provider,{filters:{excludeTerms:['unrelated']},maxPages:3});
  assert.deepEqual(complete.shortlist.map(row => row.id),['1']);
  assert.equal(complete.coverage.queries[0].pages,2);
  assert.equal(complete.coverage.queries[0].reportedTotal,51);
  assert.equal(complete.coverage.searchExhausted,true);
});

test('advances past duplicate-only pages to reach later listings', async () => {
  const provider = {kind:'live', async search({cursor}) {
    const page = Number(cursor ?? 1);
    return {items:[listing(page === 3 ? 2 : 1)], total:2, end:page === 3,
      nextCursor:page === 3 ? null : String(page+1)};
  }};
  const report = await run(provider,{maxPages:3});
  assert.deepEqual(report.shortlist.map(row => row.id),['1','2']);
  assert.equal(report.coverage.queries[0].pages,3);
  assert.equal(report.coverage.searchExhausted,true);
});

test('schema failure, empty result, explicit undercount and changed total are distinguishable', async () => {
  const invalidResponses = [{}, {items:[],nextCursor:null,end:true,total:-1}, {items:[],nextCursor:null,end:false,total:null},
    {items:[{id:'1',title:'Candidate',price:'10'}],end:true,total:1,nextCursor:null}];
  for (const raw of invalidResponses) {
    const r = await run({kind:'live',search:async()=>raw});
    assert.equal(r.coverage.queries[0].stopReason,'upstream_schema');
    assert.equal(r.coverage.status,'partial');
  }
  assert.equal((await run(pages([]))).coverage.status,'exhausted');
  const capped = await run(pages(sample(30),{total:120}));
  assert.equal(capped.counts.unique,30);
  assert.equal(capped.coverage.queries[0].stopReason,'total_mismatch');
  assert.equal((await run(pages(sample(60),{effectiveTotal:x => x ? 60:80}))).coverage.queries[0].stopReason,'total_changed');
});

test('cached page observation time reaches study rows and freshness without a detail fetch', async () => {
  const observedAt = new Date(Date.now() - 120000).toISOString();
  const ownTime = new Date(Date.now() - 60000).toISOString();
  const report = await run({kind:'live', search:async()=>({
    items:[listing(1),listing(2,{observedAt:ownTime,cacheAgeSeconds:60})],
    total:2,end:true,nextCursor:null,observedAt,cacheAgeSeconds:120,cacheHit:true,
  })});
  assert.equal(report.shortlist[0].observedAt,observedAt);
  assert.equal(report.shortlist[0].cacheAgeSeconds,120);
  assert.equal(report.shortlist[1].observedAt,ownTime);
  assert.deepEqual(report.dataFreshness,{
    oldestObservationAt:observedAt,newestObservationAt:ownTime,cachedRecords:2,
  });
});

test('deduplicates across variants and pages; restating one query does not spend quota',async()=>{
  const list = sample(5);
  const r = await run(pages([list[0],...list],{total:5,size:3}),{queries:['A','B','A']});
  assert.equal(r.counts.raw,12);
  assert.equal(r.counts.unique,5);
  assert.equal(r.coverage.queries.length,2);
  assert.equal(r.coverage.status,'exhausted');
});

test('duplicate queries retain the latest whole listing observation in either order', async () => {
  const observations = {
    older:listing(1,{title:'Old lamp',price:100,observedAt:'2026-11-07T10:00:00.000Z',cacheAgeSeconds:300,cacheHit:true,
      attributes:{opening_mm:24}}),
    newer:listing(1,{title:'Current lamp',price:80,observedAt:'2026-11-07T10:05:00.000Z',cacheAgeSeconds:0,cacheHit:false}),
  };
  const provider = {kind:'live', async search({query}) {
    return {items:[observations[query]],total:1,end:true,nextCursor:null,
      observedAt:'2026-11-07T09:00:00.000Z',cacheAgeSeconds:3600,cacheHit:true};
  }};
  for (const queries of [['older','newer'],['newer','older']]) {
    const report = await run(provider,{queries,maxPages:2,criteria:[{key:'opening_mm',value:24}]});
    assert.equal(report.counts.unique,1);
    assert.equal(report.counts.raw,2);
    assert.equal(report.counts.confirmed,0);
    const row = report.unknown[0];
    assert.equal(row.title,'Current lamp');
    assert.equal(row.askingEUR,80);
    assert.equal(row.observedAt,observations.newer.observedAt);
    assert.equal(row.cacheAgeSeconds,0);
    assert.equal(row.evidence[0].actual,null);
    assert.deepEqual(report.dataFreshness,{
      oldestObservationAt:observations.newer.observedAt,newestObservationAt:observations.newer.observedAt,cachedRecords:0,
    });
  }
});

test('bounded fair traversal across variants and honest partial results on stalls',async()=>{
  const limited = await run(pages(sample(),{size:5}),{queries:['A','B'],maxPages:2});
  assert.deepEqual(limited.coverage.queries.map(r=>[r.pages,r.stopReason]),[[1,'page_budget'],[1,'page_budget']]);
  assert.deepEqual(limited.coverage.queries.map(r=>r.continuation),[{cursor:'5',firstPage:false},{cursor:'5',firstPage:false}]);
  const notStarted = await run(pages(sample(),{size:5}),{queries:['A','B'],maxPages:1});
  assert.deepEqual(notStarted.coverage.queries[1].continuation,{cursor:null,firstPage:true});
  const cursorLoop = await run({kind:'live',search:async({cursor})=>({items:[listing(cursor ? 2:1)],end:false,nextCursor:'next',total:null})});
  assert.equal(cursorLoop.coverage.queries[0].stopReason,'repeated_cursor');
  assert.equal(cursorLoop.coverage.queries[0].continuation,undefined);
  const dupes = await run({kind:'live',search:async({cursor})=>({items:[listing(1)],end:false,nextCursor:String(Number(cursor??0)+1),total:null})},{maxPages:3});
  assert.equal(dupes.coverage.queries[0].stopReason,'page_budget');
  assert.deepEqual(dupes.coverage.queries[0].continuation,{cursor:'3',firstPage:false});
});

test('rate limiting halts the study and secondary detail traffic',async()=>{
  let upstreamCalls = 0;
  const p = {kind:'live',search:async()=>{
    if (++upstreamCalls === 1) return {items:[listing(1)],nextCursor:'more',end:false,total:null};
    throw Object.assign(new Error('Do not expose this secret'),{code:'upstream_rate_limited'});
  },detail:async()=>{throw new Error('should not be called')}};
  const r = await run(p,{queries:['A','B','C'],maxDetails:6});
  assert.equal(upstreamCalls,2); assert.equal(r.counts.unique,1);
  assert.equal(r.counts.detailsAttempted,0); assert.equal(r.coverage.status,'partial');
  assert(r.coverage.queries.every(q=>q.continuation));
  assert.doesNotMatch(JSON.stringify(r),/secret/);
});

test('detail priority and explicit criteria keep unsupported fitting claims unknown',async()=>{
  const criteria = [{key:'finish',value:'matt'},{key:'diameter_mm',value:{min:59,max:61}},{key:'opening_mm',value:{min:23,max:25}}];
  const bank = sample(3).map((l,i)=>({...l,attributes:{finish:i===2?'klar':'Matt',diameter_mm:60,...(i===0?{opening_mm:24}:{})}}));
  const p=pages(bank,{detail:async id=>bank.find(l=>l.id===id)});
  const r=await run(p,{criteria,maxDetails:1});
  assert.equal(r.counts.confirmed,1);
  assert.equal(r.counts.contradicted,1);
  assert.equal(r.counts.unknown,1);
  assert.equal(r.unknown[0].id,'2'); assert.equal(r.unknown[0].detailed,true);
  assert.equal(r.unknown[0].evidence[2].evidence,null);
  assert.equal(r.shortlist[0].evidence[1].evidence,'attributes.diameter_mm');
  assert.equal(r.coverage.detailsComplete,false);
});

test('an older detail cannot overwrite newer search facts or claim current detail coverage', async () => {
  const current = listing(1,{price:80,observedAt:'2026-11-07T10:05:00.000Z',cacheAgeSeconds:0});
  const provider = pages([current],{detail:async () => listing(1,{
    price:100,observedAt:'2026-11-07T10:00:00.000Z',cacheAgeSeconds:300,cacheHit:true,attributes:{opening_mm:24},
  })});
  const report = await run(provider,{criteria:[{key:'opening_mm',value:24}],maxDetails:1});
  assert.equal(report.counts.confirmed,0);
  assert.equal(report.counts.detailsFetched,1);
  const row = report.unknown[0];
  assert.equal(row.askingEUR,80);
  assert.equal(row.observedAt,current.observedAt);
  assert.equal(row.cacheAgeSeconds,0);
  assert.equal(row.detailed,false);
  assert.equal(row.evidence[0].actual,null);
  assert.equal(report.coverage.detailsComplete,false);
  assert.equal(report.coverage.detailsUnexamined,1);
  assert.deepEqual(report.coverage.remainingDetailIds,['1']);
  assert.deepEqual(report.dataFreshness,{
    oldestObservationAt:current.observedAt,newestObservationAt:current.observedAt,cachedRecords:0,
  });
});

test('equal or newer details replace the whole observation without inheriting old attributes', async () => {
  const searchTime = '2026-11-07T10:00:00.000Z';
  for (const observedAt of [searchTime,'2026-11-07T10:05:00.000Z']) {
    const provider = pages([listing(1,{price:100,observedAt:searchTime,cacheHit:true,cacheAgeSeconds:300,
      attributes:{opening_mm:24}})],{detail:async () => ({
      id:'1',title:'Current lamp detail',price:80,observedAt,cacheAgeSeconds:0,cacheHit:false,
    })});
    const report = await run(provider,{criteria:[{key:'opening_mm',value:24}],maxDetails:1});
    assert.equal(report.counts.confirmed,0);
    const row = report.unknown[0];
    assert.equal(row.title,'Current lamp detail');
    assert.equal(row.askingEUR,80);
    assert.equal(row.quantity,null);
    assert.equal(row.condition,null);
    assert.equal(row.evidence[0].actual,null);
    assert.equal(row.observedAt,observedAt);
    assert.equal(row.cacheAgeSeconds,0);
    assert.equal(row.detailed,true);
    assert.equal(report.coverage.detailsComplete,true);
    assert.equal(report.coverage.detailsUnexamined,0);
    assert.deepEqual(report.coverage.remainingDetailIds,[]);
    assert.deepEqual(report.dataFreshness,{
      oldestObservationAt:observedAt,newestObservationAt:observedAt,cachedRecords:0,
    });
  }
});

test('a wrong-identity detail cannot change evidence', async()=>{
  const r=await run(pages([listing(1)],{detail:async()=>listing(8,{attributes:{opening_mm:24}})}),{criteria:[{key:'opening_mm',value:24}],maxDetails:1});
  assert.equal(r.counts.unknown,1); assert.equal(r.counts.detailsFailed,1);
  assert.equal(r.coverage.detailErrors.upstream_schema,1);
});

test('checks premium hits against explicit filters', async()=>{
  const l = [listing(1,{price:150,paylivery:true}),listing(2,{price:50,paylivery:false}),listing(3,{price:75,paylivery:true})];
  const r=await run(pages(l),{filters:{priceMax:100,paylivery:true}});
  assert.deepEqual(r.shortlist.map(s=>s.id),['3']);
  assert.equal(r.counts.contradicted,2);
});

test('prices are asking prices; group verified units and distinguish shipping from PayLivery',async()=>{
  const l = [10,20,30,40,50].map((x,i)=>listing(i+1,{price:2*x,quantity:2,shippingCost:i===0?undefined:6}));
  l.push(listing(6,{price:20,quantity:null}), listing(7,{price:1,condition:'defective'}), listing(8,{price:20,model:'Other'}),
    listing(9,{price:0}),listing(10,{price:null}),listing(11,{price:60,status:'reserved'}));
  const r=await run(pages(l));
  assert.equal(r.pricing.kind,'asking');
  assert.deepEqual({...r.pricing.excluded},{free:1,unpriced:1,not_available:1});
  assert.equal(r.counts.priceEligible,8);
  assert.equal(r.pricing.cohortsTotal,4);
  const c=r.cohorts.find(c=>c.comparable);
  assert.deepEqual(c.askingEUR,{n:5,min:10,max:50,p25:20,median:30,p75:40});
  assert.deepEqual(c.shippedEUR,{n:4,min:23,max:53});
  assert.equal(r.shortlist.find(r=>r.id==='1').shippedUnitEUR,null);
  assert.deepEqual(r.shortlist.find(r=>r.id==='1').priceContext,{sampleSize:5,medianUnitEUR:30,belowMedianPercent:66.67});
  assert.equal(r.shortlist.find(r=>r.id==='6').priceContext,undefined);
  assert.equal(r.cohorts.filter(c=>!c.comparable).every(c=>c.askingEUR.median===undefined),true);
});

test('wall-clock interruption preserves acquired records and the next search position', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const provider = {kind:'live', async search({cursor,pageSize}) {
    assert.equal(cursor,null);
    assert.equal(pageSize,100);
    now = 3000;
    return {items:[listing(1)],total:200,end:false,nextCursor:'2'};
  }};
  const result = await runStudy(provider,{queries:['Kugel'],pageSize:100,maxPages:32,maxDetails:0},{deadline:2000});
  assert.equal(result.counts.unique,1);
  assert.equal(result.coverage.queries[0].stopReason,'time_budget');
  assert.deepEqual(result.coverage.queries[0].continuation,{cursor:'2',firstPage:false});
});

test('shared cooldown reports the full retry time and leaves details available for later calls', async () => {
  const retryAt = '2040-01-01T00:30:00.000Z';
  const provider = pages(sample(3),{detail:async () => {
    throw Object.assign(new Error('untrusted upstream message'),{code:'upstream_cooldown',recoverable:true,retryAfterSeconds:1800,retryAt});
  }});
  const result = await run(provider,{maxDetails:100});
  assert.equal(result.counts.detailsAttempted,1);
  assert.equal(result.coverage.retryAfterSeconds,1800);
  assert.equal(result.coverage.retryAt,retryAt);
  assert.deepEqual(result.coverage.remainingDetailIds,['1','2','3']);
  assert.doesNotMatch(JSON.stringify(result),/untrusted upstream/);
});

test('invalid input and hostile fields are isolated',async()=>{
  assert.throws(()=>evaluateListing(listing(1),[{key:'constructor',value:'secret'}]),/criterion/);
  assert.throws(()=>evaluateListing(listing(1),[{key:'a',value:{min:5,max:2}}]),/criterion/);
  await assert.rejects(()=>run(pages([]),{maxPages:10000}),/maxPages/);
  const r=await run(pages([listing(1,{sellerName:'private',url:'https://evil.invalid/iad',email:'secret@invalid'})]));
  assert.equal(r.shortlist[0].url,null); assert.doesNotMatch(JSON.stringify(r),/secret@invalid/);
});

test('German structured traits match canonical dimensions with the original evidence and explicit units', () => {
  const criteria = [{key:'diameterMm',value:60},{key:'openingMm',value:{min:23,max:25}},{key:'finish',value:'matte'},{key:'shape',value:'spherical'}];
  const l = listing(1,{attributes:{Durchmesser:'6,0 cm',Öffnungsdurchmesser:'24 mm',Oberfläche:'matt',Form:'kugelförmig'}});
  const result = evaluateListing(l,criteria);
  assert.equal(result.status,'confirmed');
  assert.deepEqual(result.criteria[0],{key:'diameterMm',expected:60,actual:60,status:'confirmed',evidence:'attributes.Durchmesser',sourceValue:'6,0 cm'});
  for (const unclear of ['6 cm x 5 cm','ca. 6 cm','60','6–8 cm','nicht 60 mm']) {
    assert.equal(evaluateListing({...l,attributes:{Durchmesser:unclear}},[criteria[0]]).status,'unknown');
  }
  assert.equal(evaluateListing(listing(1,{attributes:{Durchmesser:'6 cm'}}),[criteria[1]]).status,'unknown');
  assert.equal(evaluateListing(listing(1,{attributes:{Form:'rund'}}),[criteria[3]]).status,'unknown');
  assert.equal(evaluateListing(listing(1,{attributes:{Oberfläche:'glänzend'}}),[criteria[2]]).status,'contradicted');
  assert.equal(evaluateListing(listing(1,{attributes:{Oberfläche:'opal'}}),[criteria[2]]).status,'unknown');
});
