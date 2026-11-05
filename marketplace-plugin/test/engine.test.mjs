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

test('deduplicates across variants and pages; restating one query does not spend quota',async()=>{
  const list = sample(5);
  const r = await run(pages([list[0],...list],{total:5,size:3}),{queries:['A','B','A']});
  assert.equal(r.counts.raw,12);
  assert.equal(r.counts.unique,5);
  assert.equal(r.coverage.queries.length,2);
  assert.equal(r.coverage.status,'exhausted');
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
  const dupes = await run({kind:'live',search:async({cursor})=>({items:[listing(1)],end:false,nextCursor:String(Number(cursor??0)+1),total:null})});
  assert.equal(dupes.coverage.queries[0].stopReason,'no_progress');
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
  assert(r.coverage.queries.every(q=>q.continuation===undefined));
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
  assert.equal(r.cohorts.filter(c=>!c.comparable).every(c=>c.askingEUR.median===undefined),true);
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
