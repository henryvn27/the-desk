import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, writeFile, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { waitFor } from "./wait-for.mjs";
const data=await mkdtemp(join(tmpdir(),"desk-openrouter-"));
const output=resolve("artifacts/openrouter");
await mkdir(output,{recursive:true});
// Deliberately invalid for real authentication; never use the developer key in this fixture.
const syntheticKey=`sk-or-v1-${"test-only-".repeat(8)}`;
const keyFile=join(data,"synthetic-key.txt");
await writeFile(keyFile,syntheticKey,{mode:0o600});
await writeFile(join(data,"provider-key.enc"),"legacy-unread-fixture");
let app,page;
const errors=[];
async function launch(){
  app=await electron.launch({args:process.env.DESK_EXECUTABLE?[]:["."],executablePath:process.env.DESK_EXECUTABLE,
    env:{...process.env,DESK_DATA_DIR:data,DESK_ENABLE_DEVELOPMENT_KEY:process.env.DESK_EXECUTABLE?"1":"0"},recordVideo:{dir:output}});
  await waitFor(()=>Boolean(page=app.windows().find(p=>p.url().endsWith("#main"))),"Main window did not open");
  page.on("pageerror",e=>errors.push(e.message));
  await page.getByRole("button",{name:"Settings",exact:true}).waitFor();
}
try{
  await launch();
  const initial=await page.evaluate(()=>window.desk.providerStatus());
  assert.equal(initial.configured,false);
  assert.equal(initial.source,null);
  assert.equal(initial.secureStorage,true);
  assert.equal(await page.evaluate(()=>typeof window.desk.saveProviderKey),"undefined");
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},keyFile);
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  assert.equal(await page.locator('input[type="password"]').count(),0);
  await page.getByRole("button",{name:"Import OpenRouter key",exact:true}).click();
  await page.getByText("OpenRouter key imported securely.",{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.desk.providerStatus()),{configured:true,secureStorage:true,source:"saved-user-key"});
  assert.equal((await readFile(join(data,"openrouter-key.enc"))).includes(Buffer.from(syntheticKey)),false);
  await page.screenshot({path:join(output,"openrouter-settings.png")});
  await app.evaluate((_electron,key)=>{
    globalThis.deskRequests=[];
    globalThis.fetch=async(url,init)=>{
      const body=JSON.parse(init.body);
      globalThis.deskRequests.push({url:String(url),model:body.model,provider:body.provider,authMatches:init.headers.Authorization===`Bearer ${key}`});
      return new Response(JSON.stringify({model:body.model,choices:[{finish_reason:"stop",message:{content:JSON.stringify({explanation:"Synthetic provider reply: combine the two groups.",overlays:[]})}}],usage:{prompt_tokens:10,completion_tokens:8,total_tokens:18,cost:0.0001}}),{status:200,headers:{"Content-Type":"application/json"}});
    };
  },syntheticKey);
  await page.evaluate(()=>window.desk.lens());
  let lens;
  await waitFor(()=>Boolean(lens=app.windows().find(p=>p.url().endsWith("#lens"))),"Lens did not open");
  assert.equal(await lens.evaluate(async () => {
    try { await window.desk.importProviderKey(); return false; }
    catch { return true; }
  }), true);
  await lens.getByLabel("Ask The Desk",{exact:true}).fill("Explain addition.");
  await lens.getByRole("button",{name:"Ask",exact:true}).click();
  await lens.getByText("Synthetic provider reply: combine the two groups.",{exact:true}).waitFor();
  const requests=await app.evaluate(()=>globalThis.deskRequests);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,"https://openrouter.ai/api/v1/chat/completions");
  assert.equal(requests[0].model,"openai/gpt-5.6-terra");
  assert.deepEqual(requests[0].provider,{only:["azure"],order:["azure"],allow_fallbacks:false,require_parameters:true,data_collection:"deny",zdr:true});
  assert.equal(requests[0].authMatches,true);
  await lens.getByRole("button",{name:"Dismiss · Esc",exact:true}).click();
  const video=page.video();
  await app.close();app=undefined;
  if(video)await copyFile(await video.path(),join(output,"openrouter-settings-operated.webm"));
  await launch();
  assert.equal((await page.evaluate(()=>window.desk.providerStatus())).source,"saved-user-key");
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  await page.getByRole("button",{name:"Disconnect provider",exact:true}).click();
  await page.getByText("OpenRouter disconnected.",{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.desk.providerStatus())).configured,false);
  assert.equal(await readFile(join(data,"provider-key.enc"),"utf8"),"legacy-unread-fixture");
  assert.deepEqual(errors,[]);
  console.log("PASS: native file-import boundary with synthetic key, encrypted storage, no renderer key entry, one stubbed OpenRouter request, restart/disconnect, legacy key ignored; development key disabled in this launch");
}finally{
  if(app)await app.close();
  await rm(data,{recursive:true,force:true});
}
