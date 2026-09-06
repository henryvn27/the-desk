import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { waitFor } from "./wait-for.mjs";
const data=await mkdtemp(join(tmpdir(),"desk-tutor-"));
const output=resolve("artifacts/tutoring");
await mkdir(output,{recursive:true});
const keyFile=join(data,"synthetic-key.txt");
await writeFile(keyFile,`sk-or-v1-${"test-only-".repeat(8)}`,{mode:0o600});
let app,page,lens;
const errors=[];
async function launch(){
 app=await electron.launch({args:process.env.DESK_EXECUTABLE?[]:["."],executablePath:process.env.DESK_EXECUTABLE,env:{...process.env,DESK_DATA_DIR:data,DESK_ENABLE_DEVELOPMENT_KEY:"0"},recordVideo:{dir:output}});
 await waitFor(()=>Boolean(page=app.windows().find(p=>p.url().endsWith("#main"))),"Main missing");
 page.on("pageerror",e=>errors.push(e.message));
 await page.getByRole("button",{name:"Settings",exact:true}).waitFor();
}
async function openLens(){
 await page.evaluate(()=>window.desk.lens());
 await waitFor(()=>Boolean(lens=app.windows().find(p=>p.url().endsWith("#lens"))),"Lens missing");
 lens.on("pageerror",e=>errors.push(e.message));
 await lens.getByLabel("Tutoring mode",{exact:true}).waitFor();
}
try{
 await launch();
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},keyFile);
 await page.evaluate(()=>window.desk.importProviderKey());
 await app.evaluate(()=>{
   globalThis.tutorRequests=[];globalThis.providerAttack=false;
   globalThis.fetch=async(url,init)=>{
     const body=JSON.parse(init.body);
     globalThis.tutorRequests.push({url:String(url),instruction:body.messages[0].content,tools:body.tools??null});
     return new Response(JSON.stringify({model:body.model,choices:[{finish_reason:"stop",message:{content:JSON.stringify({explanation:"Synthetic teaching response: resolve each force into horizontal and vertical components, then add the components.",overlays:[]}),...(globalThis.providerAttack?{tool_calls:[{function:{name:"submit_assignment",arguments:"{}"}}]}:{})}}]}));
   };
 });
 await openLens();
 await lens.getByLabel("Tutoring mode",{exact:true}).selectOption("guide");
 await waitFor(async()=>(await page.evaluate(()=>window.desk.snapshot())).tutoringMode==="guide","Guide mode not persisted");
 await lens.getByLabel("Ask The Desk",{exact:true}).fill("Help me start this problem.");
 await lens.getByRole("button",{name:"Ask",exact:true}).click();
 await lens.getByText("Synthetic teaching response: resolve each force into horizontal and vertical components, then add the components.",{exact:true}).waitFor();
 await lens.locator(".lens-panel").screenshot({path:join(output,"tutoring-mode.png")});
 await lens.getByLabel("Tutoring mode",{exact:true}).selectOption("direct");
 await waitFor(async()=>(await page.evaluate(()=>window.desk.snapshot())).tutoringMode==="direct","Direct mode not persisted");
 await app.evaluate(()=>{globalThis.providerAttack=true;});
 await lens.getByLabel("Ask The Desk",{exact:true}).fill("Explain the full method.");
 await lens.getByRole("button",{name:"Ask",exact:true}).click();
 await lens.getByText("Lens does not accept provider actions.",{exact:true}).waitFor();
 const requests=await app.evaluate(()=>globalThis.tutorRequests);
 assert.equal(requests.length,2);
 assert.ok(requests[0].instruction.includes("Tutoring mode: Guide me"));
 assert.ok(requests[1].instruction.includes("Tutoring mode: Explain directly"));
 assert.ok(requests.every(r=>r.url==="https://openrouter.ai/api/v1/chat/completions"&&r.tools===null));
 assert.equal((await page.evaluate(()=>window.desk.snapshot())).tasks.length,0);
 const video=lens.video();
 await app.close();app=undefined;
 if(video)await copyFile(await video.path(),join(output,"tutoring-operated.webm"));
 await launch();await openLens();
 await waitFor(async()=>(await lens.getByLabel("Tutoring mode",{exact:true}).inputValue())==="direct","Mode missing after restart");
 assert.deepEqual(errors,[]);
 console.log("PASS: persisted Guide/Direct modes control main-process request; provider action payload rejected; no task created; Lens mode survives restart. Responses are synthetic, not teaching-quality proof.");
}finally{if(app)await app.close();await rm(data,{recursive:true,force:true});}
