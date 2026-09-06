import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { waitFor } from "./wait-for.mjs";
const data=await mkdtemp(join(tmpdir(),"desk-memory-")),output=resolve("artifacts/memory");await mkdir(output,{recursive:true});
let app,page;const errors=[];
async function launch(){app=await electron.launch({args:process.env.DESK_EXECUTABLE?[]:["."],executablePath:process.env.DESK_EXECUTABLE,env:{...process.env,DESK_DATA_DIR:data,DESK_ENABLE_DEVELOPMENT_KEY:"0"},recordVideo:{dir:output}});await waitFor(()=>Boolean(page=app.windows().find(p=>p.url().endsWith("#main"))),"Main missing");page.on("pageerror",e=>errors.push(e.message));await page.getByRole("button",{name:"Memory",exact:true}).click();await page.getByRole("heading",{name:"What The Desk Knows",exact:true}).waitFor();}
try{
 await launch();
 await page.getByRole("button",{name:"Remember something",exact:true}).click();
 await page.getByLabel("Memory note",{exact:true}).fill("I prefer math earlier in the day.");
 await page.getByRole("button",{name:"Save memory",exact:true}).click();
 await page.getByText("I prefer math earlier in the day.",{exact:true}).waitFor();
 await page.getByRole("button",{name:"Edit memory",exact:true}).click();
 await page.getByLabel("Memory note",{exact:true}).fill("I prefer math after lunch.");
 await page.getByRole("button",{name:"Save memory",exact:true}).click();
 await page.getByText("I prefer math after lunch.",{exact:true}).waitFor();
 const saved=(await page.evaluate(()=>window.desk.snapshot())).memories[0];assert.equal(saved.revision,1);assert.equal(saved.origin,"explicit");
 await page.screenshot({path:join(output,"memory.png")});
 const video=page.video();await app.close();app=undefined;if(video)await copyFile(await video.path(),join(output,"memory-operated.webm"));
 await launch();assert.deepEqual((await page.evaluate(()=>window.desk.snapshot())).memories,[saved]);
 await page.getByRole("button",{name:"Forget memory",exact:true}).click();
 await page.getByText("No saved memories yet.",{exact:true}).waitFor();
 await app.close();app=undefined;await launch();
 const state=await page.evaluate(()=>window.desk.snapshot());assert.equal(state.memories.length,0);assert.equal(state.tasks.length,0);assert.deepEqual(errors,[]);
 console.log("PASS: explicit memory UI create/edit, provenance/revision persistence, restart, forget and forgotten-state restart. No provider request or behavioral inference.");
}finally{if(app)await app.close();await rm(data,{recursive:true,force:true});}
