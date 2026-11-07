import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedUpstreamURL, pacedFetch, readBounded, retryAt, type TrafficGate } from '../src/http.js';
import { imageMime } from '../src/images.js';

test('only known provider and ChatGPT file hosts can be fetched', () => {
  for (const url of ['http://www.sellpy.at/search','https://127.0.0.1/file','https://sellpy.net.evil.test/file','https://user:pass@www.sellpy.at/','https://services.sellpy.net:8443/']) {
    assert.throws(()=>allowedUpstreamURL(url));
  }
  assert.equal(allowedUpstreamURL('https://prod.images.sellpy.net/photo.jpg').hostname,'prod.images.sellpy.net');
  assert.equal(allowedUpstreamURL('https://sellpy-parse-prod-files.s3.amazonaws.com/x.jpg').protocol,'https:');
});

test('Retry-After preserves full seconds and HTTP dates', () => {
  assert.equal(retryAt('120',1000),121000);
  assert.equal(retryAt('Thu, 01 Jan 1970 00:02:00 GMT',1000),120000);
  assert.equal(retryAt('bad',1000),null);
});

test('bounded reader rejects streamed responses without Content-Length', async () => {
  const body = new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(6));controller.close();}});
  await assert.rejects(()=>readBounded(new Response(body),5),/budget/);
});

test('redirects do not reach an untrusted target', async () => {
  let calls=0;
  const gate:TrafficGate={async reserve(now){return {wait_until:now,retry_until:0,granted:true};},async cooldown(){},async cooldownUntil(){return 0;}};
  const request=pacedFetch({deadline:Date.now()+10000,gate:()=>gate,fetch:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}});}});
  await assert.rejects(()=>request('https://www.sellpy.at/search'),/host/);
  assert.equal(calls,1);
});

test('429 persists a long cooldown and does not spin until task timeout', async () => {
  let until=0;
  let calls=0;
  const gate:TrafficGate={async reserve(now){return {wait_until:now,retry_until:0,granted:true};},async cooldown(value){until=value;},async cooldownUntil(){return until;}};
  const started=Date.now();
  const request=pacedFetch({deadline:started+5000,gate:()=>gate,fetch:async()=>{calls++;return new Response('busy',{status:429,headers:{'Retry-After':'120'}});}});
  await assert.rejects(()=>request('https://services.sellpy.net/test'),(error:unknown)=>error instanceof Error && 'code' in error && error.code==='rate_limited');
  assert.ok(until>=started+120000);
  assert.equal(calls,1);
});

test('image identity comes from bytes rather than a response content-type', () => {
  assert.equal(imageMime(new TextEncoder().encode('<html>not an image</html>')),null);
  assert.equal(imageMime(Uint8Array.from([0xff,0xd8,0xff,0xe0])),'image/jpeg');
});

test('a waiting reservation rechecks a cooldown set by another in-flight request', async () => {
  let nextAt=0,until=0,calls=0;
  const gate:TrafficGate={
    async reserve(now,spacing,deadline) {
      const wait_until=Math.max(now,nextAt,until);
      if(wait_until+50>=deadline) return {wait_until,retry_until:until,granted:false};
      nextAt=wait_until+spacing;
      return {wait_until,retry_until:until,granted:true};
    },
    async cooldown(value){until=Math.max(until,value);},
    async cooldownUntil(){return until;},
  };
  const request=pacedFetch({deadline:Date.now()+2000,gate:()=>gate,fetch:async()=>{
    calls++;
    assert.ok(Date.now()>=until,'must not dispatch during an observed cooldown');
    return new Response('busy',{status:429,headers:{'Retry-After':'120'}});
  }});
  const outcomes=await Promise.allSettled([request('https://services.sellpy.net/first'),request('https://services.sellpy.net/second')]);
  assert.equal(calls,1);
  assert.ok(outcomes.every(result=>result.status==='rejected' && result.reason.code==='rate_limited'));
});
