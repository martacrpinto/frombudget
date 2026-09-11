import ExcelJS from 'exceljs';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function getRemunerationYears(rows = []) {
  return [...new Set(rows.map(row => Number(row.year)).filter(Number.isFinite))].sort((a,b) => a-b);
}

export function getRemunerationExportFilename(years, version = 1) {
  const values = [...new Set((years || []).map(Number).filter(Number.isFinite))].sort((a,b) => a-b);
  const label = values.length ? values.join('-') : 'Years';
  return `From_Remuneration_${label}_v${String(Math.max(1, Number(version) || 1)).padStart(3,'0')}.xlsx`;
}

function entryLabel(value) {
  const month = Number(value);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? MONTHS[month - 1] : 'All year';
}

function addYearSheet(workbook, year, rows) {
  const sheet = workbook.addWorksheet(`Remuneration ${year}`.slice(0,31), { views:[{ state:'frozen', ySplit:1 }] });
  const headers = [
    'Department', 'Role', 'Name', 'Entry month', 'Annual salary reference',
    'Meal allowance / day', 'Indexation %', 'Increase %', 'Payable salary',
    'Payable IHT', 'Payable meal allowance', 'Total annual cost', ...MONTHS,
  ];
  sheet.addRow(headers);
  const header = sheet.getRow(1);
  header.font = { bold:true, color:{ argb:'FFFFFFFF' } };
  header.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1F5147' } };
  header.alignment = { vertical:'middle', horizontal:'center' };
  header.height = 28;

  rows.forEach(row => {
    const calc = row.calculated || {};
    const monthly = Array.isArray(row.monthly) ? row.monthly : [];
    sheet.addRow([
      row.user_name || row.user_id || '', row.role || '', row.collaborator_name || '', entryLabel(row.entry_month),
      Number(row.annual_base_salary) || 0, Number(row.meal_allowance_day) || 0,
      (Number(row.indexation_pct) || 0) / 100, (Number(row.increase_pct) || 0) / 100,
      Number(calc.final_annual) || 0, Number(calc.iht_final) || 0,
      Number(calc.annual_meal) || 0, Number(calc.total_annual_employer) || 0,
      ...MONTHS.map((_, index) => Number(monthly[index]?.total) || 0),
    ]);
  });

  sheet.autoFilter = { from:'A1', to:`${sheet.getColumn(headers.length).letter}1` };
  sheet.columns.forEach((column, index) => {
    column.width = index < 3 ? 22 : index === 3 ? 13 : index >= 12 ? 14 : 18;
  });
  for (let r=2; r<=sheet.rowCount; r += 1) {
    for (let c=5; c<=headers.length; c += 1) {
      sheet.getRow(r).getCell(c).numFmt = c === 7 || c === 8 ? '0.00%' : '#,##0.00;[Red]-#,##0.00';
    }
  }
  return sheet;
}

export async function generateRemunerationWorkbook(rows = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Budget Solution';
  const years = getRemunerationYears(rows);
  years.forEach(year => addYearSheet(workbook, year, rows.filter(row => Number(row.year) === year)));
  if (!years.length) throw new Error('No remuneration data to export.');
  const buffer = await workbook.xlsx.writeBuffer();
  return { workbook, buffer, blob:new Blob([buffer], { type:MIME }), years };
}
