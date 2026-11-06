import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Candidate, ItemObservation, SearchPlan, SearchPage } from './domain.js';
import { ToolError } from './domain.js';
import { inputSchemas, type ToolName } from './schemas.js';
import { catalogPlan, imagePlan, outfitPlan, similarPlan, stylePlan } from './planning.js';
import { createProviderContext } from './traffic.js';
import { createSellpyProvider } from './sellpy/client.js';
import { loadImages, prepareReference } from './images.js';
import { buildGallery, galleryResult } from './presentation.js';

export interface ToolContext {
  env: Env;
  principal: string;
  deadline: number;
  signal?: AbortSignal;
}

function payload(data: unknown, summary: string): CallToolResult {
  return { content:[{type:'text',text:summary}], structuredContent:JSON.parse(JSON.stringify(data)) as Record<string,unknown> };
}

function errorPayload(error: unknown): CallToolResult {
  const fields = error !== null && typeof error === 'object' ? error as Record<string,unknown> : {};
  const rpcError = typeof fields.code === 'string' && /^[a-z][a-z0-9_]{0,80}$/.test(fields.code) &&
    typeof fields.message === 'string' && typeof fields.retryable === 'boolean' && typeof fields.next_action === 'string'
    ? new ToolError(fields.code, fields.message.slice(0,2000), { retryable: fields.retryable,
      next_action: fields.next_action.slice(0,2000),
      ...(typeof fields.retry_at === 'string' && Number.isFinite(Date.parse(fields.retry_at)) ? {retry_at: fields.retry_at} : {}) }) : null;
  const known = error instanceof ToolError ? error : rpcError ?? new ToolError('tool_error', 'This operation did not complete.', {
    retryable:true, next_action:'Retry this operation; existing search progress is retained.'
  });
  return { ...payload({error:known.toJSON()}, `${known.message} ${known.next_action}`), isError:true };
}

export function encodeCursor(data: Record<string,unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

export function decodeCursor(cursor: string): Record<string,unknown> {
  try {
    if (cursor.length > 32000 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));
    if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error();
    return value as Record<string,unknown>;
  } catch { throw new ToolError('invalid_cursor','This continuation cursor is invalid.', {next_action:'Use the exact next_cursor returned by the tool.'}); }
}

function actor(context:ToolContext, runId:string) {
  const parsed = inputSchemas.get_search_status.parse({run_id:runId});
  return context.env.SEARCH_RUNS.getByName(`${context.principal}:${parsed.run_id}`);
}

function providerContext(context:ToolContext) {
  return createProviderContext(context.env,context.deadline,context.signal);
}

export function compactItem(item:ItemObservation) {
  return {
    id:item.id,title:item.title,brand:item.brand,url:item.url,market:item.market,
    price:item.price,
    price_display:item.price ? new Intl.NumberFormat(item.language,{style:'currency',currency:item.price.currency}).format(item.price.amount_minor/100) : null,
    size:item.size,size_system:item.size_system,condition:item.condition,categories:item.categories,
    colors:item.colors,materials:item.materials,availability:item.availability,
    cover:item.images[0] ?? null,image_count:item.images.length,observed_at:item.observed_at
  };
}

function compactCandidate(candidate:Candidate) {
  return { ...compactItem(candidate.item),retrieval_paths:candidate.paths,visual_checked:candidate.assessment!==null,
    assessment:candidate.assessment };
}

function searchResult(page:SearchPage):CallToolResult {
  return payload({...page,items:page.items.map(compactCandidate)},
    `${page.items.length} items in this page; ${page.coverage.unique_items} unique candidates discovered. `+
    (page.next_cursor ? 'Continue with next_cursor for more. ' : 'This set of search routes has ended. ')+
    'Inspect actual image content before visual judgments; use present_items for each recommended item.');
}

async function start(plan:SearchPlan, context:ToolContext):Promise<CallToolResult> {
  const runId=crypto.randomUUID();
  const run=actor(context,runId);
  const references=plan.arms.flatMap(arm=>arm.reference?[arm.reference]:[]);
  const stored=new Set<string>();
  for (const reference of references) {
    if (stored.has(reference.file_id)) continue;
    const file=await prepareReference(reference,providerContext(context));
    await run.storeReference(reference.file_id,file.bytes,file.mime_type,file.file_name);
    stored.add(reference.file_id);
  }
  return searchResult(await run.start(plan,runId,context.deadline));
}

async function getCandidates(context:ToolContext, runId:string, ids:string[], refresh=false):Promise<{candidates:Candidate[];warnings:string[]}> {
  const run=actor(context,runId);
  const old=await run.getCandidates(ids);
  const byId=new Map(old.map(candidate=>[candidate.item.id,candidate]));
  const stale=ids.filter(id=>{
    const candidate=byId.get(id);
    return !candidate || (refresh && (candidate.item.source!=='detail' || !Number.isFinite(Date.parse(candidate.item.observed_at)) || Date.now()-Date.parse(candidate.item.observed_at)>120000));
  });
  const warnings:string[]=[];
  if (stale.length) {
    const {plan}=await run.status();
    const details=await createSellpyProvider().details(stale,plan.market,plan.language,providerContext(context));
    await run.updateItems(details.items);
    for (const failure of details.failures) warnings.push(`Item ${failure.id} could not be fully refreshed: ${failure.error.message} Any displayed facts retain their observation time.`);
    for (const id of details.remaining_ids) warnings.push(`Item ${id} still needs a current detail check; this call reached its work budget.`);
  }
  return {candidates:await run.getCandidates(ids),warnings};
}

async function present(args:unknown, context:ToolContext):Promise<CallToolResult> {
  const input=inputSchemas.present_items.parse(args);
  const run=actor(context,input.run_id);
  let selectionId:string;
  let offset=0;
  if (input.cursor) {
    const cursor=decodeCursor(input.cursor);
    if (cursor.kind!=='presentation' || cursor.v!==1 || cursor.run_id!==input.run_id || typeof cursor.selection_id!=='string' ||
      !Number.isSafeInteger(cursor.offset) || Number(cursor.offset)<0) throw new ToolError('invalid_cursor','This is not a presentation cursor for this search.');
    selectionId=cursor.selection_id;
    offset=Number(cursor.offset);
  } else {
    if (!input.selection) throw new ToolError('selection_required','Provide a ranked selection or its presentation cursor.');
    selectionId=crypto.randomUUID();
    await run.storePresentation(selectionId,{title:input.title,selection:input.selection,page_size:input.page_size});
  }
  const saved=await run.getPresentation(selectionId);
  if (!saved) throw new ToolError('selection_not_found','This saved selection is not available in this search.');
  const selection=saved.selection.slice(offset,offset+saved.page_size);
  const {candidates,warnings}=await getCandidates(context,input.run_id,selection.map(entry=>entry.item_id),true);
  const {plan}=await run.status();
  const nextOffset=offset+selection.length;
  const next=nextOffset<saved.selection.length ? encodeCursor({v:1,kind:'presentation',run_id:input.run_id,selection_id:selectionId,offset:nextOffset}) : null;
  warnings.push(...selection.filter(entry=>!candidates.some(candidate=>candidate.item.id===entry.item_id)).map(entry=>`Item ${entry.item_id} could not be refreshed or found.`));
  const gallery=buildGallery({run_id:input.run_id,language:plan.language,title:saved.title,candidates,selection,next_cursor:next,warnings});
  const hydration:Record<string,string>={};
  let byteBudget=6*1024*1024;
  for (const card of gallery.cards) {
    if (Date.now()+500>=context.deadline || byteBudget<200000) break;
    const cover=card.item.images[0];
    if (!cover) continue;
    const images=await loadImages(card.item,cover.index,1,providerContext(context),{for_model:false,byte_budget:byteBudget});
    Object.assign(hydration,images.hydration);
    byteBudget-=Object.values(images.hydration).reduce((sum,data)=>sum+data.length,0);
    for (const failure of images.images.filter(image=>image.status==='failed')) gallery.warnings.push(`Image ${failure.id}: ${failure.error?.message ?? 'unavailable'}`);
  }
  return galleryResult(gallery,hydration);
}

export async function invokeTool(name:ToolName,args:unknown,context:ToolContext):Promise<CallToolResult> {
  try {
    switch(name) {
      case 'get_capabilities': {
        inputSchemas.get_capabilities.parse(args);
        const capabilities=await createSellpyProvider().capabilities(providerContext(context));
        return payload({...capabilities,plugin_version:context.env.VERSION,
          cumulative_limits:{pages:null,items:null,details:null,images:null,automatic_search_expiry:null},
          operating_bounds:{call_deadline_seconds:35,search_page_default:50,search_page_max:200,image_response_bytes:6*1024*1024},
          presentation:'MCP Apps gallery plus original-image Markdown fallback',
          visual_evidence:'Actual model-visible image content must precede recorded visual assessments.'},'Current provider capabilities and explicit operating bounds. Null cumulative limits mean no plugin-imposed lifetime count cap.');
      }
      case 'discover_filters': {
        const input=inputSchemas.discover_filters.parse(args);
        return payload(await createSellpyProvider().facets(input.query,input.filters??{},input.market,input.language,providerContext(context)),
          'Use these exact current facet names and values. Price bounds use major units of the selected market currency.');
      }
      case 'search_items':return await start(catalogPlan(inputSchemas.search_items.parse(args)),context);
      case 'search_style':return await start(stylePlan(inputSchemas.search_style.parse(args)),context);
      case 'find_similar':return await start(similarPlan(inputSchemas.find_similar.parse(args)),context);
      case 'search_by_image': {
        const input=inputSchemas.search_by_image.parse(args);
        if (Boolean(input.reference)===Boolean(input.image_url)) throw new ToolError('image_input_required','Provide exactly one reference file or Sellpy image URL.');
        return await start(imagePlan(input),context);
      }
      case 'find_outfit':return await start(outfitPlan(inputSchemas.find_outfit.parse(args)),context);
      case 'continue_search': {
        const {cursor}=inputSchemas.continue_search.parse(args);
        const decoded=decodeCursor(cursor);
        if (typeof decoded.run_id!=='string') throw new ToolError('invalid_cursor','The search cursor has no run identity.');
        return searchResult(await actor(context,decoded.run_id).continue(cursor,context.deadline));
      }
      case 'get_search_status': {
        const {run_id}=inputSchemas.get_search_status.parse(args);
        const status=await actor(context,run_id).status();
        const plan={...status.plan,arms:status.plan.arms.map(arm=>({...arm,reference:arm.reference?{file_id:arm.reference.file_id,mime_type:arm.reference.mime_type}:undefined}))};
        return payload({run_id,...status,plan},'Current search progress and observed coverage. Source totals are not visually verified totals.');
      }
      case 'list_search_items': {
        const input=inputSchemas.list_search_items.parse(args);
        const page=await actor(context,input.run_id).listCandidates(input.offset,input.page_size);
        return payload({run_id:input.run_id,...page,items:page.items.map(compactCandidate)},'Previously discovered candidates, without a new provider search.');
      }
      case 'get_items': {
        const input=inputSchemas.get_items.parse(args);
        const runId=input.run_id??crypto.randomUUID();
        const run=actor(context,runId);
        if (!input.run_id) await run.start({market:input.market,language:input.language,page_size:50,intent:{query:'Inspect selected items'},arms:[]},runId,context.deadline);
        const {plan}=await run.status();
        const ids=[...new Set(input.ids)];
        const page=ids.slice(input.start_index,input.start_index+input.batch_size);
        const result=await createSellpyProvider().details(page,plan.market,plan.language,providerContext(context));
        await run.updateItems(result.items);
        const processed=page.length-result.remaining_ids.length;
        const next=input.start_index+processed;
        return payload({run_id:runId,...result,next_index:next<ids.length?next:null,
          remaining_ids:[...result.remaining_ids,...ids.slice(input.start_index+page.length)]},
          'Current canonical details and complete available image references. Follow next_index with the same IDs; offsets refer to first-occurrence deduplicated IDs. Failed IDs remain explicit.');
      }
      case 'get_item_images': {
        const input=inputSchemas.get_item_images.parse(args);
        const {candidates}=await getCandidates(context,input.run_id,[input.item_id]);
        const item=candidates[0]?.item;
        if (!item) throw new ToolError('item_not_found','This item could not be loaded.');
        const batch=await loadImages(item,input.start_index,input.batch_size,providerContext(context),{for_model:input.for_model});
        if (input.for_model && batch.delivered_ids.length) await actor(context,input.run_id).markImagesDelivered(item.id,batch.delivered_ids);
        const {contents,hydration,delivered_ids,...result}=batch;
        const response=payload(result,input.for_model ? 'Actual image content follows in the same order as ready image records. Cite their IDs when recording visual evidence.' : 'Images delivered only to the gallery. This does not establish model visual inspection.');
        response.content.push(...contents);
        response._meta={images:hydration};
        return response;
      }
      case 'record_visual_assessment': {
        const {run_id,...assessment}=inputSchemas.record_visual_assessment.parse(args);
        await actor(context,run_id).recordAssessment({...assessment,assessed_at:new Date().toISOString(),author:'assistant'});
        return payload({run_id,item_id:assessment.item_id,recorded:true},'Visual evidence recorded separately from original shop metadata.');
      }
      case 'present_items':return await present(args,context);
      case 'save_search': {
        const input=inputSchemas.save_search.parse(args);
        await actor(context,input.run_id).status();
        const bookmark={...input,saved_at:new Date().toISOString()};
        await context.env.SEARCH_RUNS.getByName(`${context.principal}:library`).saveBookmark(bookmark);
        return payload(bookmark,'Search saved privately with no automatic expiry.');
      }
      case 'list_saved_searches': {
        const input=inputSchemas.list_saved_searches.parse(args);
        return payload(await context.env.SEARCH_RUNS.getByName(`${context.principal}:library`).listBookmarks(input.offset,input.page_size),'Saved searches belonging to this connection.');
      }
    }
  } catch(error) {
    if (error instanceof Error && error.name==='ZodError') return {isError:true,...payload({error:{code:'invalid_arguments',message:error.message,next_action:'Correct the named input fields.'}},'The tool arguments did not match its schema.')};
    return errorPayload(error);
  }
}
