import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { generateRemunerationWorkbook, getRemunerationExportFilename } from './exportRemunerationWorkbook.js';

test('creates one valid worksheet per year with entry month and monthly totals', async () => {
  const monthly = Array.from({length:12}, (_,i) => ({ total:i < 6 ? 0 : 1000 }));
  const rows = [
    { year:2026, user_name:'Ana', role:'Manager', collaborator_name:'A', entry_month:7, annual_base_salary:12000, monthly, calculated:{ final_annual:6000, iht_final:1500, annual_meal:500, total_annual_employer:8000 } },
    { year:2027, user_name:'Ana', role:'Manager', collaborator_name:'B', entry_month:null, annual_base_salary:12000, monthly:Array.from({length:12},()=>({total:1000})), calculated:{ total_annual_employer:12000 } },
  ];
  const result = await generateRemunerationWorkbook(rows);
  assert.deepEqual(result.years, [2026, 2027]);
  assert.deepEqual(result.workbook.worksheets.map(sheet => sheet.name), ['Remuneration 2026','Remuneration 2027']);
  assert.equal(result.workbook.getWorksheet('Remuneration 2026').getRow(2).getCell(4).value, 'Jul');
  assert.equal(result.workbook.getWorksheet('Remuneration 2026').getRow(2).getCell(13).value, 0);
  assert.equal(result.workbook.getWorksheet('Remuneration 2026').getRow(2).getCell(19).value, 1000);
  const parsed = new ExcelJS.Workbook();
  await parsed.xlsx.load(result.buffer);
  assert.equal(parsed.worksheets.length, 2);
  assert.equal(getRemunerationExportFilename(result.years, 4), 'From_Remuneration_2026-2027_v004.xlsx');
});
