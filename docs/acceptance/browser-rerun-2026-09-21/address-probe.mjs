import { chromium } from '/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({channel:'chrome',headless:true});
for(let i=0;i<12;i++){
 const context = await browser.newContext(); const page=await context.newPage();
 await page.goto('http://127.0.0.1:4273/lumina-sheets/');
 await page.getByText('已保存到本地',{exact:true}).waitFor();
 await page.evaluate(()=>{window.probe=[]; for(const type of ['input','keydown','focusin'])document.addEventListener(type,e=>window.probe.push({type,key:e.key,label:e.target.getAttribute('aria-label'),value:e.target.value,address:document.querySelector('[aria-label="单元格地址"]')?.value,cell:document.querySelector('[role=gridcell]')?.textContent}),true)});
 await page.getByRole('button',{name:'新建工作簿',exact:true}).click();
 await page.getByPlaceholder('例如：2026 季度销售计划').fill('Probe');
 await page.getByRole('button',{name:'创建工作簿',exact:true}).click();
 const address=page.getByRole('textbox',{name:'单元格地址',exact:true}), formula=page.getByRole('textbox',{name:'公式编辑栏',exact:true});
 await address.fill('A1'); await address.press('Enter'); await formula.fill('42'); await formula.press('Enter');
 const state=await page.evaluate(()=>({address:document.querySelector('[aria-label="单元格地址"]').value,cell:document.querySelector('[role=gridcell]').textContent,events:window.probe}));
 console.log(JSON.stringify({i,...state})); await context.close();
}
await browser.close();
