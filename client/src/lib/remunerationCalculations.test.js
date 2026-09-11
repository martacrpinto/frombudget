import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMonthlyRemuneration, calculateRemuneration } from './remunerationCalculations.js';

const cfg = { monthly_payments:14, iht_rate:.25, meal_allowance_days:220, holiday_allowance_month:6, christmas_allowance_month:12 };
const fte = { annual_base_salary:14000, meal_allowance_day:10, indexation_pct:0, increase_pct:0 };

for (const [label, entry, active] of [['all year',null,12],['January',1,12],['July',7,6],['December',12,1]]) {
  test(`${label}: inactive months are zero and annual total equals monthly sum`, () => {
    const row = {...fte, entry_month:entry};
    const months = calculateMonthlyRemuneration(row, cfg);
    assert.equal(months.filter(m => m.active).length, active);
    assert.ok(months.slice(0, 12-active).every(m => m.total === 0));
    const annual = calculateRemuneration(row, cfg);
    assert.equal(annual.total_annual_employer, months.reduce((sum,m) => sum+m.total, 0));
  });
}

test('allowances are only paid when their configured month is active', () => {
  const july = calculateMonthlyRemuneration({...fte,entry_month:7}, cfg);
  assert.equal(july[5].total, 0);
  assert.equal(july[5].isHoliday, false);
  assert.equal(july[11].isChristmas, true);
});
