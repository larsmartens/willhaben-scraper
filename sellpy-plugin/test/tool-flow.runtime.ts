import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import type { ItemObservation } from '../src/domain.js';

const calls=vi.hoisted(()=>({ attempted:[] as string[], received:[] as string[][], enriched:null as ItemObservation|null }));
vi.mock('../src/sellpy/client.js',()=>({
  createSellpyProvider:()=>({
    details:async(ids:string[])=>{
      calls.received.push([...ids]);
      const unique=[...new Set(ids)];
      const done=unique.slice(0,10);
      calls.attempted.push(...done);
      return {items:calls.enriched && done.includes(calls.enriched.id)?[calls.enriched]:[],failures:[],remaining_ids:unique.slice(10)};
    },
  }),
}));
import { invokeTool } from '../src/tools.js';

function context() { return {env:env as Env,principal:'review-user',deadline:Date.now()+30000}; }
describe('tool continuation and corrective errors',()=>{
  it('upload-preparation errors retain structured corrective data',async()=>{
    const result=await invokeTool('search_by_image',{
      reference:{file_id:'test-reference',download_url:'https://untrusted.example/reference.jpg'},
    },context());
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string,unknown>).error).toMatchObject({code:'unsupported_image_host'});
  });
  it('presentation errors retain structured corrective data',async()=>{
    const result=await invokeTool('present_items',{
      run_id:crypto.randomUUID(),selection:[{item_id:'not-present',reason:'review'}],
    },context());
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string,unknown>).error).toMatchObject({code:'search_not_found'});
  });
  it('repeated requested IDs do not hide an unprocessed unique ID behind next_index',async()=>{
    calls.attempted=[]; calls.received=[];
    const ids='abcdefghijkabcdefghi'.split('');
    let next_index:number|null=0;
    let run_id:string|undefined;
    const nextIndices:number[]=[];
    while(next_index!==null) {
      const result=await invokeTool('get_items',{ids,run_id,start_index:next_index,batch_size:20},context());
      expect(result.isError).not.toBe(true);
      const data=result.structuredContent as {run_id:string;next_index:number|null};
      run_id=data.run_id;next_index=data.next_index;
      if(next_index!==null) nextIndices.push(next_index);
    }
    console.log(JSON.stringify({nextIndices,received:calls.received,attempted:calls.attempted}));
    expect(new Set(calls.attempted)).toEqual(new Set(ids));
  });
  it('the first image request enriches catalog thumbnails with every canonical photo',async()=>{
    const run_id=crypto.randomUUID();
    const stub=env.SEARCH_RUNS.getByName(`review-user:${run_id}`);
    await stub.start({market:'AT',language:'de',page_size:10,intent:{query:'photos'},arms:[]},run_id);
    const catalog:ItemObservation={id:'photo-item',market:'AT',language:'de',url:'https://www.sellpy.at/item/photo-item',
      title:'Photo test',brand:null,price:null,original_price:null,size:null,size_system:null,condition:null,
      categories:[],colors:[],materials:[],measurements:{},description:null,defects:[],availability:'unknown',
      images:[{id:'cover',index:0,url:'https://prod.images.sellpy.net/cover.jpg'}],
      source:'catalog',observed_at:new Date().toISOString(),attributes:{}};
    await stub.updateItems([catalog]);
    calls.enriched={...catalog,source:'detail',images:[...catalog.images,{id:'extra',index:1,url:'https://prod.images.sellpy.net/extra.jpg'}]};
    try {
      const result=await invokeTool('get_item_images',{run_id,item_id:catalog.id,start_index:2,for_model:false},context());
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({total_images:2,warnings:[]});
      expect((await stub.getCandidates([catalog.id]))[0]?.item.images.map(image=>image.id)).toEqual(['cover','extra']);
    } finally { calls.enriched=null; }
  });
});
