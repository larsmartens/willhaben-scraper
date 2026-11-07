import { exports } from 'cloudflare:workers';
import { describe, it, expect } from 'vitest';

const endpoint=`https://example.test/personal/${'t'.repeat(43)}/mcp`;
async function rpc(method:string,params:Record<string,unknown>={}) {
  const response=await exports.default.fetch(new Request(endpoint, {method:'POST',
    headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}));
  expect(response.status).toBe(200);
  const body=await response.text();
  const json=response.headers.get('content-type')?.includes('text/event-stream') ? body.split('\n').find(line=>line.startsWith('data:'))?.slice(5) : body;
  return JSON.parse(json ?? '{}');
}

describe('real Workers MCP boundary',()=>{
  it('rejects unauthenticated calls and hostile origins',async()=>{
    expect((await exports.default.fetch('https://example.test/mcp')).status).toBe(401);
    expect((await exports.default.fetch(new Request(endpoint,{headers:{origin:'https://evil.test'}}))).status).toBe(403);
    expect((await exports.default.fetch('https://example.test/health')).status).toBe(200);
  });
  it('serves legacy initialization, complete schemas, file inputs and exact gallery resource',async()=>{
    const initialized=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'contract-test',version:'1'}});
    expect(initialized.result.serverInfo.name).toBe('sellpy-studio');
    const list=await rpc('tools/list');
    expect(list.result.tools).toHaveLength(27);
    const browse=list.result.tools.find((tool:{name:string})=>tool.name==='browse_collection');
    expect(browse._meta.ui.visibility).toEqual(['app']);
    const present=list.result.tools.find((tool:{name:string})=>tool.name==='present_items');
    expect(present._meta['openai/outputTemplate']).toBe('ui://sellpy/gallery-v3.html');
    const upload=list.result.tools.find((tool:{name:string})=>tool.name==='search_by_image');
    expect(upload._meta['openai/fileParams']).toEqual(['reference']);
    expect(upload.inputSchema.properties.reference.properties).toHaveProperty('download_url');
    expect(upload.inputSchema.properties.reference.properties).toHaveProperty('file_id');
    const feedback=list.result.tools.find((tool:{name:string})=>tool.name==='set_item_feedback');
    expect(feedback.annotations).toMatchObject({readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false});
    expect(feedback._meta.ui.visibility).toEqual(['model','app']);
    const deletion=list.result.tools.find((tool:{name:string})=>tool.name==='forget_search');
    expect(deletion.annotations).toMatchObject({readOnlyHint:false,destructiveHint:true,idempotentHint:true});
    const refinement=list.result.tools.find((tool:{name:string})=>tool.name==='refine_search');
    expect(refinement.annotations).toMatchObject({readOnlyHint:true,idempotentHint:false,openWorldHint:false});
    const resources=await rpc('resources/read',{uri:'ui://sellpy/gallery-v3.html'});
    const legacy=await rpc('resources/read',{uri:'ui://sellpy/gallery-v2.html'});
    expect(legacy.result.contents[0].text).toBe(resources.result.contents[0].text);
    expect(resources.result.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    expect(resources.result.contents[0].text).toContain('Sellpy');
  });
  it('returns a recoverable error for a search that does not exist',async()=>{
    const result=await rpc('tools/call',{name:'get_search_status',arguments:{run_id:crypto.randomUUID()}});
    expect(result.result.isError).toBe(true);
    expect(result.result.structuredContent.error.code).toBe('search_not_found');
    expect(result.result.structuredContent.error.retryable).toBe(false);
    expect(result.result.structuredContent.error.next_action).toContain('run_id');
  });
});
