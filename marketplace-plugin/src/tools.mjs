import { buildSearchLink, getProvider, PERSONAL_TEST, PERSONAL_LIMITS, CLIENT_AGENT, FILTER_SCHEMA, LISTING_SCHEMA, validateFilters } from "./providers.mjs";
import { runStudy, evaluateListing } from "./engine.mjs";

const string = (maxLength) => ({type:"string",minLength:1,maxLength});
const integer = (minimum,maximum) => ({type:"integer",minimum,maximum});
const array = (items,minItems,maxItems) => ({type:"array",items,minItems,maxItems});
const object = (properties, required=[]) => ({type:"object",additionalProperties:false,properties,required});
const queries = array(string(150),1,8);
const criteria = array(object({key:{...string(64),pattern:"^[\\p{L}][\\p{L}\\d _.-]{0,63}$"},value:{anyOf:[
  string(100),{type:"number"},{type:"boolean"}, {...object({min:{type:"number"},max:{type:"number"}}),minProperties:1}
]}},["key","value"]),0,12);
const source = {type:"string", enum:["live","provided","demo"],description:"Use demo only on explicit request to demonstrate synthetic records. Provided covers only submitted records."};
const data = {source,listings:array(LISTING_SCHEMA,0,300)};
const search = {...data,query:string(160),filters:FILTER_SCHEMA};
const spec = {...data,queries,filters:FILTER_SCHEMA,criteria,maxPages:integer(1,32),maxDetails:integer(0,16)};
const handle = {type:"string",pattern:"^ms_[a-f0-9]{32}$"};
const read = {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const def = (name,title,description,inputSchema,annotations=read) => ({name,title,description,inputSchema,annotations});
export const toolDefinitions = [
  def("plan_search","Suche vorbereiten","Plan an actual willhaben search. Returns human search links and site queries for native web search, live availability and detail-only constraints. Use first for real research.",object({queries,filters:FILTER_SCHEMA},["queries"])),
  def("discover_filters","Filter ermitteln","Discover filters in a source for a specific keyword. Include listings for provided. Where possible discover numeric category and facet IDs before narrowing.",object(search,["source","query"]),{...read,openWorldHint:true}),
  def("search_listings","Inserate suchen","Read a result page with source, time and continuation. A null upstream total means unknown. Use study_market for a multi-query study.",object({...search,cursor:string(40)},["source","query"]),{...read,openWorldHint:true}),
  def("inspect_listings","Inserate prüfen","Read up to ten listing details and evidence for explicit criteria. Images are links, never a measured dimension. Include the data for provided.",object({...data,ids:array(string(96),1,10),criteria},["source","ids"]),{...read,openWorldHint:true}),
  def("inspect_listing_image","Inseratfoto ansehen","Retrieve one actual photo (index starts at zero) from a private photo-enabled connection for visual inspection. Geometry from an unscaled image remains unknown.",object({id:string(20),index:integer(0,11)},["id","index"]),{...read,openWorldHint:true}),
  def("study_market","Marktstudie rechnen","Deduplicate multiple queries, check requirements, rank offers and compute asking-price cohorts. Report the source, exclusions, counts, uncertainty and coverage. Request-scoped.",object(spec,["source","queries"]),{...read,openWorldHint:true}),
  def("save_study","Studie für Folgefragen speichern","Only on explicit request to save or compare across chats. Run a study and store its report, search terms and criteria for 24h on Cloudflare. Anyone with its secret ID can read it.",object(spec,["source","queries"]),{...read,readOnlyHint:false,idempotentHint:false,openWorldHint:true}),
  def("get_study","Gespeicherte Studie lesen","Read a previously saved report without fetching fresh listings. Keep the ID private.",object({study_id:handle},["study_id"])),
  def("compare_studies","Zwei Studien vergleichen","Compare two saved observations, including completeness, cohort sample sizes and changes in asking prices. Distinguish changed scopes and capped examples from complete membership.",object({before:handle,after:handle},["before","after"]))
];

function checkArgs(name,args) {
  const d=toolDefinitions.find(t=>t.name===name);
  if (!d || !args || typeof args!=="object" || Array.isArray(args)) throw new Error("Invalid tool or arguments");
  const schema=d.inputSchema;
  for (const key of Object.keys(args)) if(!Object.hasOwn(schema.properties,key)) throw new Error("Unknown argument: "+key);
  for (const key of schema.required) if(args[key]===undefined) throw new Error("Missing argument: "+key);
  for (const key of ["query","cursor"]) if(args[key]!==undefined && (typeof args[key]!=="string" || !args[key].trim() || args[key].length>schema.properties[key].maxLength)) throw new Error("Invalid "+key);
  if (args.queries!==undefined && (!Array.isArray(args.queries) || !args.queries.length || args.queries.length>8 || args.queries.some(q=>typeof q!=="string" || !q.trim() || q.length>150))) throw new Error("Provide 1–8 bounded search variants");
  if (args.filters!==undefined) validateFilters(args.filters);
  if(args.source!==undefined && !source.enum.includes(args.source)) throw new Error("Unknown source");
  if(args.source!==undefined && (args.source==="provided")!==(args.listings!==undefined)) throw new Error("Pass listings exactly when source is provided");
}
const scope = {demo:"Synthetic demonstration catalogue",provided:"Only the submitted listings; upstream marketplace coverage is unknown",live:"Observed willhaben search scope during this run"};
const ttl=86400;

function plan(args,env) {
  const f={...args.filters}, verifyInDetail={};
  for (const key of ["shipping","paylivery"]) if(f[key]!==undefined && (key==="shipping" || f[key]===false)) {verifyInDetail[key]=f[key];delete f[key];}
  return {liveAvailable:env.LIVE_ACCESS===PERSONAL_TEST || (env.LIVE_ACCESS==="authorized" && Boolean(env.MCP_BEARER_TOKEN)),
    imageAvailable:env.LIVE_ACCESS===PERSONAL_TEST && env.IMAGE_ACCESS===PERSONAL_TEST || (env.LIVE_ACCESS==="authorized" && env.IMAGE_ACCESS==="authorized" && Boolean(env.MCP_BEARER_TOKEN)),
    ...(env.LIVE_ACCESS===PERSONAL_TEST ? {mode:PERSONAL_TEST,perCallLimits:PERSONAL_LIMITS}:{}),source:"search_plan",resultCount:null,filtersInLinks:f,verifyInDetail,
    searches:[...new Set(args.queries.map(q=>q.trim()))].map(query=>({query,url:buildSearchLink(query,f),webQuery:"site:willhaben.at/iad/kaufen-und-verkaufen/d/ "+query})),
    guidance:env.LIVE_ACCESS===PERSONAL_TEST ? "Use search_listings with source=live, then inspect_listing_image for one photo from a returned ad ID. Pages are bounded. Report actual coverage." : "Use native web search for indexed leads when available. Verify price, condition, date and URL per source. Index coverage and availability may be unknown. Pass only evidence-backed rows into provided; do not invent missing values."};
}
async function readSaved(id,env) {
  if(typeof id!=="string" || !/^ms_[a-f0-9]{32}$/.test(id)) throw new Error("Invalid study ID");
  if(!env.STUDIES) throw new Error("Snapshot storage is not configured");
  const value=await env.STUDIES.get(id,"json");
  if(!value || Date.parse(value.expiresAt)<=Date.now()) throw new Error("Study unavailable or expired. A new snapshot may take a moment to propagate.");
  return value;
}
function signature(x) {
  if(Array.isArray(x)) return x.map(signature);
  if(x && typeof x==="object") return Object.fromEntries(Object.keys(x).sort().map(k=>[k,signature(x[k])]));
  return x;
}
const equal = (x,y)=>JSON.stringify(signature(x))===JSON.stringify(signature(y));
function compare(before,after) {
  const sameDefinition=equal(before.definition,after.definition);
  const key=c=>JSON.stringify([c.category,c.model,c.condition,c.basis]);
  const previous=new Map(before.report.cohorts.map(c=>[key(c),c]));
  return {sameDefinition,before:{observedAt:before.report.observedAt,coverage:before.report.coverage.status,counts:before.report.counts},after:{observedAt:after.report.observedAt,coverage:after.report.coverage.status,counts:after.report.counts},
    guidance:"Medians describe observed asking-price cohorts. A changed cohort can reflect composition. The samples alone do not establish sales or price revisions of individual listings.",
    cohorts:after.report.cohorts.map(c=>{const a=previous.get(key(c));return {category:c.category,model:c.model,condition:c.condition,basis:c.basis,before:a?.askingEUR??null,after:c.askingEUR,
      medianChangeEUR:sameDefinition && Number.isFinite(a?.askingEUR?.median) && Number.isFinite(c.askingEUR?.median)?Math.round((c.askingEUR.median-a.askingEUR.median)*100)/100:null};}),
    previousOnlyCohorts:before.report.cohorts.filter(c=>!after.report.cohorts.some(n=>key(c)===key(n))).map(c=>({category:c.category,model:c.model,condition:c.condition,basis:c.basis}))};
}

export async function invokeTool(name,args,env={}) {
  checkArgs(name,args);
  if(name==="plan_search") return plan(args,env);
  if(name==="get_study") return readSaved(args.study_id,env);
  if(name==="compare_studies") return compare(await readSaved(args.before,env),await readSaved(args.after,env));
  if(name==="save_study" && !env.STUDIES) throw new Error("Snapshot storage is not configured");
  if(name==="inspect_listing_image") return readImage(args,env);
  const provider=getProvider(args.source,env,args.listings);
  const meta={source:provider.kind,scope:scope[provider.kind],observedAt:new Date().toISOString()};
  if(name==="discover_filters") return {...meta,facets:await provider.facets({query:args.query,filters:args.filters??{}})};
  if(name==="search_listings") return {...meta,...await provider.search({query:args.query,filters:args.filters??{},cursor:args.cursor??null})};
  if(name==="inspect_listings") {
    if(!Array.isArray(args.ids) || !args.ids.length || args.ids.length>10 || args.ids.some(s=>typeof s!=="string" || !/^[A-Za-z0-9_-]{1,96}$/.test(s))) throw new Error("Provide 1–10 listing IDs");
    if(provider.kind==="live" && env.LIVE_ACCESS===PERSONAL_TEST && new Set(args.ids).size>PERSONAL_LIMITS.details) throw new Error("Choose at most two ads per personal detail request");
    const results=[];
    for(const id of new Set(args.ids)) {
      const row=await provider.detail(id);
      results.push(row?{id,listing:row,evaluation:evaluateListing(row,args.criteria??[])}:{id,status:"unavailable"});
    }
    return {...meta,results};
  }
  const definition={source:args.source,queries:args.queries,filters:args.filters??{},criteria:args.criteria??[],maxPages:args.maxPages??12,maxDetails:args.maxDetails??8};
  if(provider.kind==="live" && env.LIVE_ACCESS===PERSONAL_TEST) {
    definition.maxPages=Math.min(definition.maxPages, PERSONAL_LIMITS.pages);
    definition.maxDetails=Math.min(definition.maxDetails, PERSONAL_LIMITS.details);
  }
  const report=await runStudy(provider,definition);
  if(name==="study_market") return report;
  const study_id="ms_"+crypto.randomUUID().replaceAll("-","");
  const expiresAt=new Date(Date.now()+ttl*1000).toISOString();
  const value=JSON.stringify({definition,report,expiresAt});
  if(new TextEncoder().encode(value).length>700000) throw new Error("Report too large to save; narrow the study");
  await env.STUDIES.put(study_id,value,{expirationTtl:ttl});
  return {study_id,expiresAt,report};
}

async function readImage({id,index},env) {
  const personal=env.LIVE_ACCESS===PERSONAL_TEST && env.IMAGE_ACCESS===PERSONAL_TEST;
  if(!personal && (env.LIVE_ACCESS!=="authorized" || env.IMAGE_ACCESS!=="authorized" || !env.MCP_BEARER_TOKEN))
    throw new Error("Photo retrieval requires authorized live and image access. Use a photo supplied in this chat for visual inspection.");
  if(!/^\d{1,20}$/.test(id) || !Number.isInteger(index) || index<0 || index>11) throw new Error("Invalid listing ID or photo index");
  const row=await getProvider("live",env).detail(id);
  if(!row?.images?.[index]) throw new Error("Photo unavailable");
  const url=new URL(row.images[index]);
  if(url.origin!=="https://cache.willhaben.at" || !url.pathname.startsWith("/mmo/") || url.username || url.password) throw new Error("Unexpected photo source");
  const r=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(8000),headers:{"User-Agent":CLIENT_AGENT,Accept:"image/webp,image/jpeg,image/png"}});
  const mimeType=r.headers.get("content-type")?.split(";")[0].toLowerCase();
  const max=1536*1024;
  if(!r.ok || !["image/jpeg","image/png","image/webp"].includes(mimeType) || Number(r.headers.get("content-length"))>max || !r.body) {
    await r.body?.cancel();
    throw new Error("Unsupported or unavailable photo (maximum 1.5 MiB)");
  }
  const reader=r.body.getReader(), blocks=[]; let bytes=0;
  try {
    for(;;) {
      const {done,value}=await reader.read();
      if(done) break;
      bytes+=value.length;
      if(bytes>max) {await reader.cancel();throw new Error("Photo exceeds 1.5 MiB");}
      for(let pos=0;pos<value.length;pos+=8192) blocks.push(String.fromCharCode(...value.subarray(pos,pos+8192)));
    }
  } finally {reader.releaseLock();}
  if(!bytes) throw new Error("Empty photo");
  return {metadata:{source:"live",id,index,url:url.href,observedAt:new Date().toISOString()},image:{type:"image",data:btoa(blocks.join("")),mimeType}};
}
