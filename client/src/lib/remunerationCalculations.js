export const REMUNERATION_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function normalizeEntryMonth(value) {
  if (value === null || value === undefined || value === '' || value === 'all') return null;
  const month = Number(value);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

export function isActiveMonth(entryMonth, month) {
  const start = normalizeEntryMonth(entryMonth);
  return start === null || month >= start;
}

/**
 * Builds the monthly remuneration from annual reference values.
 * Annual salary is never reduced before indexation/increase. A start month
 * only controls which calendar months are payable.
 */
export function calculateMonthlyRemuneration(fte, cfg = {}) {
  const annual = Number(fte.annual_base_salary) || 0;
  const mealDay = Number(fte.meal_allowance_day) || 0;
  const indexation = Number(fte.indexation_pct) || 0;
  const increase = Number(fte.increase_pct) || 0;
  const ihtRate = Number(cfg.iht_rate) || 0;
  const mealDays = Number(cfg.meal_allowance_days) || 0;
  const holidayMonth = Number(cfg.holiday_allowance_month) || 6;
  const christmasMonth = Number(cfg.christmas_allowance_month) || 12;
  const entryMonth = normalizeEntryMonth(fte.entry_month);

  const indexedAnnual = annual * (1 + indexation / 100);
  const finalAnnual = indexedAnnual * (1 + increase / 100);
  const regularSalary = finalAnnual / (Number(cfg.monthly_payments) || 14);
  const monthlyMeal = (mealDay * mealDays) / 12;
  const monthlyIht = (finalAnnual * ihtRate) / 12;

  return REMUNERATION_MONTHS.map((_, index) => {
    const month = index + 1;
    const active = isActiveMonth(entryMonth, month);
    const holiday = active && month === holidayMonth;
    const christmas = active && month === christmasMonth;
    const salary = active ? regularSalary * (1 + (holiday ? 1 : 0) + (christmas ? 1 : 0)) : 0;
    const meal = active ? monthlyMeal : 0;
    const iht = active ? monthlyIht : 0;
    return {
      month,
      active,
      salary,
      meal,
      iht,
      total: salary + meal + iht,
      isHoliday: holiday,
      isChristmas: christmas,
    };
  });
}

export function calculateRemuneration(fte, cfg = {}) {
  const annual = Number(fte.annual_base_salary) || 0;
  const mealDay = Number(fte.meal_allowance_day) || 0;
  const indexation = Number(fte.indexation_pct) || 0;
  const increase = Number(fte.increase_pct) || 0;
  const ihtRate = Number(cfg.iht_rate) || 0;
  const monthlyPayments = Number(cfg.monthly_payments) || 14;
  const indexedAnnual = annual * (1 + indexation / 100);
  const finalAnnual = indexedAnnual * (1 + increase / 100);
  const months = calculateMonthlyRemuneration(fte, cfg);
  const sum = key => months.reduce((total, item) => total + (item[key] || 0), 0);
  const activeMonths = months.filter(item => item.active).length;
  const activeMonthFactor = activeMonths / 12;
  const activePaymentCount = months.reduce(
    (total, item) => total + (item.active ? 1 : 0) + (item.isHoliday ? 1 : 0) + (item.isChristmas ? 1 : 0),
    0,
  );
  const activePaymentFactor = activePaymentCount / monthlyPayments;
  const basePaid = annual * activePaymentFactor;
  const baseIht = annual * ihtRate * activeMonthFactor;
  const indexedPaid = indexedAnnual * activePaymentFactor;
  const indexedIht = indexedAnnual * ihtRate * activeMonthFactor;
  const finalPaid = sum('salary');
  const finalIht = sum('iht');
  const activeMeal = sum('meal');
  const totalAnnualEmployer = sum('total');

  return {
    annual_salary_reference: annual,
    base_annual: basePaid,
    base_monthly: annual / monthlyPayments,
    iht_base: baseIht,
    iht_base_monthly: baseIht / monthlyPayments,
    base_total_annual: basePaid + baseIht,
    base_total_monthly: (basePaid + baseIht) / monthlyPayments,
    annual_meal: activeMeal,
    annual_meal_active: activeMeal,
    idx_annual: indexedPaid,
    idx_monthly: indexedAnnual / monthlyPayments,
    iht_idx: indexedIht,
    iht_idx_monthly: indexedIht / monthlyPayments,
    idx_total_annual: indexedPaid + indexedIht,
    idx_total_monthly: (indexedPaid + indexedIht) / monthlyPayments,
    final_annual: finalPaid,
    final_monthly: finalAnnual / monthlyPayments,
    iht_final: finalIht,
    iht_final_monthly: finalIht / monthlyPayments,
    final_total_annual: finalPaid + finalIht,
    final_total_monthly: (finalPaid + finalIht) / monthlyPayments,
    active_months: activeMonths,
    total_annual_employer: totalAnnualEmployer,
    total_monthly_average: totalAnnualEmployer / 12,
    total_final_active: finalPaid + finalIht,
    total_iht_active: finalIht,
  };
}
