import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from '/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/playwright/index.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { siteDigest } from '/Users/huangwei/Desktop/spreadjs/scripts/site-evidence.mjs';
const out='artifacts/browser-rerun-2026-09-21/after-fix/narrow'; await mkdir(out,{recursive:true});
const siteSha256=(await siteDigest('dist')).sha256;
const artifactSha256=createHash('sha256').update(await readFile('artifacts/lumina-report-sdk-0.29.0.tgz')).digest('hex');
for(const [engine,type] of Object.entries({chromium,firefox,webkit})) {
 const browser=await type.launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844}}); const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 const report={engine,browserVersion:browser.version(),executedAt:new Date().toISOString(),siteSha256,artifactSha256,scope:'Desktop engine at narrow viewport; not physical mobile or touch acceptance'};
 try{
 await page.goto('http://127.0.0.1:4273/lumina-sheets/'); await page.getByText('已保存到本地',{exact:true}).waitFor();
 await page.getByRole('button',{name:'展开侧栏',exact:true}).click(); await page.getByRole('button',{name:'关闭导航',exact:true}).click({position:{x:370,y:400}});
 await page.getByRole('grid').click({position:{x:100,y:90}});
 await page.getByRole('button',{name:'放大',exact:true}).click();assert.equal(await page.getByLabel('缩放比例').inputValue(),'110');
 const sizes=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,canvas:document.querySelector('canvas').width}));assert(sizes.scroll<=sizes.width+1);assert(sizes.canvas>0);
 await page.screenshot({path:`${out}/${engine}.png`,fullPage:true});assert.deepEqual(errors,[]);Object.assign(report,{status:'passed',sizes,errors});
 }catch(error){Object.assign(report,{status:'failed',error:error.message,errors});process.exitCode=1;}finally{await writeFile(`${out}/${engine}.json`,JSON.stringify(report,null,2)+'\n'); await browser.close();}console.log(engine,report.status);
}
