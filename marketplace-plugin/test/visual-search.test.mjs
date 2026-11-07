import test from "node:test";
import assert from "node:assert/strict";
import { getProvider } from "../src/providers.mjs";
import { VISUAL_IMAGE_SCHEMA, validateVisualSource, publicImageUrl, validateVisualUrl,
  encodeVisualCursor, decodeVisualCursor, MAX_VISUAL_IMAGE_BYTES } from "../src/visual-search.mjs";

const origin = "https://www.willhaben.at";
const visualPath = "/iad/kaufen-und-verkaufen/aehnlichkeitssuche";
const pictureKey = "22bdc3a8-491d-35bd-8e97-c5161c415026";
const jpeg = new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,255,217]);
const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0]);
const publicPhoto = "https://images.example.com/lamp.jpg";
const provider = extra => getProvider("live", { LIVE_ACCESS:"personal_test", ...extra });
const image = bytes => new Response(bytes, { headers:{"content-type":bytes===png?"image/png":"image/jpeg"} });
const embed = props => new Response('<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:props}})+'</script>',
  {headers:{"content-type":"text/html"}});
const listing = id => ({id:String(id),verticalId:5,description:"Bankerlampe",attributes:{attribute:[{name:"PRICE",values:["65"]}]}});
const searchResult = (page=1, rows=30, ids=[1164410915,822281752]) => ({
  verticalId:5,searchId:301,pageRequested:page,rowsRequested:rows,rowsFound:196,rowsReturned:ids.length,
  advertSummaryList:{advertSummary:ids.map(listing)},navigatorGroups:[],
  searchContextLinks:{contextLink:[{id:"resultListSeoNavigatorLink",uri:"/kaufen-und-verkaufen/aehnlichkeitssuche?pictureKey="+pictureKey}]},
  pagingLinksList:{contextLink:[{description:"nextLink",uri:"https://ad-search.willhaben.at/restapi/v2/imagesearch/atz/"+pictureKey+"?page="+(page+1)+"&publishedDateTo=1794055380000"}]},
});

function installUploadFixture(t, { bytes=jpeg, missingCsrf=false, status=200, onCall=()=>{} }={}) {
  const calls=[];
  t.mock.method(globalThis,"fetch",async (value, options={})=>{
    const url=new URL(value);
    calls.push({url,options});onCall(url,options);
    if(url.origin==="https://images.example.com")return image(bytes);
    if(url.pathname.endsWith("/marktplatz"))return new Response("bootstrap",{headers:missingCsrf?{}:{
      "set-cookie":"x-bbx-csrf-token=test-csrf; Path=/; Secure, IADVISITOR=visitor; Expires=Sat, 07 Nov 2026 18:00:00 GMT; Path=/",
    }});
    if(url.pathname==="/webapi/ad-search/imagesearch/atz") {
      assert.equal(options.method,"PUT");assert.equal(options.headers["Content-Type"],"image/jpeg");
      assert.equal(options.headers["x-bbx-csrf-token"],"test-csrf");
      assert.equal(options.headers.Cookie,"x-bbx-csrf-token=test-csrf; IADVISITOR=visitor");
      assert.deepEqual(options.body,jpeg);
      return status===200?Response.json(searchResult()):new Response("denied",{status,headers:{"retry-after":"1800"}});
    }
    if(url.pathname===visualPath)return embed({searchResult:searchResult(Number(url.searchParams.get("page")),Number(url.searchParams.get("rows")),
      url.searchParams.get("page")==="2"?[]:[1164410915])});
    assert.fail("Unexpected outbound URL");
  });
  return calls;
}

test("native ChatGPT file schema declares required download_url and file_id",()=>{
  assert.deepEqual(VISUAL_IMAGE_SCHEMA.required,["download_url","file_id"]);
  assert.deepEqual(Object.keys(VISUAL_IMAGE_SCHEMA.properties),["download_url","file_id","mime_type","file_name"]);
  assert.equal(validateVisualSource({image:{download_url:publicPhoto,file_id:"file-test"}}).source,"attachment");
  for(const args of [{},{imageUrl:publicPhoto,listingId:"12"},{image:{download_url:publicPhoto}},
    {listingId:"12",photoIndex:-1},{imageUrl:publicPhoto,photoIndex:1},{cursor:"vs1.test",imageUrl:publicPhoto}])
    assert.throws(()=>validateVisualSource(args),{code:"invalid_input"});
});

test("source URLs reject local network targets and credential-bearing forms",()=>{
  for(const url of ["http://images.example.com/x.jpg","https://localhost/x.jpg","https://127.0.0.1/x",
    "https://2130706433/x","https://[::1]/x","https://10.0.0.1/x","https://host.internal/x",
    "https://metadata.google.internal/x","https://example.com:8443/x","https://user:pass@example.com/x",
    "https://example.com/x#fragment"])
    assert.throws(()=>publicImageUrl(url),{code:"invalid_input"});
  assert.equal(publicImageUrl(publicPhoto).href,publicPhoto);
});

test("unsupported native filters fail before downloading or uploading an image",async t=>{
  const fetcher=t.mock.method(globalThis,"fetch",()=>assert.fail("Invalid filters must fail before I/O"));
  await assert.rejects(provider().searchByImage({imageUrl:publicPhoto,filters:{paylivery:false}}),{code:"unsupported_filter"});
  assert.equal(fetcher.mock.callCount(),0);
});

test("JPEG attachment upload reuses native first page and carries private-free continuation",async t=>{
  const calls=installUploadFixture(t);
  const first=await provider().searchByImage({image:{download_url:publicPhoto+"?secret=token",file_id:"private-file-id"},pageSize:30});
  assert.equal(calls.length,3);assert.equal(first.total,196);assert.equal(first.scannedCount,2);
  assert.equal(first.visual.source,"attachment");assert.match(first.visual.searchId,/^[a-f0-9]{64}$/);
  const serialized=JSON.stringify(first);
  assert.equal(serialized.includes("secret"),false);assert.equal(serialized.includes("private-file-id"),false);
  const continuation=decodeVisualCursor(first.nextCursor);
  assert.equal(continuation.url.searchParams.get("pictureKey"),pictureKey);
  assert.equal(continuation.url.searchParams.get("publishedDateTo"),"1794055380000");
  const next=await provider().searchByImage({cursor:first.nextCursor});
  assert.equal(calls.length,4);assert.equal(next.page,2);assert.equal(next.end,true);assert.equal(next.nextCursor,null);
  assert.deepEqual(next.visual,first.visual);
});

test("visual search applies requested row count and native filters on a follow-up page",async t=>{
  const calls=installUploadFixture(t);
  const first=await provider().searchByImage({imageUrl:publicPhoto,pageSize:50,filters:{priceMax:150,shipping:"shipping"}});
  assert.equal(calls.length,4);
  const url=calls.at(-1).url;
  assert.equal(url.pathname,visualPath);assert.equal(url.searchParams.get("rows"),"50");
  assert.equal(url.searchParams.get("PRICE_TO"),"150");assert.equal(url.searchParams.get("treeAttributes"),"2537");
  await assert.rejects(provider().searchByImage({cursor:first.nextCursor,filters:{priceMax:100}}),{code:"invalid_cursor"});
  await assert.rejects(provider().searchByImage({cursor:first.nextCursor,pageSize:100}),{code:"invalid_cursor"});
  assert.equal(calls.length,4);
});

test("visual query identities distinguish page sizes and remain stable across continuation",async t=>{
  installUploadFixture(t);
  const first=await provider().searchByImage({imageUrl:publicPhoto,pageSize:30});
  const larger=await provider().searchByImage({imageUrl:publicPhoto,pageSize:50});
  assert.notEqual(first.visual.searchId,larger.visual.searchId);
  const next=await provider().searchByImage({cursor:first.nextCursor});
  assert.equal(next.visual.searchId,first.visual.searchId);
});

test("existing listing similarity preserves native image IDs while accepting zero-based selection",async t=>{
  const calls=[];
  t.mock.method(globalThis,"fetch",async value=>{
    const url=new URL(value);calls.push(url);
    if(url.pathname==="/iad/object") {
      const row=listing(1164410915);
      row.advertImageList={advertImage:[1,8].map(id=>({
        id,mainImageUrl:"https://cache.willhaben.at/mmo/photo-"+id+".jpg",
        similarImageSearchUrl:"https://ad-search.willhaben.at/restapi/v2/imagesearch/atz?adId=1164410915&imageId="+id+
          "&imageUrl="+encodeURIComponent("https://cache.willhaben.at/mmo/photo-"+id+".jpg")+"&ATTRIBUTE_TREE=7015&rows=30",
      }))};
      return embed({advertDetails:row});
    }
    assert.equal(url.pathname,visualPath);assert.equal(url.searchParams.get("imageId"),"8");
    assert.equal(url.searchParams.get("ATTRIBUTE_TREE"),"7015");
    return embed({searchResult:searchResult(Number(url.searchParams.get("page")),50)});
  });
  const result=await provider().searchByImage({listingId:"1164410915",photoIndex:1});
  assert.equal(calls.length,2);assert.deepEqual(result.visual,{source:"listing",listingId:"1164410915",photoIndex:1,searchId:result.visual.searchId});
  assert.match(result.visual.searchId,/^[a-f0-9]{64}$/);
  assert.deepEqual(result.filters,{categoryId:7015});
  assert.equal(decodeVisualCursor(result.nextCursor).url.searchParams.get("imageId"),"8");
  const next=await provider().searchByImage({cursor:result.nextCursor,filters:{}});
  assert.deepEqual(next.filters,{categoryId:7015});assert.equal(next.visual.searchId,result.visual.searchId);
  const copied=await provider().searchByImage({cursor:result.nextCursor,filters:result.filters});
  assert.equal(copied.visual.searchId,result.visual.searchId);
  await assert.rejects(provider().searchByImage({cursor:result.nextCursor,filters:{categoryId:999}}),{code:"invalid_cursor"});
});

test("Cloudflare Images normalizes PNG through the native 300-pixel JPEG contract",async t=>{
  installUploadFixture(t,{bytes:png});
  const operations=[];
  const IMAGES={input(stream){
    operations.push(["input",stream instanceof ReadableStream]);
    return {transform(options){operations.push(["transform",options]);return {async output(options){
      operations.push(["output",options]);return {response:()=>image(jpeg)};
    }};}};
  }};
  await provider({IMAGES}).searchByImage({imageUrl:publicPhoto,pageSize:30});
  assert.deepEqual(operations,[["input",true],["transform",{width:300,height:300,fit:"scale-down"}],
    ["output",{format:"image/jpeg",quality:90,anim:false}]]);
});

test("unsupported conversion, unavailable CSRF and upstream denial stop before further calls",async t=>{
  let calls=installUploadFixture(t,{bytes:png});
  await assert.rejects(provider().searchByImage({imageUrl:publicPhoto}),{code:"image_transform_unavailable"});
  assert.equal(calls.length,1);t.mock.restoreAll();
  calls=installUploadFixture(t,{missingCsrf:true});
  await assert.rejects(provider().searchByImage({imageUrl:publicPhoto}),{code:"visual_search_unavailable"});
  assert.equal(calls.length,2);t.mock.restoreAll();
  calls=installUploadFixture(t,{status:429});
  await assert.rejects(provider().searchByImage({imageUrl:publicPhoto}),{code:"upstream_rate_limited"});
  assert.equal(calls.length,3);
});

test("every image redirect is validated and oversized streams never reach the upload endpoint",async t=>{
  const fetcher=t.mock.method(globalThis,"fetch",async()=>new Response(null,{status:302,headers:{location:"https://127.0.0.1/private"}}));
  await assert.rejects(provider().searchByImage({imageUrl:publicPhoto}),{code:"invalid_input"});
  assert.equal(fetcher.mock.callCount(),1);t.mock.restoreAll();
  const large=t.mock.method(globalThis,"fetch",async()=>new Response(jpeg,{headers:{"content-type":"image/jpeg","content-length":String(MAX_VISUAL_IMAGE_BYTES+1)}}));
  await assert.rejects(provider().searchByImage({imageUrl:publicPhoto}),{code:"image_too_large"});
  assert.equal(large.mock.callCount(),1);
});

test("visual cursors reject changed destinations, unexpected parameters and embedded attachment metadata",()=>{
  const url=new URL(visualPath,origin);url.searchParams.set("pictureKey",pictureKey);url.searchParams.set("page","2");url.searchParams.set("rows","50");
  assert.equal(decodeVisualCursor(encodeVisualCursor(url,{}, {source:"url"})).url.href,url.href);
  for(const target of [url.href.replace(origin,"https://example.com"),url.href+"&redirect=1",url.href+"&rows=100",url.href.replace("rows=50","rows=500")])
    assert.throws(()=>validateVisualUrl(target),{code:"invalid_cursor"});
  const bad={v:1,url:url.href,filters:{},visual:{source:"attachment",download_url:publicPhoto}};
  assert.throws(()=>decodeVisualCursor("vs1."+btoa(JSON.stringify(bad)).replace(/=+$/,"")),{code:"invalid_cursor"});
});

test("expired deadlines prevent image downloads and stalled conversion returns a time budget",async t=>{
  const calls=installUploadFixture(t,{bytes:png});
  await assert.rejects(provider().searchByImage({imageUrl:publicPhoto,deadline:Date.now()-1}),{code:"time_budget"});
  assert.equal(calls.length,0);
  const IMAGES={input(){return {transform(){return {output(){return new Promise(()=>{});}};}};}};
  await assert.rejects(provider({IMAGES}).searchByImage({imageUrl:publicPhoto,deadline:Date.now()+130}),{code:"time_budget"});
  assert.equal(calls.length,1);
});

test("a stalled transformed body is cancelled before the upload phase",async t=>{
  const calls=installUploadFixture(t);
  let cancelled=false;
  const IMAGES={input(){return {transform(){return {async output(){return {response(){
    return new Response(new ReadableStream({start(controller){controller.enqueue(jpeg);},cancel(){cancelled=true;}}),
      {headers:{"content-type":"image/jpeg"}});
  }};}};}};}};
  await assert.rejects(provider({IMAGES}).searchByImage({imageUrl:publicPhoto,deadline:Date.now()+130}),{code:"time_budget"});
  assert.equal(cancelled,true);assert.equal(calls.length,1);
});
