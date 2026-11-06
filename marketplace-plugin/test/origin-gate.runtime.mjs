import { Miniflare } from 'miniflare';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const root = process.argv[2] ?? fileURLToPath(new URL('../src/', import.meta.url));
const runtimeRoot = await mkdtemp(join(tmpdir(), 'marktplatz-gate-'));
const origin = 'https://www.willhaben.at';
const imageOrigin = 'https://cache.willhaben.at';
const entry = `export { OriginGate } from './origin-gate.mjs';
export default { async fetch(request, env) {
  const {action,origin,args=[]} = await request.json();
  const gate = env.ORIGIN_GATE.getByName(origin);
  try {
    const result = action === 'parallel'
      ? await Promise.all(Array.from({length:16}, () => gate.acquire(origin)))
      : await gate[action](...args);
    return Response.json({result});
  } catch (error) { return Response.json({error:error.message}, {status:400}); }
}};`;
const options = {
  name: 'marktplatz-origin-gate-test',
  modulesRoot: runtimeRoot,
  modules: [
    {type:'ESModule',path:runtimeRoot+'/entry.mjs',contents:entry},
    {type:'ESModule',path:runtimeRoot+'/origin-gate.mjs',contents:await readFile(root+'/origin-gate.mjs','utf8')},
    {type:'ESModule',path:runtimeRoot+'/traffic.mjs',contents:await readFile(root+'/traffic.mjs','utf8')},
  ],
  compatibilityDate: '2026-06-01',
  durableObjects: { ORIGIN_GATE: {className:'OriginGate',useSQLite:true} },
  durableObjectsPersist: runtimeRoot+'/state',
};
let mf = new Miniflare(options);
async function rpc(action,args=[],requestOrigin=origin) {
  const response=await mf.dispatchFetch('https://gate-test.invalid/',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({action,origin:requestOrigin,args}),
  });
  const body=await response.json();
  if(!response.ok) throw new Error(body.error);
  return body.result;
}
try {
  const simultaneous=await rpc('parallel');
  assert.equal(simultaneous.filter(r=>r.granted).length,1);
  assert.equal(simultaneous.filter(r=>!r.granted).length,15);
  console.log('PASS 16 concurrent acquisitions grant one origin slot');
  assert.equal((await rpc('acquire',[imageOrigin],imageOrigin)).granted,true);
  console.log('PASS image origin has independent pacing');
  await assert.rejects(rpc('acquire',[imageOrigin]), /separate coordinator/);

  const blocked=await rpc('report',[origin,{status:429,retryAfter:'1800'}]);
  assert.ok(blocked.until-Date.now()>1799000);
  const laterSuccess=await rpc('report',[origin,{status:200}]);
  assert.deepEqual(laterSuccess,blocked);
  const shorterFailure=await rpc('report',[origin,{status:503,retryAfter:'30'}]);
  assert.deepEqual(shorterFailure,blocked);
  console.log('PASS shared long cooldown survives late success and shorter retry');

  const observedAt=new Date().toISOString();
  const listing={id:'123',title:'Verified fixture',price:25,images:[]};
  const entry={key:'detail:123',value:listing,observedAt,ttlSeconds:900};
  assert.deepEqual(await rpc('putCached',[[entry]]),{stored:1});
  const cached=await rpc('getCached',['detail:123']);
  assert.deepEqual(cached,{value:listing,observedAt,expiresAt:new Date(Date.parse(observedAt)+900000).toISOString()});
  assert.equal((await rpc('acquire',[origin])).granted,false);
  console.log('PASS cache hits retain observation age while origin is cooling down');

  assert.deepEqual(await rpc('putCached',[[{...entry,value:{...listing,title:'Older'},observedAt:new Date(Date.parse(observedAt)-10000).toISOString()}]]),{stored:0});
  assert.equal((await rpc('getCached',['detail:123'])).value.title,listing.title);
  await assert.rejects(rpc('putCached',[[{...entry,key:'detail:456'},{...entry,key:'detail:789',ttlSeconds:3601}]]),/Invalid observation/);
  assert.equal(await rpc('getCached',['detail:456']),null);
  const expired={...entry,key:'detail:987',observedAt:new Date(Date.now()-1000000).toISOString()};
  assert.deepEqual(await rpc('putCached',[[expired]]),{stored:0});
  assert.equal(await rpc('getCached',['detail:987']),null);
  console.log('PASS stale writes, expired observations and invalid batches preserve cache correctness');

  const summaries=Array.from({length:100},(_,i)=>({...entry,key:'summary:'+String(1000+i),value:{...listing,id:String(1000+i)}}));
  const search={...entry,key:'search:'+'a'.repeat(64),ttlSeconds:300,value:{items:summaries.map(s=>s.value)}};
  assert.deepEqual(await rpc('putCached',[[search,...summaries]]),{stored:101});
  assert.equal((await rpc('getCached',['summary:1099'])).value.id,'1099');
  console.log('PASS one search page and 100 covers cache in one RPC');
  await assert.rejects(rpc('putCached',[[{...entry,key:'detail:999',value:{description:'x'.repeat(2*1024*1024)}}]]),/size budget/);
  assert.equal(await rpc('getCached',['detail:999']),null);
  console.log('PASS oversize records fail before writes');

  await mf.dispose();
  mf = new Miniflare(options);
  const restored=await rpc('acquire',[origin]);
  assert.equal(restored.granted,false);
  assert.equal(restored.retryAtMs,blocked.until);
  assert.deepEqual(await rpc('getCached',['detail:123']),cached);
  console.log('PASS cooldown and original observations survive real workerd restart');
  console.log('All OriginGate Workers-runtime checks passed');
} finally {
  await mf.dispose();
  await rm(runtimeRoot, {recursive:true,force:true});
}
