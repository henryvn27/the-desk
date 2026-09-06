import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { waitFor } from "./wait-for.mjs";
const data=await mkdtemp(join(tmpdir(),"desk-inference-")),output=resolve("artifacts/inference");await mkdir(output,{recursive:true});
let app,page;const errors=[];
async function launch(){app=await electron.launch({args:process.env.DESK_EXECUTABLE?[]:["."],executablePath:process.env.DESK_EXECUTABLE,env:{...process.env,DESK_DATA_DIR:data,DESK_ENABLE_DEVELOPMENT_KEY:"0"},recordVideo:{dir:output}});await waitFor(()=>Boolean(page=app.windows().find(p=>p.url().endsWith("#main"))),"Main missing");page.on("pageerror",e=>errors.push(e.message));await page.getByRole("button",{name:"Memory",exact:true}).click();await page.getByRole("heading",{name:"What The Desk Knows",exact:true}).waitFor();}
try{
  const seed = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import { DeskStore } from './packages/domain/store.ts';
    const store = new DeskStore(process.env.DESK_FIXTURE_PATH);
    const classId = store.execute({type:'class.create',name:'Physics'}).classes[0].id;
    store.execute({type:'planning.mode',mode:'suggest'});
    store.execute({type:'planning.preferences',input:{studyStart:'00:00',sleepCutoff:'23:59',bufferPercent:15,studyDays:[0,1,2,3,4,5,6]}});
    for (let i=0;i<3;i++) {
      const task = store.execute({type:'task.create',input:{title:'Reviewed problems '+i,classId,minutes:30,dueAt:null,resource:null,notes:'',deadlineConfirmed:true}}).tasks.at(-1);
      const start = new Date('2026-09-01T10:00:00Z');
      start.setUTCDate(start.getUTCDate()+i);
      const session = store.execute({type:'session.start',taskId:task.id},start).sessions.at(-1);
      store.execute({type:'session.end',completed:true},new Date(+start+60*60000));
      store.execute({type:'session.review',id:session.id,notes:'Synthetic fixture',remainingMinutes:null});
    }
    store.close();
  `,
    ],
    {
      env: { ...process.env, DESK_FIXTURE_PATH: join(data, "desk.sqlite") },
      encoding: "utf8",
    },
  );
  assert.equal(seed.status, 0, seed.stderr);
 await launch();
 await page.getByRole("button",{name:"Confirm memory",exact:true}).waitFor();
 await page.getByRole("checkbox",{name:"Learn from reviewed sessions",exact:true}).uncheck();
 await waitFor(async()=>!(await page.evaluate(()=>window.desk.snapshot())).inference.enabled,"Learning still enabled");
 assert.equal(await page.getByRole("button",{name:"Confirm memory",exact:true}).count(),0);
 await page.getByRole("checkbox",{name:"Learn from reviewed sessions",exact:true}).check();
 await page.getByRole("button",{name:"Confirm memory",exact:true}).click();
 await waitFor(async()=>(await page.evaluate(()=>window.desk.snapshot())).memories.some(m=>m.origin==="inferred"),"Inference not confirmed");
 await page.getByText("Evidence · 3 reviewed tasks",{exact:true}).click();

 await page.getByRole("button",{name:"Remember something",exact:true}).click();
 await page.getByLabel("Memory note",{exact:true}).fill("I prefer math earlier in the day.");
 await page.getByRole("button",{name:"Save memory",exact:true}).click();
 await page.getByText("I prefer math earlier in the day.",{exact:true}).waitFor();
 await page.locator("article").filter({hasText:"I prefer math earlier in the day."}).getByRole("button",{name:"Edit memory",exact:true}).click();
 await page.getByLabel("Memory note",{exact:true}).fill("I prefer math after lunch.");
 await page.getByRole("button",{name:"Save memory",exact:true}).click();
 await page.getByText("I prefer math after lunch.",{exact:true}).waitFor();
 const saved=(await page.evaluate(()=>window.desk.snapshot())).memories.find(m=>m.origin==="explicit");assert.equal(saved.revision,1);assert.equal(saved.origin,"explicit");
 await page.screenshot({path:join(output,"memory.png")});
 const video=page.video();await app.close();app=undefined;if(video)await copyFile(await video.path(),join(output,"memory-operated.webm"));
 await launch();assert.deepEqual((await page.evaluate(()=>window.desk.snapshot())).memories.find(m=>m.origin==="explicit"),saved);
 await page.getByRole("button",{name:"Clear inferred memories",exact:true}).click();
 await waitFor(async()=>(await page.evaluate(()=>window.desk.snapshot())).memories.length===1,"Inferred memory not cleared");
 assert.equal(await page.getByRole("button",{name:"Confirm memory",exact:true}).count(),0);
 await page.getByRole("button",{name:"Forget memory",exact:true}).click();
 await page.getByText("No saved memories yet.",{exact:true}).waitFor();
 await page.getByRole("checkbox",{name:"Learn from reviewed sessions",exact:true}).uncheck();
 await waitFor(async()=>!(await page.evaluate(()=>window.desk.snapshot())).inference.enabled,"Disable not persisted");
 await app.close();app=undefined;await launch();
 const state=await page.evaluate(()=>window.desk.snapshot());assert.equal(state.memories.length,0);assert.equal(state.tasks.length,3);assert.equal(state.sessions.length,3);assert.equal(state.inference.excludedSessionIds.length,3);assert.equal(state.inference.enabled,false);assert.equal(await page.getByRole("button",{name:"Confirm memory",exact:true}).count(),0);assert.deepEqual(errors,[]);
 console.log("PASS: duration pattern reviewed/confirmed, learning toggle, explicit edit, clear inferred preserves explicit note and sessions, clear survives restart. Timing is synthetic; no provider calls.");
}finally{if(app)await app.close();await rm(data,{recursive:true,force:true});}
