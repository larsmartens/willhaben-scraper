import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Candidate, ItemObservation, SearchPlan, SearchPage } from './domain.js';
import { ToolError } from './domain.js';
import { inputSchemas, type ToolName } from './schemas.js';
import { catalogPlan, imagePlan, outfitPlan, similarPlan, stylePlan } from './planning.js';
import { createProviderContext } from './traffic.js';
import { sharedSellpyProvider } from './sellpy/client.js';
import { loadImages, prepareReference } from './images.js';
import { buildGallery, galleryResult } from './presentation.js';
import type { RankingPreferences } from './refinement.js';
import type { RefinementPage } from './research-store.js';
import { itemSnapshot, observationChanges } from './observations.js';
import { commonSourceFacets } from './facet-evidence.js';
import { MARKETS } from './sellpy/normalize.js';

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

function library(context: ToolContext) { return context.env.SEARCH_RUNS.getByName(`${context.principal}:library`); }

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

async function searchResponse(page: SearchPage, context: ToolContext, step = 0): Promise<CallToolResult> {
  const run = actor(context, page.run_id);
  const { plan } = await run.status();
  const result = searchResult(page);
  const data = result.structuredContent as Record<string, unknown>;
  data.refinement_hint = 'Use refine_search to apply explicit preferences, requirements and feedback to discovered candidates. Check unknown visual criteria on original photos, then start a new refinement.';
  if (plan.refresh_of) {
    const saved = await run.responseNotes(step);
    if (saved) { Object.assign(data, saved); return result; }
    const notes: Record<string, unknown> = {};
    try {
      const old = actor(context, plan.refresh_of);
      const ids = page.items.map(candidate => candidate.item.id);
      const [previous, feedback] = await Promise.all([old.getCandidates(ids), old.getFeedback(ids)]);
      const byId = new Map(previous.map(candidate => [candidate.item.id, candidate]));
      await run.inheritFeedback(Object.values(feedback));
      notes.refresh_comparison = { previous_run_id: plan.refresh_of,
        newly_encountered_ids: ids.filter(id => !byId.has(id)), previously_seen_ids: ids.filter(id => byId.has(id)),
        observed_changes: page.items.flatMap(candidate => {
          const before = byId.get(candidate.item.id);
          const change = before ? observationChanges(itemSnapshot(before.item), itemSnapshot(candidate.item)) : null;
          return change ? [change] : [];
        }), scope: 'This page compared with candidates actually discovered in the previous run. Newly encountered does not mean newly listed on Sellpy.' };
    } catch (error) {
      notes.refresh_comparison = { previous_run_id: plan.refresh_of, unavailable: true,
        reason: error instanceof ToolError ? error.code : 'previous_run_unavailable' };
    }
    Object.assign(data, await run.saveResponseNotes(step, notes));
  }
  return result;
}

function refinementResponse(page: RefinementPage): CallToolResult {
  return payload({ ...page, items: page.items.map(entry => ({ ...compactCandidate(entry.candidate), evaluation: entry.evaluation,
    score: entry.score, diversity_penalty: entry.diversity_penalty,
    ...(entry.response_omissions ? { response_omissions: entry.response_omissions } : {}) })) },
  `${page.items.length} ranked candidates; ${page.coverage.evaluated}/${page.coverage.cohort_total} evaluated, ${page.coverage.excluded} excluded. ` +
    'Unknown requirements are not confirmed. Scores are disclosed heuristics, not probabilities. Check detail_only_items and response_omissions for individually large evidence. Follow next_cursor with refine_search. Original search pages remain unchanged.');
}

async function refine(args: unknown, context: ToolContext): Promise<CallToolResult> {
  const input = inputSchemas.refine_search.parse(args);
  const run = actor(context, input.run_id);
  if (input.cursor) {
    if (input.preferences || input.profile || !input.use_profile) throw new ToolError('immutable_refinement', 'Use a new refinement to change criteria. Continuation uses its saved preferences and feedback.');
    const cursor = decodeCursor(input.cursor);
    if (cursor.v !== 1 || cursor.kind !== 'refinement' || cursor.run_id !== input.run_id ||
      typeof cursor.refinement_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(cursor.refinement_id) ||
      !Number.isSafeInteger(cursor.step) || Number(cursor.step) < 1) throw new ToolError('invalid_cursor', 'Use this search’s refinement next_cursor.');
    return refinementResponse(await run.continueRefinement(cursor.refinement_id, Number(cursor.step)));
  }
  const [{ plan }, profile] = await Promise.all([run.status(),
    input.use_profile ? library(context).getProfile(input.profile ?? 'default') : Promise.resolve(null)]);
  if (input.profile && input.use_profile && !profile) throw new ToolError('profile_not_found', 'This preference profile has not been saved.');
  const filters = plan.arms[0]?.filters;
  const requirements = [
    ...(plan.intent.desired_type ? [{ requirement: `Garment type: ${plan.intent.desired_type}`, priority: 'require' as const }] : []),
    ...(plan.intent.style ? [{ requirement: `Style: ${plan.intent.style}`, priority: 'require' as const }] : []),
    ...(plan.intent.include ?? []).map(requirement => ({ requirement, priority: 'require' as const })),
    ...(plan.intent.exclude ?? []).map(requirement => ({ requirement, priority: 'avoid' as const })),
  ];
  const preferences: RankingPreferences = {
    ...(filters?.price_min !== undefined ? { price_min: filters.price_min } : {}),
    ...(filters?.price_max !== undefined ? { price_max: filters.price_max } : {}),
    ...(filters?.measurements ? { measurements: filters.measurements } : {}),
    ...(filters?.include_reserved !== undefined ? { include_reserved: filters.include_reserved } : {}),
    ...(MARKETS[plan.market] ? { currency: MARKETS[plan.market]!.currency } : {}),
    source_facets: commonSourceFacets(plan),
    ...profile?.preferences,
    ...(requirements.length ? { requirements: [...(profile?.preferences.requirements ?? []), ...requirements] } : {}),
    ...input.preferences,
  };
  return refinementResponse(await run.refine(input.run_id, preferences, input.page_size));
}

async function start(plan:SearchPlan, context:ToolContext):Promise<CallToolResult> {
  const runId=crypto.randomUUID();
  const run=actor(context,runId);
  const references=plan.arms.flatMap(arm=>arm.reference?[arm.reference]:[]);
  const stored=new Set<string>();
  for (const reference of references) {
    if (stored.has(reference.file_id)) continue;
    const file = plan.refresh_of ? await actor(context, plan.refresh_of).getReference(reference.file_id)
      : await prepareReference(reference,providerContext(context));
    if (!file) throw new ToolError('reference_unavailable', 'The previous search’s reference image is unavailable. Attach it again to start a new image search.');
    await run.storeReference(reference.file_id,file.bytes,file.mime_type,file.file_name);
    stored.add(reference.file_id);
  }
  return searchResponse(await run.start(plan,runId,context.deadline), context);
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
    const details=await sharedSellpyProvider.details(stale,plan.market,plan.language,providerContext(context));
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
  const feedback = await run.getFeedback(selection.map(entry => entry.item_id));
  const gallery=buildGallery({run_id:input.run_id,language:plan.language,title:saved.title,candidates,selection,next_cursor:next,warnings,feedback});
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
        const capabilities=await sharedSellpyProvider.capabilities(providerContext(context));
        return payload({...capabilities,plugin_version:context.env.VERSION,
          cumulative_limits:{pages:null,items:null,details:null,images:null,automatic_search_expiry:null},
          operating_bounds:{call_deadline_seconds:35,search_page_default:50,search_page_max:200,image_response_bytes:6*1024*1024},
          presentation:'MCP Apps gallery plus original-image Markdown fallback',
          research_features:['constraint-aware refinement','explicit shortlist and rejection','preference profiles','observed change history','fresh search restart','private search deletion','side-by-side comparison'],
          visual_evidence:'Actual model-visible image content must precede recorded visual assessments.'},'Current provider capabilities and explicit operating bounds. Null cumulative limits mean no plugin-imposed lifetime count cap.');
      }
      case 'discover_filters': {
        const input=inputSchemas.discover_filters.parse(args);
        return payload(await sharedSellpyProvider.facets(input.query,input.filters??{},input.market,input.language,providerContext(context)),
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
        return await searchResponse(await actor(context,decoded.run_id).continue(cursor,context.deadline), context, Number(decoded.step));
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
        const result=await sharedSellpyProvider.details(page,plan.market,plan.language,providerContext(context));
        const observed_changes = await run.updateItems(result.items);
        const processed=page.length-result.remaining_ids.length;
        const next=input.start_index+processed;
        return payload({run_id:runId,...result,observed_changes,next_index:next<ids.length?next:null,
          remaining_ids:[...result.remaining_ids,...ids.slice(input.start_index+page.length)]},
          'Current canonical details and complete available image references. Follow next_index with the same IDs; offsets refer to first-occurrence deduplicated IDs. Failed IDs remain explicit.');
      }
      case 'get_item_images': {
        const input=inputSchemas.get_item_images.parse(args);
        const {candidates,warnings}=await getCandidates(context,input.run_id,[input.item_id],true);
        const item=candidates[0]?.item;
        if (!item) throw new ToolError('item_not_found','This item could not be loaded.');
        const batch=await loadImages(item,input.start_index,input.batch_size,providerContext(context),{for_model:input.for_model});
        if (input.for_model && batch.delivered_ids.length) await actor(context,input.run_id).markImagesDelivered(item.id,batch.delivered_ids);
        const {contents,hydration,delivered_ids,...result}=batch;
        const response=payload({...result,warnings},input.for_model ? 'Actual image content follows in the same order as ready image records. Cite their IDs when recording visual evidence.' : 'Images delivered only to the gallery. This does not establish model visual inspection.');
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
      case 'get_preferences': {
        const input = inputSchemas.get_preferences.parse(args);
        return payload({ profile: await library(context).getProfile(input.profile) }, 'Saved criteria for this private connection. A missing profile has no implicit preferences.');
      }
      case 'set_preferences': {
        const input = inputSchemas.set_preferences.parse(args);
        return payload({ profile: await library(context).setProfile(input.profile, input.preferences) }, 'Preference profile saved. Refinement applies the default profile unless disabled; explicit fields override it.');
      }
      case 'set_item_feedback': {
        const input = inputSchemas.set_item_feedback.parse(args);
        const feedback = await actor(context, input.run_id).setFeedback(input.item_id, input.decision, input.reason);
        return payload({ run_id: input.run_id, item_id: input.item_id, feedback }, 'Explicit user decision saved. Start a new refinement to apply it; existing cursor receipts stay unchanged.');
      }
      case 'list_item_feedback': {
        const input = inputSchemas.list_item_feedback.parse(args);
        const run = actor(context, input.run_id);
        const result = await run.listFeedback(input.decision, input.after, input.page_size);
        const items = await run.getCandidates(result.items.map(item => item.item_id));
        const byId = new Map(items.map(item => [item.item.id, item]));
        return payload({ run_id: input.run_id, ...result, items: result.items.map(item => ({ ...item,
          candidate: byId.has(item.item_id) ? compactCandidate(byId.get(item.item_id)!) : null })) }, 'Saved user decisions and stored facts. Use get_items for fresh prices and present_items for an illustrated shortlist.');
      }
      case 'refine_search': return await refine(args, context);
      case 'get_item_history': {
        const input = inputSchemas.get_item_history.parse(args);
        return payload({ run_id: input.run_id, item_id: input.item_id, ...await actor(context, input.run_id).itemHistory(input.item_id, input.after, input.page_size),
          scope: 'Snapshots actually observed within this run. Unchanged repeat observations may be coalesced. No source price history or future prices are inferred.' }, 'Observed price, availability and attribute changes. Follow next_after for all recorded snapshots.');
      }
      case 'refresh_search': {
        const input = inputSchemas.refresh_search.parse(args);
        const { plan } = await actor(context, input.run_id).status();
        return await start({ ...plan, refresh_of: input.run_id, ...(input.page_size ? { page_size: input.page_size } : {}) }, context);
      }
      case 'forget_search': {
        const input = inputSchemas.forget_search.parse(args);
        await actor(context, input.run_id).forget();
        await library(context).removeBookmark(input.run_id);
        return payload({ run_id: input.run_id, deleted: true }, 'This search, its retained references and its bookmark were deleted. Other searches and preference profiles are separate.');
      }
    }
  } catch(error) {
    if (error instanceof Error && error.name==='ZodError') return {isError:true,...payload({error:{code:'invalid_arguments',message:error.message,next_action:'Correct the named input fields.'}},'The tool arguments did not match its schema.')};
    return errorPayload(error);
  }
}
