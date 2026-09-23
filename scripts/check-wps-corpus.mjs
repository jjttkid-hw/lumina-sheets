import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {version}=JSON.parse(await readFile('package.json','utf8'));
const artifact=`artifacts/lumina-report-sdk-${version}.tgz`;
const fixture='tests/fixtures/wps/edited-report.xlsx';
const hash=b=>createHash('sha256').update(b).digest('hex');
const report={schema:1,status:'running',version,executedAt:new Date().toISOString(),artifactSha256:hash(await readFile(artifact)),fixture,fixtureSha256:hash(await readFile(fixture)),environment:{platform:process.platform,arch:process.arch,node:process.version},scope:'Installed SDK import/export of a retained WPS 12.1.26055 desktop-saved synthetic fixture. This run does not drive WPS or certify all desktop features.',checks:[],errors:[]};
const dir=await mkdtemp(path.join(os.tmpdir(),'lumina-wps-corpus-'));
try {
 execFileSync('tar',['-xzf',path.resolve(artifact),'-C',dir]);
 const sdk=await import(pathToFileURL(path.join(dir,'package/lumina.js')).href);
 const bytes=await readFile(fixture);
 const first=await sdk.workbookFromXlsx(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
 const second=await sdk.workbookFromXlsx(await sdk.workbookToXlsx(first));
 for(const [stage,book] of [['desktop-import',first],['sdk-roundtrip',second]]) {
  const [sheet,summary]=book.sheets;
  assert.equal(sheet.cells.B5.value,'_x0041_\r\n中文😀');
  assert.equal(sheet.cells.A2.value,200);
  assert.equal(sheet.cells.C2.value,'=A2-B2');
  assert.equal(summary.cells.A1.value,"='业务 数据'!C2*2");
  const evaluate=sdk.createEvaluator(book);
  assert.equal(evaluate(sheet,'C2'),170);assert.equal(evaluate(summary,'A1'),340);
  assert.equal(sheet.cells.A1.richText.map(r=>r.text).join(''),'销售报告');
  assert.equal(sheet.cells.A1.richText[0].style.bold,true);
  assert.equal(sheet.cells.A1.richText[0].style.color,'#23644D');
  assert.deepEqual(sheet.cells.D2.hyperlink,{target:'https://example.com/lumina',tooltip:'打开项目'});
  assert.equal(sheet.cells.A5.value,true);assert.equal(sheet.cells.C5.value,45292);
  assert.equal(sheet.cells.C5.style.format,'date');
  assert.deepEqual(sheet.hiddenRows,[6]);assert.deepEqual(sheet.hiddenColumns,[5]);assert.equal(sheet.frozenRows,1);
  assert.deepEqual(sheet.merges,[{start:{row:3,col:0},end:{row:3,col:1}}]);
  assert.equal(sheet.dataValidations[0].min,0);assert.equal(sheet.dataValidations[0].max,1000);
  assert.deepEqual(sheet.dataValidations[1].values,['待审核','已确认','已取消']);
  assert.equal(sheet.printSettings.paperSize,'A4');assert.equal(sheet.printSettings.orientation,'landscape');
  assert.equal(sheet.printSettings.repeatRows,1);assert.deepEqual(sheet.printSettings.rowBreaks,[20]);assert.deepEqual(sheet.printSettings.columnBreaks,[8]);
  report.checks.push({name:stage,status:'passed',text:sheet.cells.B5.value,formulaValue:340});
 }
 report.status='passed';
} catch(error) {report.status='failed';report.errors.push(error.message);process.exitCode=1;}
finally {
 await mkdir('artifacts/wps-corpus',{recursive:true});
 await writeFile('artifacts/wps-corpus/result.json',JSON.stringify(report,null,2)+'\n');
 await rm(dir,{recursive:true,force:true});
 console.log(JSON.stringify(report));
}
