import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { waitFor } from "./wait-for.mjs";
const data=await mkdtemp(join(tmpdir(),"desk-source-priority-"));
const output=resolve("artifacts/source-priority");
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
     globalThis.tutorRequests.push({url:String(url),instruction:body.messages[0].content,context:JSON.parse(body.messages.find(m=>m.role==="user"&&Array.isArray(m.content)).content[0].text).context,tools:body.tools??null});
     return new Response(JSON.stringify({model:body.model,choices:[{finish_reason:"stop",message:{content:JSON.stringify({explanation:"Synthetic teaching response: resolve each force into horizontal and vertical components, then add the components.",overlays:[]}),...(globalThis.providerAttack?{tool_calls:[{function:{name:"submit_assignment",arguments:"{}"}}]}:{})}}]}));
   };
 });
 await page.evaluate(async()=>{
   await window.desk.command({type:"class.create",name:"Physics",color:"#667788"});
   const course=(await window.desk.snapshot()).classes[0];
   await window.desk.command({type:"task.create",input:{title:"Vector problem",classId:course.id,dueAt:null,minutes:30,resource:null,notes:"Synthetic task notes",deadlineConfirmed:false}});
   const task=(await window.desk.snapshot()).tasks[0];
   await window.desk.command({type:"source.create",input:{title:"Vector reference",text:"Resolve forces into components.",classIds:[course.id],taskIds:[task.id]}});
   await window.desk.command({type:"source.create",input:{title:"Unrelated private source",text:"DO_NOT_INCLUDE_UNLINKED_SOURCE",classIds:[],taskIds:[]}});
   await window.desk.command({type:"session.start",taskId:task.id});
 });
 await page.getByRole("button",{name:"Library",exact:true}).click();
 await page.getByText("Vector reference",{exact:true}).first().click();
 await page.getByLabel("Source type for Vector reference",{exact:true}).selectOption("assigned-textbook");
 await waitFor(async()=>(await page.evaluate(()=>window.desk.snapshot())).sources.find(s=>s.title==="Vector reference")?.kind==="assigned-textbook","Classification missing");
 await page.getByRole("button",{name:"Save text source",exact:true}).click();
 await page.getByLabel("Source title",{exact:true}).fill("Teacher handout");
 await page.getByLabel("Original text",{exact:true}).fill("Use a free-body diagram first.");
 await page.getByLabel("Source type",{exact:true}).selectOption("class-material");
 await page.getByText("Link classes and assignments (optional)",{exact:true}).click();
 await page.getByRole("checkbox",{name:"Physics",exact:true}).check();
 await page.getByRole("button",{name:"Save source",exact:true}).click();
 await page.getByRole("dialog").waitFor({state:"hidden"});
 await page.getByText("Teacher handout",{exact:true}).click();
 await page.screenshot({path:join(output,"source-priority.png")});
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
 const context=JSON.parse(requests[0].context);
 assert.equal(context.sources.length,2);
 assert.deepEqual(context.sources.map(s=>s.title),["Teacher handout","Vector reference"]);
 assert.deepEqual(context.sources.map(s=>s.kind),["class-material","assigned-textbook"]);
 assert.ok(context.sources.every(s=>s.kindReportedBy==="user"&&s.authority==="user-provided-text"));
 assert.ok(!requests[0].context.includes("DO_NOT_INCLUDE_UNLINKED_SOURCE"));
 assert.equal((await page.evaluate(()=>window.desk.snapshot())).tasks.length,1);
 const video=page.video();
 await app.close();app=undefined;
 if(video)await copyFile(await video.path(),join(output,"tutoring-operated.webm"));
 await launch();
 const restored=await page.evaluate(()=>window.desk.snapshot());
 assert.equal(restored.sources.find(s=>s.title==="Teacher handout").kind,"class-material");
 assert.equal(restored.sources.find(s=>s.title==="Vector reference").kind,"assigned-textbook");
 await openLens();
 await waitFor(async()=>(await lens.getByLabel("Tutoring mode",{exact:true}).inputValue())==="direct","Mode missing after restart");
 assert.deepEqual(errors,[]);
 console.log("PASS: source creation/correction persisted, teacher source precedes textbook with user-reported provenance; persisted Guide/Direct modes control main-process request; provider action payload rejected; no extra task created; Lens mode survives restart. Responses are synthetic, not teaching-quality proof.");
}finally{if(app)await app.close();await rm(data,{recursive:true,force:true});}
