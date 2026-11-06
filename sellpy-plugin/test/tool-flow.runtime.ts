import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';

const calls=vi.hoisted(()=>({ attempted:[] as string[], received:[] as string[][] }));
vi.mock('../src/sellpy/client.js',()=>({
  createSellpyProvider:()=>({
    details:async(ids:string[])=>{
      calls.received.push([...ids]);
      const unique=[...new Set(ids)];
      const done=unique.slice(0,10);
      calls.attempted.push(...done);
      return {items:[],failures:[],remaining_ids:unique.slice(10)};
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
});
