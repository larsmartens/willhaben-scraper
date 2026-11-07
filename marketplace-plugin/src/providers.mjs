/** Read-only catalogue adapters. A provider instance lasts for one tool call. */
import { fetchPublic, CLIENT_AGENT } from "./traffic.mjs";
import { VISUAL_SEARCH_PATH, validateVisualSource, nativeSimilarityUrl, listingVisualUrl,
  uploadSearchImage, encodeVisualCursor, decodeVisualCursor } from "./visual-search.mjs";
export { CLIENT_AGENT };

const ORIGIN = "https://www.willhaben.at";
const SEARCH = "/iad/kaufen-und-verkaufen/marktplatz";
const CONDITIONS = {new:22, as_new:2546, refurbished:5013256, used:23, defective:24, display_item:2539};
const HANDOVER = {shipping:2537, pickup:2536};
const SORTS = {newest:1, price_asc:3, price_desc:4, relevance:7};
const MAX_PROVIDED = 300;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const PERSONAL_TEST = "personal_test";
const plain = v => v !== null && typeof v === "object" && !Array.isArray(v);
const fail = (code, message, details = {}) => { throw Object.assign(new Error(message), {code, ...details}); };
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
  recent48h:{type:"boolean"}, sort:choice(...Object.keys(SORTS)), attributeIds:ids,
  requireTerms:{type:"array",maxItems:12,uniqueItems:true,items:str(80)},
  excludeTerms:{type:"array",maxItems:12,uniqueItems:true,items:str(80)},
  titleOnly:{type:"boolean"}
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
  images:{type:"array",items:str(1200)}, publishedAt:str(36)
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
    if (!Array.isArray(v) || (def.maxItems !== undefined && v.length > def.maxItems) || (def.uniqueItems && new Set(v).size !== v.length)) invalid("Invalid " + key);
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
  if (typeof cursor !== "string" || !/^[1-9]\d*$/.test(cursor) || !Number.isSafeInteger(Number(cursor)) || Number(cursor) >= Number.MAX_SAFE_INTEGER) invalid("Invalid page cursor");
  return Number(cursor);
}
function validatePageSize(pageSize) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE)
    invalid("pageSize must be between 1 and " + MAX_PAGE_SIZE);
  return pageSize;
}
export function buildSearchLink(query,filters={}) {
  const kw=queryText(query), f=validateFilters(filters);
  if (f.paylivery === false) fail("unsupported_filter","The native search supports PayLivery-only, not exclusion of PayLivery.");
  const u=new URL(SEARCH,ORIGIN);
  if (kw) u.searchParams.set("keyword",kw);
  for (const [k,v] of Object.entries({PRICE_FROM:f.priceMin,PRICE_TO:f.priceMax,ATTRIBUTE_TREE:f.categoryId,areaId:f.areaId,ISPRIVATE:f.sellerType===undefined?undefined:f.sellerType==="private"?1:0,sort:SORTS[f.sort],paylivery:f.paylivery || undefined,periode:f.recent48h?2:undefined})) {
    if(v!==undefined) u.searchParams.set(k,String(v));
  }
  for (const n of new Set([CONDITIONS[f.condition],HANDOVER[f.shipping],...(f.attributeIds??[])])) if(n) u.searchParams.append("treeAttributes",String(n));
  return u.href;
}

export function parseSearchUrl(value) {
  if (typeof value !== "string" || value.length > 6000) invalid("Provide a willhaben Marketplace search URL");
  let url;
  try { url = new URL(value); } catch { invalid("Invalid search URL"); }
  if (url.protocol !== "https:" || !["willhaben.at", "www.willhaben.at"].includes(url.hostname) ||
      url.port || url.username || url.password || url.hash ||
      !(url.pathname === SEARCH || url.pathname.startsWith(SEARCH + "/")))
    invalid("Use an HTTPS willhaben Marketplace search URL without credentials or fragments");

  const params = url.searchParams;
  const single = name => {
    const values = [...new Set(params.getAll(name))];
    if (values.length > 1) invalid("Conflicting values for " + name);
    return values[0];
  };
  const filters = {};
  const unsupportedParameters = [];
  const numericFilters = { PRICE_FROM: "priceMin", PRICE_TO: "priceMax", ATTRIBUTE_TREE: "categoryId", areaId: "areaId" };
  for (const [nativeName, name] of Object.entries(numericFilters)) {
    const raw = single(nativeName);
    if (raw === undefined) continue;
    if (!/^\d+(?:\.\d+)?$/.test(raw)) invalid("Invalid " + nativeName);
    filters[name] = Number(raw);
  }
  const categoryPath = url.pathname.slice(SEARCH.length).replace(/\/$/, "");
  if (categoryPath) {
    const categoryId = Number(categoryPath.match(/-([1-9]\d*)$/)?.[1]);
    if (categoryId && (filters.categoryId === undefined || filters.categoryId === categoryId)) filters.categoryId = categoryId;
    else unsupportedParameters.push({ name: "path", values: [url.pathname] });
  }
  const privateValue = single("ISPRIVATE");
  if (privateValue !== undefined) {
    if (!["0", "1"].includes(privateValue)) invalid("Invalid ISPRIVATE");
    filters.sellerType = privateValue === "1" ? "private" : "dealer";
  }
  const sortValue = single("sort");
  if (sortValue !== undefined) {
    const match = Object.entries(SORTS).find(([, id]) => String(id) === sortValue);
    if (match) filters.sort = match[0];
    else unsupportedParameters.push({ name: "sort", values: [sortValue] });
  }
  const paylivery = single("paylivery");
  if (["true", "1"].includes(paylivery)) filters.paylivery = true;
  else if (paylivery !== undefined) unsupportedParameters.push({ name: "paylivery", values: [paylivery] });
  const period = single("periode");
  if (period === "2") filters.recent48h = true;
  else if (period !== undefined) unsupportedParameters.push({ name: "periode", values: [period] });

  const attributes = [...new Set(params.getAll("treeAttributes"))];
  if (attributes.some(id => !/^[1-9]\d*$/.test(id))) invalid("Invalid treeAttributes");
  const conditionNames = new Map(Object.entries(CONDITIONS).map(([name, id]) => [String(id), name]));
  const conditions = attributes.filter(id => conditionNames.has(id));
  if (conditions.length === 1) filters.condition = conditionNames.get(conditions[0]);
  else if (conditions.length > 1) unsupportedParameters.push({ name: "treeAttributes", values: conditions });
  const handoverNames = new Map(Object.entries(HANDOVER).map(([name, id]) => [String(id), name]));
  const handover = attributes.filter(id => handoverNames.has(id));
  if (handover.length === 1) filters.shipping = handoverNames.get(handover[0]);
  const attributeIds = attributes.filter(id => !conditionNames.has(id) && (handover.length !== 1 || !handoverNames.has(id))).map(Number);
  if (attributeIds.length) filters.attributeIds = attributeIds;

  const handled = new Set(["keyword", "page", "rows", "ISPRIVATE", "sort", "paylivery", "periode", "treeAttributes", ...Object.keys(numericFilters)]);
  for (const name of new Set(params.keys())) {
    if (!handled.has(name)) unsupportedParameters.push({ name, values: params.getAll(name) });
  }
  const page = parseCursor(single("page"));
  const rows = single("rows");
  if (rows !== undefined && !/^[1-9]\d*$/.test(rows)) invalid("Invalid rows");
  const pageSize = validatePageSize(rows === undefined ? 30 : Number(rows));
  return { query: queryText(single("keyword") ?? ""), filters: validateFilters(filters), page, pageSize,
    unsupportedParameters, fullyRepresented: unsupportedParameters.length === 0, url: url.href };
}

export function safeWebUrl(value, type) {
  if (typeof value!=="string" || value.length>1200) return null;
  let u;
  try {u=new URL(value);} catch {return null;}
  if (u.protocol!=="https:" || u.username || u.password || u.port) return null;
  if (type==="image") return u.hostname==="cache.willhaben.at" && u.pathname.startsWith("/mmo/") ? u.href : null;
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
    const hay=fold(f.titleOnly ? row.title : [row.title,row.description,row.model,row.category,...Object.values(row.attributes??{})].join(" "));
    if(!terms.every(t=>{const neg=t.startsWith("-"), word=fold((neg?t.slice(1):t).replaceAll('"',""));return neg?!hay.includes(word):hay.includes(word);})) return false;
    if(f.priceMin!==undefined && (row.price==null || row.price<f.priceMin) || f.priceMax!==undefined && (row.price==null || row.price>f.priceMax)) return false;
    if(f.shipping && row.shipping!=="both" && row.shipping!==f.shipping) return false;
    if(f.recent48h && !(Date.parse(row.publishedAt) >= Date.now()-48*60*60*1000)) return false;
    if(!matchesLocalTerms(row,query,f)) return false;
    if(f.attributeIds?.some(id=>!row.attributeIds?.includes(id))) return false;
    if (f.areaId!==undefined && row.areaId!==f.areaId && !row.areaPathIds?.includes(f.areaId)) return false;
    if (f.categoryId!==undefined && row.categoryId!==f.categoryId && !row.categoryPathIds?.includes(f.categoryId)) return false;
    return ["sellerType","condition","paylivery"].every(k=>f[k]===undefined || row[k]===f[k]);
  });
  if (f.sort?.startsWith("price_")) selected.sort((a,b)=>a.price==null?Number(b.price!=null):b.price==null?-1:f.sort==="price_asc"?a.price-b.price:b.price-a.price);
  if (f.sort==="newest") selected.sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0));
  return selected;
}

function matchesLocalTerms(row, query, filters) {
  const text = fold(filters.titleOnly ? row.title : [row.title, row.description, row.model, row.category,
    ...Object.values(row.attributes ?? {})].join(" "));
  if ((filters.requireTerms ?? []).some(term => !text.includes(fold(term))) ||
      (filters.excludeTerms ?? []).some(term => text.includes(fold(term)))) return false;
  if (!filters.titleOnly) return true;
  return (query.match(/-?"[^"]+"|-?[^\s]+/g) ?? []).every(term => {
    const excluded = term.startsWith("-");
    const value = fold((excluded ? term.slice(1) : term).replaceAll('"', ""));
    return excluded ? !text.includes(value) : text.includes(value);
  });
}

function applyLocalFilters(value, query, filters) {
  const items = value.items.filter(row => matchesLocalTerms(row, query, filters));
  const hasLocalFilters = filters.titleOnly || filters.requireTerms?.length || filters.excludeTerms?.length;
  return { ...value, items, returnedCount:items.length, scannedCount:value.items.length,
    filteredOutCount:value.items.length-items.length,
    ...(hasLocalFilters ? {totalScope:"upstream_before_local_filters", localFilterScope:filters.titleOnly?"title":"listing_summary"} : {}) };
}
function localProvider(kind, rows) {
  const observedAt = new Date().toISOString();
  const records = rows.map(row => {
    const images = [...new Set(row.images ?? [])];
    const gallery = images.map((url, index) => ({index, url, thumbnailUrl:null}));
    return {...row, images, gallery, imageCount:images.length, thumbnailUrl:null,
      galleryComplete:row.images !== undefined, observedAt, cacheAgeSeconds:0};
  });
  const byId=new Map(records.map(r=>[r.id,r]));
  if(byId.size!==rows.length) invalid("Duplicate listing IDs in the supplied catalogue");
  return {
    kind, async search({query,filters={},cursor,pageSize=DEFAULT_PAGE_SIZE}) {
      validatePageSize(pageSize);
      const hits=selectRows(records,query,filters), page=parseCursor(cursor);
      const items=hits.slice((page-1)*pageSize,page*pageSize), end=page*pageSize>=hits.length;
      return {items,total:hits.length,end,nextCursor:end?null:String(page+1), page,
        requestedPageSize:pageSize, returnedCount:items.length, observedAt, cacheAgeSeconds:0};
    }, async detail(id){return byId.get(id)??null;}, async summary(id){return byId.get(id)??null;},
    async facets({query,filters={}}) {
      const hits=selectRows(records,query,filters);
      const dimensions=Object.fromEntries(["categoryId","areaId","condition","sellerType","shipping","paylivery","model"].map(key=>{
        const seen=new Map(); for(const row of hits){const v=row[key];if(v!=null)seen.set(v,(seen.get(v)??0)+1);}
        return [key,Array.from(seen,([value,count])=>({value,count,...(key==="categoryId"?{label:hits.find(r=>r.categoryId===value)?.category}:key==="areaId"?{label:hits.find(r=>r.areaId===value)?.location}:{})}))];
      }));
      return {scope:kind==="demo"?"synthetic catalogue":"submitted records only",total:hits.length,dimensions,observedAt,cacheAgeSeconds:0};
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
function imageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const path = value.trim();
  if (path.startsWith("//")) return safeWebUrl("https:" + path, "image");
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) return safeWebUrl(path, "image");
  return safeWebUrl("https://cache.willhaben.at/mmo/" + path.replace(/^\/+/, "").replace(/^mmo\//, ""), "image");
}
function photoIdentity(url) {
  return new URL(url).pathname.replace(/_(?:hoved|thumb)(?=\.[^./]+$)/, "");
}
function normalizeGallery(raw, allImages, cover, detailed) {
  const entries = raw?.advertImage;
  if (entries !== undefined && !Array.isArray(entries)) schemaError("Invalid image gallery");
  const gallery = [], seen = new Set();
  let rejected = false;
  for (const entry of entries ?? []) {
    const reference = imageUrl(entry?.referenceImageUrl) ?? imageUrl(entry?.reference) ?? imageUrl(entry?.name);
    const url = imageUrl(entry?.mainImageUrl) ?? reference;
    if (!url) { rejected = true; continue; }
    // Image IDs repeat across different photos. Full reference paths identify their size variants.
    const identity = photoIdentity(reference ?? url);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const similarSearchUrl = nativeSimilarityUrl(entry?.similarImageSearchUrl);
    gallery.push({index:gallery.length, url, thumbnailUrl:imageUrl(entry?.thumbnailImageUrl),
      ...(similarSearchUrl ? {similarSearchUrl} : {})});
  }
  const hasAllImages = typeof allImages === "string" && Boolean(allImages.trim());
  const extra = String(hasAllImages ? allImages : cover ?? "").split(";").filter(value => value.trim());
  for (const value of extra) {
    const url = imageUrl(value);
    if (!url) { rejected = true; continue; }
    const identity = photoIdentity(url);
    if (seen.has(identity)) continue;
    seen.add(identity);
    gallery.push({index:gallery.length, url, thumbnailUrl:null});
  }
  return {gallery, images:gallery.map(photo => photo.url), imageCount:gallery.length,
    thumbnailUrl:gallery[0]?.thumbnailUrl ?? null, galleryComplete:(hasAllImages || (detailed && Array.isArray(entries))) && !rejected};
}
function liveListing(raw, detailed = false){
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
    for(const v of entry.values) if((v?.treeAttributeValueId??v?.treeId)!=null) facetIds.push(v.treeAttributeValueId??v.treeId);
    if(dataKeys.test(label) && Object.keys(attributes).length<45){
      const value=entry.values.map(v=>v?.label).filter(v=>typeof v==="string").join(", ");
      if(value) attributes[label]=textFrom(value,300);
    }
  }
  const explicit=Object.fromEntries(Object.entries(attributes).map(([k,v])=>[fold(k),v]));
  const photos = normalizeGallery(raw.advertImageList, attr("ALL_IMAGE_URLS"), attr("MMO"), detailed);
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
  const descriptionValue = attr("DESCRIPTION") ?? attr("BODY_DYN");
  const description = typeof descriptionValue === "string" ? descriptionValue.trim() : "";
  const profile = raw.sellerProfileUserData;
  const memberSince = typeof profile?.registerDate === "string" && Number.isFinite(Date.parse(profile.registerDate))
    ? new Date(profile.registerDate).toISOString() : null;
  const activeListingCount = Number.isSafeInteger(profile?.activeAdCount) && profile.activeAdCount >= 0 ? profile.activeAdCount : null;
  const seller = { ...(memberSince ? {memberSince} : {}), ...(activeListingCount !== null ? {activeListingCount} : {}) };
  return {id:String(raw.id),title,price,url,description:description.slice(0,6000),descriptionLength:description.length,
    descriptionTruncated:description.length>6000,attributes,...photos,status,
    ...(price!==null?{priceType:isFree&&price===0?"free":/verhand|\bvb\b/.test(priceLabel)?"negotiable":"asking"}:/anfrage/.test(priceLabel)?{priceType:"on_request"}:{}),
    ...(qty && qty<=100000?{quantity:qty}:{}),...(shippingCost!==null?{shippingCost}:{}),
    ...(cond?{condition:cond}:{}), ...(ships||pickup?{shipping:ships&&pickup?"both":ships?"shipping":"pickup"}:{}),
    ...(typeof category==="string"?{category:category.slice(0,160)}:{}), ...(categoryId?{categoryId,categoryPathIds}:{}),
    ...(areaId?{areaId,areaPathIds}:{}), ...(location?{location}:{}),
    ...(["1","true","0","false"].includes(type)?{sellerType:["1","true"].includes(type)?"private":"dealer"}:{}),
    ...(Object.keys(seller).length ? {seller} : {}),
    ...(["true","false"].includes(attr("p2penabled"))?{paylivery:attr("p2penabled")==="true"}:{}),
    ...(facetIds.length?{attributeIds:numericIds(facetIds)}:{}),
    ...(explicit.modell?{model:explicit.modell}:{}), ...(typeof when==="string"?{publishedAt:when}:{})
  };
}
// Never follow a redirect to an externally supplied URL, non-marketplace path, or host.
function allowedPath(url) {
  return url.origin===ORIGIN && !url.username && !url.password && (url.pathname===SEARCH || url.pathname.startsWith(SEARCH+"/") || url.pathname===VISUAL_SEARCH_PATH || url.pathname==="/iad/object" || url.pathname.startsWith("/iad/kaufen-und-verkaufen/d/"));
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
async function pageProps(url, env, {allowGone=false, deadline} = {}) {
  const endsAt = Math.min(Date.now()+9000,
    Number.isFinite(deadline) ? deadline : Infinity,
    Number.isFinite(env.REQUEST_DEADLINE) ? env.REQUEST_DEADLINE : Infinity);
  try {
    let target=new URL(url);
    for(let i=0;i<4;i++){
      if(!allowedPath(target)) fail("upstream_redirect","Refused an unexpected redirect");
      const remaining = endsAt - Date.now();
      if (remaining < 100) fail("time_budget","Continue in another call to read this page",{recoverable:true});
      const response=await fetchPublic(target,{...env,REQUEST_DEADLINE:endsAt},{accept:"text/html",timeoutMs:remaining});
      if([301,302,303,307,308].includes(response.status)){
        const redirect=response.headers.get("location"); await response.body?.cancel();
        if(!redirect) schemaError("Redirect without destination"); target=new URL(redirect,target);continue;
      }
      if(allowGone && [404,410].includes(response.status)){await response.body?.cancel();return null;}
      if(response.headers.get("cf-mitigated")==="challenge"){await response.body?.cancel();fail("upstream_blocked","willhaben requested a browser challenge; stopping");}
      if (!response.ok){await response.body?.cancel();fail(response.status===429?"upstream_rate_limited":[401,403].includes(response.status)?"upstream_forbidden":"upstream_error","willhaben returned HTTP "+response.status);}
      const html=await limitedText(response);
      const match=html.match(/<script\b[^>]*\bid\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i);
      if(!match) schemaError("Embedded page data missing");
      let props;
      try {props=JSON.parse(match[1]).props?.pageProps;} catch{schemaError("Embedded page JSON changed");}
      if(!plain(props)) schemaError("Missing page metadata");
      return {props, url:target.href};
    }
    fail("upstream_redirect","Too many redirects");
  } catch(error) {
    if(typeof error?.code==="string") throw error;
    const timedOut = Date.now() >= endsAt;
    fail(timedOut?"upstream_timeout":"upstream_error",timedOut?"willhaben timed out":"Could not read willhaben",{recoverable:true});
  }
}
async function readPage(url, page, env, deadline) {
  const {props}=await pageProps(url,env,{deadline}), data=props.searchResult;
  return validateSearchPage(data,page);
}
function validateSearchPage(data, page) {
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
          if(p.urlParameterName==="periode" && String(p.value)==="2") {
            values.push({label:textFrom(entry.label,120),filter:"recent48h",value:true,count:entry.hits??entry.count??null});
            continue;
          }
          if(!Object.hasOwn(nativeParams,p.urlParameterName) || !/^\d+$/.test(String(p.value))) continue;
          values.push({label:textFrom(entry.label,120),filter:nativeParams[p.urlParameterName],value:Number(p.value),count:entry.hits??entry.count??null});
        }
      }
      if(values.length) dimensions.push({id:textFrom(nav.id,100),label:textFrom(nav.label,100),values,truncated:false});
    }
  }
  return {scope:"provider facets for this query",total:page.rowsFound??null,dimensions};
}
function liveProvider(env) {
  const personal=env?.LIVE_ACCESS===PERSONAL_TEST;
  if(!personal && env?.LIVE_ACCESS!=="authorized") fail("live_access_not_configured","Live access is disabled on this connection. Use a search link or provide a dataset.");
  const cache = env.ORIGIN_GATE?.getByName(ORIGIN);
  let denied;
  async function request(action) {
    if(denied) throw denied;
    try {return await action();} catch(error) {
      if(["upstream_forbidden","upstream_rate_limited","upstream_blocked","upstream_cooldown"].includes(error.code)) denied=error;
      throw error;
    }
  }
  async function cacheKey(prefix, url) {
    const canonical = new URL(url);
    canonical.searchParams.sort();
    const bytes = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(prefix + "\n" + canonical.href));
    const hash = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2,"0")).join("");
    return "search:" + hash;
  }
  async function cacheCall(method, args, deadline) {
    const taskDeadline = Math.min(Number.isFinite(deadline) ? deadline : Infinity,
      Number.isFinite(env.REQUEST_DEADLINE) ? env.REQUEST_DEADLINE : Infinity);
    const remaining = taskDeadline-Date.now();
    const timeout = Math.min(2000,remaining);
    if (timeout <= 0) fail("time_budget","Continue in another call to read this observation",{recoverable:true});
    const timeoutError = new Error("Cache coordinator timed out");
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => cache[method](...args)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError),timeout); })
      ]);
    } catch (cause) {
      if (Date.now() >= taskDeadline || cause === timeoutError && remaining <= 2000)
        fail("time_budget","Continue in another call to read this observation",{recoverable:true});
      fail("traffic_unavailable","The shared observation cache is unavailable. Retry this call.",{recoverable:true});
    } finally { clearTimeout(timer); }
  }
  async function readCache(key, deadline) {
    if (!cache) return null;
    const entry = await cacheCall("getCached",[key],deadline);
    if (!entry || !Number.isFinite(Date.parse(entry.observedAt)) || !Number.isFinite(Date.parse(entry.expiresAt)) || Date.parse(entry.expiresAt) <= Date.now()) return null;
    return entry;
  }
  async function claimObservation(key, fresh, deadline) {
    if (!cache || typeof cache.claimObservation !== "function")
      return {entry:fresh?null:await readCache(key,deadline)};
    const owner = crypto.randomUUID();
    const minObservedAt = fresh ? Date.now() : 0;
    const endsAt = Math.min(Date.now()+35000,Number.isFinite(deadline)?deadline:Infinity,
      Number.isFinite(env.REQUEST_DEADLINE)?env.REQUEST_DEADLINE:Infinity);
    for (;;) {
      const result = await cacheCall("claimObservation",[key,owner,{leaseMs:15000,minObservedAt}],endsAt);
      if (result?.state === "cached" && result.entry) return {entry:result.entry};
      if (result?.state === "owner") return {key,owner};
      if (result?.state !== "waiting" || !Number.isFinite(result.expiresAt))
        fail("traffic_unavailable","The shared observation lease is unavailable.",{recoverable:true});
      const wait = Math.min(250,Math.max(1,result.expiresAt-Date.now()),endsAt-Date.now());
      if (wait <= 0) fail("time_budget","Continue in another call to reuse the pending observation.",{recoverable:true});
      await new Promise(resolve => setTimeout(resolve,wait));
    }
  }
  async function releaseObservation(lease, deadline) {
    if (!lease.owner) return;
    try { await cacheCall("releaseObservation",[lease.key,lease.owner],deadline); }
    catch { /* An expired owner is reclaimed by the lease TTL. */ }
  }
  async function writeCache(entries, deadline, lease) {
    if (!cache) return;
    if (lease?.owner) {
      await cacheCall("commitObservation",[lease.key,lease.owner,entries],deadline);
      return;
    }
    for (let offset = 0; offset < entries.length; offset += 101)
      await cacheCall("putCached",[entries.slice(offset,offset+101)],deadline);
  }
  function observation(value, observedAt, cacheHit) {
    return {...value, observedAt, cacheAgeSeconds:cacheHit ? Math.max(0,Math.floor((Date.now()-Date.parse(observedAt))/1000)) : 0, cacheHit};
  }
  function checkFresh(fresh) {
    if (typeof fresh !== "boolean") invalid("fresh must be a boolean");
  }
  async function searchPage(query, filters, page, pageSize, fresh, deadline) {
    const base = new URL(buildSearchLink(query,filters));
    return searchUrl(base,page,pageSize,fresh,deadline);
  }
  async function searchUrl(base, page, pageSize, fresh, deadline, uploadedResult) {
    const url = new URL(base);
    url.searchParams.set("page",String(page));
    url.searchParams.set("rows",String(pageSize));
    const key = await cacheKey("page",url);
    const lease = await claimObservation(key,fresh,deadline);
    if (lease.entry) return {...lease.entry,cacheHit:true};
    try {
      const raw = uploadedResult ? validateSearchPage(uploadedResult,page) : await request(() => readPage(url,page,env,deadline));
      const rows = raw.advertSummaryList.advertSummary;
      if(rows.length>200) schemaError("Unexpected page size");
      const total=raw.rowsFound??null;
      if(total===0 && rows.length) schemaError("Non-empty result contradicts zero total");
      const items=rows.map(row => liveListing(row));
      const end=rows.length===0;
      const facets = Array.isArray(raw.navigatorGroups) ? metaFacets(raw) : null;
      const observedAt = new Date().toISOString();
      // Only an empty, correctly numbered page confirms exhaustion when the source clamps page sizes.
      const value = {items,total,end,nextCursor:end?null:String(page+1),page,requestedPageSize:pageSize,
        returnedCount:items.length,upstreamPageSize:Number.isSafeInteger(raw.rowsRequested)?raw.rowsRequested:null,facets};
      if (url.pathname === VISUAL_SEARCH_PATH) {
        const nextLink = raw.pagingLinksList?.contextLink?.find(link => link.description === "nextLink")?.uri;
        if (typeof nextLink === "string") {
          const next = new URL(nextLink,ORIGIN).searchParams.get("publishedDateTo");
          if (next && /^\d+$/.test(next) && Number.isSafeInteger(Number(next))) value.nextPublishedDateTo = next;
        }
      }
      const entries = [{key,value,observedAt,ttlSeconds:300},
        ...items.map(row => ({key:"summary:"+row.id,value:row,observedAt,ttlSeconds:300}))];
      if (facets) entries.push({key:await cacheKey("facets",base),value:facets,observedAt,ttlSeconds:300});
      await writeCache(entries,deadline,lease);
      return {value,observedAt,cacheHit:false};
    } finally { await releaseObservation(lease,deadline); }
  }
  function listingId(id) {
    if(typeof id!=="string" || !/^\d{1,20}$/.test(id)) invalid("Expected a numeric willhaben listing ID");
  }
  const provider = {
    kind:"live",
    async search({query,filters={},cursor,pageSize=DEFAULT_PAGE_SIZE,fresh=false,deadline}) {
      validatePageSize(pageSize);
      checkFresh(fresh);
      const entry = await searchPage(query,filters,parseCursor(cursor),pageSize,fresh,deadline);
      const {facets,...value} = entry.value;
      return observation(applyLocalFilters(value,query,filters),entry.observedAt,entry.cacheHit);
    },
    async searchByImage(args = {}) {
      const source = validateVisualSource(args);
      const continuation = args.cursor === undefined ? null : decodeVisualCursor(args.cursor);
      const filters = validateFilters(args.filters ?? continuation?.filters ?? {});
      const pageSize = validatePageSize(args.pageSize ?? Number(continuation?.url.searchParams.get("rows") ?? DEFAULT_PAGE_SIZE));
      const fresh = args.fresh ?? false;
      checkFresh(fresh);
      const nativeFilters = new URL(buildSearchLink("",filters)).searchParams;
      const deadline = Math.min(Date.now()+35000, Number.isFinite(args.deadline)?args.deadline:Infinity,
        Number.isFinite(env.REQUEST_DEADLINE)?env.REQUEST_DEADLINE:Infinity);
      let base, visual, uploadedResult;
      if (continuation) {
        const canonical = value => JSON.stringify(Object.entries(validateFilters(value)).sort(([a],[b]) => a.localeCompare(b)));
        const sameFilters = [continuation.filters,continuation.requestedFilters].some(value => canonical(value)===canonical(filters));
        if (!sameFilters || pageSize!==Number(continuation.url.searchParams.get("rows")))
          fail("invalid_cursor","Continue with the same filters and pageSize, or start a new image search.");
        base = continuation.url;
        visual = continuation.visual;
      } else {
        if (source.source === "listing") {
          const listing = await this.detail(source.listingId,{fresh,deadline});
          if (!listing) fail("listing_unavailable","This listing is unavailable. Choose another image.");
          base = listingVisualUrl(listing,source.photoIndex);
          visual = source;
        } else {
          const uploaded = await request(() => uploadSearchImage(source,env,deadline));
          base = uploaded.url;
          visual = {source:source.source};
          uploadedResult = uploaded.raw;
        }
        for (const key of new Set(nativeFilters.keys())) base.searchParams.delete(key);
        for (const [key,value] of nativeFilters) base.searchParams.append(key,value);
        if (nativeFilters.size || uploadedResult?.rowsRequested !== pageSize) uploadedResult = undefined;
      }
      const page = parseCursor(base.searchParams.get("page"));
      const entry = await searchUrl(base,page,pageSize,fresh,deadline,uploadedResult);
      const {facets,nextPublishedDateTo,...value} = entry.value;
      const nextUrl = new URL(base);
      nextUrl.searchParams.set("page",String(page+1));
      nextUrl.searchParams.set("rows",String(pageSize));
      if (nextPublishedDateTo) nextUrl.searchParams.set("publishedDateTo",nextPublishedDateTo);
      const filterUrl = new URL(base);
      filterUrl.pathname = SEARCH;
      for (const key of ["pictureKey","adId","imageId","imageUrl","isNavigation","publishedDateTo"]) filterUrl.searchParams.delete(key);
      const effectiveFilters = {...parseSearchUrl(filterUrl.href).filters,...filters};
      const requestedKeys = continuation?.requestedKeys ?? Object.keys(filters);
      const nextCursor = value.end ? null : encodeVisualCursor(nextUrl,effectiveFilters,visual,requestedKeys);
      const identity = new URL(base);
      for (const key of ["rows","page","publishedDateTo","isNavigation"]) identity.searchParams.delete(key);
      const filterIdentity = JSON.stringify(Object.entries(effectiveFilters).sort(([a],[b]) => a.localeCompare(b)));
      const searchId = (await cacheKey("visual:"+pageSize+":"+filterIdentity,identity)).slice("search:".length);
      return observation({...applyLocalFilters(value,"",effectiveFilters),nextCursor,visual:{...visual,searchId},filters:effectiveFilters},entry.observedAt,entry.cacheHit);
    },
    async facets({query,filters={},fresh=false,deadline}) {
      checkFresh(fresh);
      if (!fresh) {
        const entry = await readCache(await cacheKey("facets",buildSearchLink(query,filters)),deadline);
        if (entry) return observation(entry.value,entry.observedAt,true);
      }
      const entry = await searchPage(query,filters,1,DEFAULT_PAGE_SIZE,fresh,deadline);
      if (!entry.value.facets) schemaError("Filter metadata missing");
      return observation(entry.value.facets,entry.observedAt,entry.cacheHit);
    },
    async summary(id,{deadline}={}) {
      listingId(id);
      const [summary, detail] = await Promise.all([
        readCache("summary:"+id,deadline), readCache("detail:"+id,deadline),
      ]);
      const newerDetail = detail && (!summary || Date.parse(detail.observedAt) >= Date.parse(summary.observedAt));
      const entry = newerDetail ? detail : summary;
      return entry?.value && !entry.value.gone ? observation(entry.value,entry.observedAt,true) : null;
    },
    async detail(id,{fresh=false,deadline}={}) {
      listingId(id);
      checkFresh(fresh);
      const key = "detail:"+id;
      const prior = await readCache(key,deadline);
      if (prior && !fresh) return prior.value && !prior.value.gone ? observation(prior.value,prior.observedAt,true) : null;
      const lease = await claimObservation(key,fresh,deadline);
      if (lease.entry) return lease.entry.value.gone ? null : observation(lease.entry.value,lease.entry.observedAt,true);
      try {
        const hint = prior?.value ?? (await readCache("summary:"+id,deadline))?.value;
        const target = hint?.url && allowedPath(new URL(hint.url)) ? hint.url : objectUrl(id);
        const result = await request(() => pageProps(target,env,{allowGone:true,deadline}));
        const observedAt = new Date().toISOString();
        if (result === null || result.props.is404 === true) {
          const value = {id,gone:true};
          await writeCache([{key,value,observedAt,ttlSeconds:60},{key:"summary:"+id,value,observedAt,ttlSeconds:60}],deadline,lease);
          return null;
        }
        if(String(result.props.advertDetails?.id)!==id) schemaError("Detail response has a different or missing ID");
        const row = liveListing(result.props.advertDetails,true);
        if (row.url === objectUrl(id) && allowedPath(new URL(result.url))) row.url = result.url;
        await writeCache([{key,value:row,observedAt,ttlSeconds:900}],deadline,lease);
        return observation(row,observedAt,false);
      } finally { await releaseObservation(lease,deadline); }
    }
  };
  return provider;
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
