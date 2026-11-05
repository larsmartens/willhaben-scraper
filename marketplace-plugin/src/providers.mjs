/** Read-only catalogue adapters. A provider instance lasts for one tool call. */
const ORIGIN = "https://www.willhaben.at";
const SEARCH = "/iad/kaufen-und-verkaufen/marktplatz";
const CONDITIONS = {new:22, as_new:2546, refurbished:5013256, used:23, defective:24, display_item:2539};
const SORTS = {newest:1, price_asc:3, price_desc:4, relevance:7};
const MAX_PROVIDED = 300;
const PAGE_SIZE = 30;
const plain = v => v !== null && typeof v === "object" && !Array.isArray(v);
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
const invalid = msg => fail("invalid_input", msg);
const schemaError = msg => fail("upstream_schema",msg);
const positive = {type:"integer", minimum:1, maximum:2147483647};
const money = {type:"number", minimum:0, maximum:1000000000};
const choice = (...values) => ({type:"string",enum:values});
const str = maxLength => ({type:"string",minLength:1,maxLength});
const ids = {type:"array", maxItems:12, uniqueItems:true, items:positive};
const filterFields = {
  priceMin:money, priceMax:money, condition:choice(...Object.keys(CONDITIONS)),
  categoryId:positive, areaId:positive, sellerType:choice("private","dealer"),
  paylivery:{type:"boolean"}, shipping:choice("shipping","pickup"),
  sort:choice(...Object.keys(SORTS)), attributeIds:ids
};
export const FILTER_SCHEMA = {type:"object",additionalProperties:false, properties:filterFields};
const itemFields = {
  id:str(96), title:str(300), url:str(1200), price:{anyOf:[money,{type:"null"}]},
  quantity:{type:"integer",minimum:1,maximum:100000}, shippingCost:money,
  priceType:choice("asking","free","negotiable","on_request"), status:choice("active","reserved","sold","inactive","expired","deleted","unknown"),
  condition:filterFields.condition, location:str(150), shipping:choice("shipping","pickup","both"),
  category:str(160), description:str(6000), model:str(180), categoryId:positive, areaId:positive, categoryPathIds:ids, areaPathIds:ids,
  sellerType:filterFields.sellerType, paylivery:{type:"boolean"}, attributeIds:ids,
  attributes:{type:"object",maxProperties:45,additionalProperties:{type:["string","number","boolean"]}},
  images:{type:"array",maxItems:12,items:str(1200)}, publishedAt:str(36)
};
export const LISTING_SCHEMA = {type:"object",required:["id","title","price"],additionalProperties:false,properties:itemFields};
const textFrom = (v, limit) => typeof v === "string" ? v.trim().slice(0,limit) : "";
function validateValue(v, def, key) {
  if (def.anyOf) { if (v !== null) validateValue(v, money, key); return; }
  if (def.enum && !def.enum.includes(v)) invalid("Invalid " + key + "; expected " + def.enum.join(", "));
  if (def.type === "string" && (typeof v !== "string" || !v.trim() || v.length > (def.maxLength ?? 150))) invalid("Invalid " + key);
  if (def.type === "boolean" && typeof v !== "boolean") invalid("Invalid " + key);
  if (["integer","number"].includes(def.type) && (!Number.isFinite(v) || v < def.minimum || v > def.maximum || (def.type === "integer" && !Number.isInteger(v)))) invalid("Invalid " + key);
  if (def.type === "array") {
    if (!Array.isArray(v) || v.length > def.maxItems || (def.uniqueItems && new Set(v).size !== v.length)) invalid("Invalid " + key);
    v.forEach(x=>validateValue(x,def.items,key));
  }
}
function checkObject(obj, fields) {
  if (!plain(obj)) invalid("Expected an object");
  for (const [k,v] of Object.entries(obj)) {
    if (!Object.hasOwn(fields,k)) invalid("Unknown field: "+k);
    validateValue(v,fields[k],k);
  }
}
export function validateFilters(filters={}) {
  checkObject(filters,filterFields);
  if (filters.priceMin > filters.priceMax) invalid("priceMin exceeds priceMax");
  return {...filters};
}
function queryText(query) {
  if (typeof query !== "string" || query.length > 160) invalid("query must be text, max 160 characters");
  return query.trim();
}
const fold = s => String(s??"").toLowerCase().normalize("NFKD").replace(/\p{M}/gu,"").replaceAll("ß","ss");
function parseCursor(cursor) {
  if (cursor == null) return 1;
  if (typeof cursor !== "string" || !/^[1-9]\d{0,4}$/.test(cursor)) invalid("Invalid page cursor");
  return Number(cursor);
}
export function buildSearchLink(query,filters={}) {
  const kw=queryText(query), f=validateFilters(filters);
  if (f.shipping !== undefined) fail("unsupported_filter","Shipping and pickup require detail evidence. Remove the shipping filter and inspect handover separately.");
  if (f.paylivery === false) fail("unsupported_filter","The native search supports PayLivery-only, not exclusion of PayLivery.");
  const u=new URL(SEARCH,ORIGIN);
  if (kw) u.searchParams.set("keyword",kw);
  for (const [k,v] of Object.entries({PRICE_FROM:f.priceMin,PRICE_TO:f.priceMax,ATTRIBUTE_TREE:f.categoryId,areaId:f.areaId,ISPRIVATE:f.sellerType===undefined?undefined:f.sellerType==="private"?1:0,sort:SORTS[f.sort],paylivery:f.paylivery || undefined})) {
    if(v!==undefined) u.searchParams.set(k,String(v));
  }
  for (const n of [CONDITIONS[f.condition],...(f.attributeIds??[])]) if(n) u.searchParams.append("treeAttributes",String(n));
  return u.href;
}
function safeWebUrl(value, type) {
  if (typeof value!=="string" || value.length>1200) return null;
  let u;
  try {u=new URL(value);} catch {return null;}
  if (u.protocol!=="https:" || u.username || u.password || u.port) return null;
  if (type==="image") return u.hostname==="cache.willhaben.at" && (u.pathname.startsWith("/mmo/") || /\.(?:jpe?g|webp|png|avif)$/i.test(u.pathname)) ? u.href : null;
  if (!["willhaben.at","www.willhaben.at"].includes(u.hostname)) return null;
  if (u.pathname.startsWith("/iad/kaufen-und-verkaufen/d/") || (u.pathname==="/iad/object" && /^\d+$/.test(u.searchParams.get("adId")??""))) return u.href;
  return null;
}
const objectUrl = id => ORIGIN + "/iad/object?adId="+encodeURIComponent(id);
function validatedItem(item) {
  checkObject(item,itemFields);
  for(const k of LISTING_SCHEMA.required) if(!Object.hasOwn(item,k)) invalid("Required field missing: "+k);
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(item.id)) invalid("Invalid listing id");
  if (item.url && !safeWebUrl(item.url,"ad")) invalid("Use an HTTPS willhaben Marketplace listing URL");
  if (item.images?.some(u=>!safeWebUrl(u,"image"))) invalid("Images must use HTTPS willhaben image-CDN URLs");
  if (item.publishedAt && !Number.isFinite(Date.parse(item.publishedAt))) invalid("Invalid publishedAt");
  if (item.attributes!==undefined) {
    if(!plain(item.attributes) || Object.keys(item.attributes).length>45) invalid("Invalid attributes");
    for(const [k,v] of Object.entries(item.attributes)) {
      if (!k.trim() || k.length>80 || ["__proto__","prototype","constructor"].includes(k) || !["string","number","boolean"].includes(typeof v) || (typeof v==="string" && v.length>300) || (typeof v==="number" && !Number.isFinite(v))) invalid("Invalid attribute");
    }
  }
  if (item.priceType==="free" && item.price!==0 || item.priceType==="on_request" && item.price!==null) invalid("priceType conflicts with price");
  return {...item,url:item.url??(/^\d+$/.test(item.id)?objectUrl(item.id):null)};
}
const demo = [
  ["glass-01","BANKAMP Ersatzglas Opalglas Kugel",22,{shape:"round",finish:"matte",diameterMm:60,openingMm:24},1],
  ["glass-02","Zwei Lampengläser rund und matt, 6 cm",38,{shape:"round",finish:"matte",diameterMm:60,openingMm:24},2],
  ["glass-03","Ersatzschirm Kugel matt 60 mm",19,{shape:"round",finish:"matte",diameterMm:60},1],
  ["glass-04","BANKAMP Lampenglas Zylinder",12,{shape:"cylinder",finish:"matte",diameterMm:60},1],
  ["glass-05","Glaskugel klar 6 cm",15,{shape:"round",finish:"clear",diameterMm:60},1],
  ["phone-01","Apple iPhone 15 Pro 128 GB gebraucht",480,{storageGb:128},1],
  ["phone-02","Apple iPhone 15 Pro 128GB",505,{storageGb:128},1],
  ["phone-03","Apple iPhone 15 Pro 128 GB sehr gepflegt",515,{storageGb:128},1],
  ["phone-04","Apple iPhone 15 Pro 256 GB",560,{storageGb:256},1],
  ["phone-05","Hülle für Apple iPhone 15 Pro",9,{accessory:true},1],
  ["phone-06","iPhone 15 Pro 128 GB in Wien",490,{storageGb:128},1],
  ["phone-07","Apple iPhone 15 Pro 128 GB Natur",525,{storageGb:128},1],
].map(([key,title,price,attributes,quantity],i)=>{
  const lamp=key.startsWith("glass"), accessory=attributes.accessory===true;
  return {id:"demo-"+key,title,price,quantity,attributes,url:"https://example.invalid/d/demo-"+key,
    description:"Synthetischer Testdatensatz. "+title,location:"Wien",areaId:900,
    category:lamp?"Lampenglas":accessory?"Zubehör":"Smartphones",categoryId:lamp?4000:accessory?2692:2691,
    model:lamp?"Glaskugel":accessory?"Hülle":"iPhone 15 Pro "+attributes.storageGb+" GB",
    condition:"used",priceType:"asking",shipping:i%3?"both":"pickup",...(i%3?{shippingCost:4.5}:{}),
    paylivery:i%3===1,status:i===4?"reserved":"active",sellerType:"private",
    publishedAt:`2026-11-0${1+i%5}T12:00:00Z`,images:[]};
});
function selectRows(rows, query, filters) {
  const terms=queryText(query).match(/-?"[^"]+"|-?[^\s]+/g)??[];
  const f=validateFilters(filters);
  const selected=rows.filter(row=>{
    const hay=fold([row.title,row.description,row.model,row.category,...Object.values(row.attributes??{})].join(" "));
    if(!terms.every(t=>{const neg=t.startsWith("-"), word=fold((neg?t.slice(1):t).replaceAll('"',""));return neg?!hay.includes(word):hay.includes(word);})) return false;
    if(f.priceMin!==undefined && (row.price==null || row.price<f.priceMin) || f.priceMax!==undefined && (row.price==null || row.price>f.priceMax)) return false;
    if(f.shipping && row.shipping!=="both" && row.shipping!==f.shipping) return false;
    if(f.attributeIds?.some(id=>!row.attributeIds?.includes(id))) return false;
    if (f.areaId!==undefined && row.areaId!==f.areaId && !row.areaPathIds?.includes(f.areaId)) return false;
    if (f.categoryId!==undefined && row.categoryId!==f.categoryId && !row.categoryPathIds?.includes(f.categoryId)) return false;
    return ["sellerType","condition","paylivery"].every(k=>f[k]===undefined || row[k]===f[k]);
  });
  if (f.sort?.startsWith("price_")) selected.sort((a,b)=>a.price==null?Number(b.price!=null):b.price==null?-1:f.sort==="price_asc"?a.price-b.price:b.price-a.price);
  if (f.sort==="newest") selected.sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0));
  return selected;
}
function localProvider(kind, rows) {
  const byId=new Map(rows.map(r=>[r.id,r]));
  if(byId.size!==rows.length) invalid("Duplicate listing IDs in the supplied catalogue");
  return {
    kind, async search({query,filters={},cursor}) {
      const hits=selectRows(rows,query,filters), page=parseCursor(cursor);
      const items=hits.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE), end=page*PAGE_SIZE>=hits.length;
      return {items,total:hits.length,end,nextCursor:end?null:String(page+1)};
    }, async detail(id){return byId.get(id)??null;},
    async facets({query,filters={}}) {
      const hits=selectRows(rows,query,filters);
      const dimensions=Object.fromEntries(["categoryId","areaId","condition","sellerType","shipping","paylivery","model"].map(key=>{
        const seen=new Map(); for(const row of hits){const v=row[key];if(v!=null)seen.set(v,(seen.get(v)??0)+1);}
        return [key,Array.from(seen,([value,count])=>({value,count,...(key==="categoryId"?{label:hits.find(r=>r.categoryId===value)?.category}:key==="areaId"?{label:hits.find(r=>r.areaId===value)?.location}:{})})).slice(0,80)];
      }));
      return {scope:kind==="demo"?"synthetic catalogue":"submitted records only",total:hits.length,dimensions};
    }
  };
}
const allowedCondition = new Map([
  ["neu","new"],["neuwertig","as_new"],["wie neu","as_new"],["gebraucht","used"],
  ["generaluberholt","refurbished"],["refurbished","refurbished"],["defekt","defective"],["ausstellungsstuck","display_item"]
]);
const dataKeys = /^(?:zustand|condition|übergabe|übergabeart|handover|marke|farbe|modell|modellnummer|material|größe|durchmesser|öffnungsdurchmesser|durchmesser öffnung|kugeldurchmesser|speicher|speicherkapazität|kapazität|form|oberfläche|stückzahl|menge|versandkosten)$/i;
function normalizeMoney(v) {
  // Numeric API amounts are unambiguous. Only accept explicit EUR offer/cost values.
  if(typeof v==="number") return Number.isFinite(v)&&v>=0?v:null;
  if(typeof v!=="string") return null;
  let s=v.trim().replace(/^(?:€|EUR)\s*|\s*(?:€|EUR)$/gi,"").replace(/[ \u00a0]/g,"");
  if(s.includes(",")) {if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(s))return null;s=s.replaceAll(".","").replace(",",".");}
  return /^\d+(?:\.\d+)?$/.test(s) && Number(s)<=1e9 ? Number(s):null;
}
const numericIds = entries => [...new Set(entries.filter(v=>/^\d{1,9}$/.test(String(v))).map(Number).filter(n=>n>0))];
function liveListing(raw){
  if (!plain(raw) || !/^\d{1,20}$/.test(String(raw.id)) || Number(raw.verticalId)!==5) schemaError("Unrecognized marketplace listing");
  const fields=raw.attributes?.attribute;
  if (!Array.isArray(fields)) schemaError("Invalid listing attribute array");
  const bag=new Map(fields.filter(v=>typeof v?.name==="string" && Array.isArray(v.values)).map(v=>[v.name,v.values]));
  const attr = key=>bag.get(key)?.[0];
  const tms = raw.taggingData?.tmsDataValues?.tmsData??{};
  const title=textFrom(attr("HEADING")??tms.ad_title??raw.seoMetaData?.title??raw.description,300);
  if (!title) schemaError("Missing listing title");
  const attributes=Object.fromEntries([...bag].filter(([k])=>dataKeys.test(k)).map(([k,a])=>[k,textFrom(a.join(", "),300)]));
  const facetIds=[];
  for(const entry of (Array.isArray(raw.attributeInformation)?raw.attributeInformation:[])){
    const label=entry?.treeAttributeElement?.label;
    if(!Array.isArray(entry?.values)) continue;
    for(const v of entry.values) if(v?.treeAttributeValueId!=null) facetIds.push(v.treeAttributeValueId);
    if(dataKeys.test(label) && Object.keys(attributes).length<45){
      const value=entry.values.map(v=>v?.label).filter(v=>typeof v==="string").join(", ");
      if(value) attributes[label]=textFrom(value,300);
    }
  }
  const explicit=Object.fromEntries(Object.entries(attributes).map(([k,v])=>[fold(k),v]));
  const candidates=[...(raw.advertImageList?.advertImage??[]).map(x=>x.mainImageUrl??x.referenceImageUrl??x.reference),
    ...String(attr("ALL_IMAGE_URLS")??attr("MMO")??"").split(";")];
  const images=[...new Set(candidates.filter(x=>typeof x==="string" && x.trim()).map(x=>safeWebUrl(x.includes("://")?x:"https://cache.willhaben.at/mmo/"+x.replace(/^\/+|^mmo\//g,""),"image")).filter(Boolean))].slice(0,12);
  const priceLabel=fold(attr("PRICE_FOR_DISPLAY"));
  const isFree=/verschenken|kostenlos|gratis/.test(priceLabel);
  const price=normalizeMoney(attr("PRICE/AMOUNT")??attr("PRICE")??tms.exact_price)??(isFree?0:null);
  const crumbs=Array.isArray(raw.breadcrumbs)?raw.breadcrumbs:[];
  const category=crumbs.at(-1)?.displayName??tms.category_level_max;
  const categoryPathIds=numericIds([...String(attr("categorytreeids")??"").split(";"),...crumbs.map(c=>String(c?.seoUrl).match(/-(\d+)\/?$/)?.[1]),raw.categoryTreeId]);
  const categoryId=categoryPathIds.at(-1);
  const areaPathIds=numericIds([attr("REGION_AREA_ID"),attr("AREA_ID")]);
  const areaId=areaPathIds.at(-1);
  const statusLabel=fold([raw.advertStatus?.description,raw.advertStatus?.id].join(" "));
  const titlePrefix=fold(title).split(/\s+/)[0].replace(/[^a-z]/g,"");
  const status=/verkauft|\bsold\b/.test(statusLabel)||titlePrefix==="verkauft"?"sold":/reserviert|reserved/.test(statusLabel)||titlePrefix==="reserviert"?"reserved":
    /inaktiv|inactive|deaktiviert|deactivated/.test(statusLabel)?"inactive":/abgelaufen|expired/.test(statusLabel)?"expired":
    /geloscht|deleted/.test(statusLabel)?"deleted":/\b(?:aktiv|active)\b/.test(statusLabel)?"active":"unknown";
  const type=String(attr("ISPRIVATE")??raw.sellerProfileUserData?.private??tms.is_private??"");
  const shippingText=fold(explicit.ubergabe??explicit.ubergabeart??explicit.handover);
  const ships=/versand/.test(shippingText) && !/kein\w*\s+versand/.test(shippingText), pickup=/abhol/.test(shippingText);
  const cond=allowedCondition.get(fold(explicit.zustand??explicit.condition));
  const seo = textFrom(attr("SEO_URL"),900).replace(/^\/+/, "");
  const url=safeWebUrl(raw.seoMetaData?.canonicalUrl,"ad")??safeWebUrl(ORIGIN+"/iad/"+seo,"ad")??objectUrl(raw.id);
  const location=textFrom(attr("LOCATION")??raw.advertAddressDetails?.municipality??raw.advertAddressDetails?.postalName,150);
  const unitCount=explicit.stuckzahl??explicit.menge;
  const qty=/^\d+(?:\s*St(?:k\.?|ück))?$/i.test(unitCount)?parseInt(unitCount,10):null;
  const shippingCost=normalizeMoney(explicit.versandkosten??attr("SHIPPING_COST"));
  const when=raw.publishedDate??attr("PUBLISHED_String")??tms.publish_date;
  return {id:String(raw.id),title,price,url,description:textFrom(attr("DESCRIPTION")??attr("BODY_DYN"),6000),attributes,images,status,
    ...(price!==null?{priceType:isFree&&price===0?"free":/verhand|\bvb\b/.test(priceLabel)?"negotiable":"asking"}:/anfrage/.test(priceLabel)?{priceType:"on_request"}:{}),
    ...(qty && qty<=100000?{quantity:qty}:{}),...(shippingCost!==null?{shippingCost}:{}),
    ...(cond?{condition:cond}:{}), ...(ships||pickup?{shipping:ships&&pickup?"both":ships?"shipping":"pickup"}:{}),
    ...(typeof category==="string"?{category:category.slice(0,160)}:{}), ...(categoryId?{categoryId,categoryPathIds}:{}),
    ...(areaId?{areaId,areaPathIds}:{}), ...(location?{location}:{}),
    ...(["1","true","0","false"].includes(type)?{sellerType:["1","true"].includes(type)?"private":"dealer"}:{}),
    ...(["true","false"].includes(attr("p2penabled"))?{paylivery:attr("p2penabled")==="true"}:{}),
    ...(facetIds.length?{attributeIds:numericIds(facetIds)}:{}),
    ...(explicit.modell?{model:explicit.modell}:{}), ...(typeof when==="string"?{publishedAt:when}:{})
  };
}
// Never follow a redirect to an externally supplied URL, non-marketplace path, or host.
function allowedPath(url) {
  return url.origin===ORIGIN && !url.username && !url.password && (url.pathname===SEARCH || url.pathname.startsWith(SEARCH+"/") || url.pathname==="/iad/object" || url.pathname.startsWith("/iad/kaufen-und-verkaufen/d/"));
}
async function limitedText(response) {
  const maximum=4*1024*1024;
  if(Number(response.headers.get("content-length"))>maximum) {await response.body?.cancel(); fail("upstream_size","Page exceeds size budget");}
  const reader=response.body?.getReader();
  if (!reader) schemaError("Response has no body");
  const decoder=new TextDecoder(); let body="",bytes=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maximum){await reader.cancel();fail("upstream_size","Page exceeds size budget");}body+=decoder.decode(value,{stream:true});}
    return body+decoder.decode();
  } finally {reader.releaseLock();}
}
async function pageProps(url, allowGone=false) {
  const signal=AbortSignal.timeout(9000);
  try {
    let target=new URL(url);
    for(let i=0;i<4;i++){
      if(!allowedPath(target)) fail("upstream_redirect","Refused an unexpected redirect");
      const response=await fetch(target,{redirect:"manual",signal,headers:{Accept:"text/html","User-Agent":"Marktplatz-Studie/1.0 (authorized read-only research)"}});
      if([301,302,303,307,308].includes(response.status)){
        const redirect=response.headers.get("location"); await response.body?.cancel();
        if(!redirect) schemaError("Redirect without destination"); target=new URL(redirect,target);continue;
      }
      if(allowGone && [404,410].includes(response.status)){await response.body?.cancel();return null;}
      if (!response.ok){await response.body?.cancel();fail(response.status===429?"upstream_rate_limited":[401,403].includes(response.status)?"upstream_forbidden":"upstream_error","willhaben returned HTTP "+response.status);}
      const html=await limitedText(response);
      const match=html.match(/<script\b[^>]*\bid\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i);
      if(!match) schemaError("Embedded page data missing");
      let props;
      try {props=JSON.parse(match[1]).props?.pageProps;} catch{schemaError("Embedded page JSON changed");}
      if(!plain(props)) schemaError("Missing page metadata");
      return props;
    }
    fail("upstream_redirect","Too many redirects");
  } catch(error) {
    if(typeof error?.code==="string") throw error;
    fail(signal.aborted?"upstream_timeout":"upstream_error",signal.aborted?"willhaben timed out":"Could not read willhaben");
  }
}
async function readPage(query, filters, page) {
  const u=new URL(buildSearchLink(query,filters));
  u.searchParams.set("page",String(page)); u.searchParams.set("rows",String(PAGE_SIZE));
  const props=await pageProps(u), data=props.searchResult;
  // Landing-page suggestions may ignore filters. A missing result is a schema error.
  if(!plain(data) || !Array.isArray(data.advertSummaryList?.advertSummary)) schemaError("Expected a structured marketplace result list");
  if(Number(data.verticalId)!==5 || Number(data.pageRequested)!==page) schemaError("Marketplace or page identity not verified");
  if(data.rowsFound!=null && (!Number.isSafeInteger(data.rowsFound) || data.rowsFound<0)) schemaError("Invalid result count");
  if(data.rowsReturned!=null && data.rowsReturned!==data.advertSummaryList.advertSummary.length) schemaError("Result count disagrees with page contents");
  return data;
}
function metaFacets(page) {
  if(!Array.isArray(page.navigatorGroups)) schemaError("Filter metadata missing");
  const nativeParams={treeAttributes:"attributeIds",ATTRIBUTE_TREE:"categoryId",areaId:"areaId"};
  const dimensions=[];
  for(const group of page.navigatorGroups){
    for(const nav of (group?.navigatorList??[])){
      const all=[...(nav.possibleValues??[]),...(nav.groupedPossibleValues??[]).flatMap(g=>g?.possibleValues??[])];
      const values=[];
      for(const entry of all){
        for(const p of entry.urlParamRepresentationForValue??[]){
          if(!Object.hasOwn(nativeParams,p.urlParameterName) || !/^\d+$/.test(String(p.value))) continue;
          values.push({label:textFrom(entry.label,120),filter:nativeParams[p.urlParameterName],value:Number(p.value),count:entry.hits??entry.count??null});
          if(values.length>=50)break;
        }
        if(values.length>=50)break;
      }
      if(values.length) dimensions.push({id:textFrom(nav.id,100),label:textFrom(nav.label,100),values,truncated:all.length>50});
      if(dimensions.length>=32)break;
    }
    if(dimensions.length>=32)break;
  }
  return {scope:"provider facets for this query",total:page.rowsFound??null,dimensions};
}
function liveProvider(env) {
  if(env?.LIVE_ACCESS!=="authorized") fail("live_access_not_configured","Live access requires willhaben authorization and server-side activation. Use a search link or provide a dataset.");
  return {kind:"live", async search({query,filters={},cursor}) {
    const page=parseCursor(cursor), raw=await readPage(query,filters,page), rows=raw.advertSummaryList.advertSummary;
    if(rows.length>200) schemaError("Unexpected page size");
    const total=raw.rowsFound??null;
    if(total===0 && rows.length) schemaError("Non-empty result contradicts zero total");
    // Confirm termination with an empty, correctly numbered page. A shorter
    // page or an omitted/page-local count never proves there is nothing left.
    const items=rows.map(liveListing);
    const end=rows.length===0;
    return {items,total,end,nextCursor:end?null:String(page+1)};
  },async facets({query,filters={}}){return metaFacets(await readPage(query,filters,1));},
  async detail(id) {
    if(typeof id!=="string" || !/^\d{1,20}$/.test(id)) invalid("Expected a numeric willhaben listing ID");
    const props=await pageProps(objectUrl(id),true);
    if(props===null || props.is404===true) return null;
    if(String(props.advertDetails?.id)!==id) schemaError("Detail response has a different or missing ID");
    return liveListing(props.advertDetails);
  }};
}
export function getProvider(source,env={},listings) {
  if(source==="provided") {
    if(!Array.isArray(listings) || listings.length>MAX_PROVIDED) invalid("Supply up to 300 records for provided mode");
    return localProvider(source,listings.map(validatedItem));
  }
  if(listings!==undefined && listings!==null && (!Array.isArray(listings) || listings.length)) invalid("Pass listings only with source=provided");
  if(source==="demo") return localProvider(source,demo);
  if(source==="live") return liveProvider(env);
  invalid("Unknown data source");
}
