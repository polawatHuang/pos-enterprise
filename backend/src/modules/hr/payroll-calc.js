'use strict';

// Thai payroll arithmetic for one employee and one month.
//
// Social security (ประกันสังคม มาตรา 33): employee and employer each pay `rate`% of the monthly wage,
// with the wage counted between `floor` and `ceiling`. The ceiling rose from 15,000 to 17,500 baht in
// 2026 (and is set to rise again), so the rate, floor and ceiling are shop settings (hr.sso).
//
// Withholding on salary (ภ.ง.ด.1, Revenue Code s.50(1)): the month's regular pay is annualised, the
// year's tax is worked out with the personal-income-tax brackets after the usual allowances, and one
// twelfth is withheld; a bonus is taxed on top in the month it is paid (the tax on annual pay + bonus
// minus the tax on annual pay). Allowances: expenses 50% up to 100,000, personal 60,000, the
// employee's social security for the year, and whatever else the employee declared (spouse,
// children, insurance, provident fund...) as `extraDeductions`.

const r2 = (n) => Math.round(Number(n) * 100) / 100;

const SSO_DEFAULT = { rate: 5, floor: 1650, ceiling: 17500 };

/** Personal income tax brackets (upper bound of the slice, rate %). */
const BRACKETS = [
  [150_000, 0],
  [300_000, 5],
  [500_000, 10],
  [750_000, 15],
  [1_000_000, 20],
  [2_000_000, 25],
  [5_000_000, 30],
  [Infinity, 35],
];

function incomeTax(netIncome) {
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of BRACKETS) {
    if (netIncome <= lower) break;
    tax += ((Math.min(netIncome, upper) - lower) * rate) / 100;
    lower = upper;
  }
  return tax;
}

function netTaxable(annualIncome, ssoYear, extraDeductions) {
  const expense = Math.min(annualIncome * 0.5, 100_000);
  return Math.max(0, annualIncome - expense - 60_000 - ssoYear - (extraDeductions || 0));
}

/** Contribution on a monthly wage (each side), rounded to the baht as the Social Security Office does. */
function ssoContribution(wage, cfg = SSO_DEFAULT) {
  if (!(wage > 0)) return { base: 0, amount: 0 };
  const base = Math.min(Math.max(wage, cfg.floor), cfg.ceiling);
  return { base: r2(base), amount: Math.round((base * cfg.rate) / 100) };
}

/** Tax to withhold this month on `regular` monthly pay plus a one-off `bonus`. */
function monthlyWithholding({ regular, bonus = 0, ssoMonthly = 0, extraDeductions = 0 }) {
  const annual = regular * 12;
  const ssoYear = ssoMonthly * 12;
  const base = incomeTax(netTaxable(annual, ssoYear, extraDeductions));
  const withBonus = bonus > 0 ? incomeTax(netTaxable(annual + bonus, ssoYear, extraDeductions)) : base;
  return r2(base / 12 + (withBonus - base));
}

/**
 * One payroll line. `emp` is the employee row; `input` the month's figures (days worked for daily
 * staff, overtime, allowance, bonus, other income, unpaid deduction, an optional typed withholding).
 */
function computeLine(emp, input = {}, sso = SSO_DEFAULT) {
  const daily = emp.pay_type === 'daily';
  const days = daily ? Number(input.daysWorked ?? 0) : null;
  const basePay = r2(daily ? Number(emp.base_salary) * days : input.basePay ?? Number(emp.base_salary));
  const overtime = r2(input.overtime ?? 0);
  const allowance = r2(input.allowance ?? 0);
  const bonus = r2(input.bonus ?? 0);
  const otherIncome = r2(input.otherIncome ?? 0);
  const deduction = r2(input.deduction ?? 0);
  const regular = r2(basePay + overtime + allowance + otherIncome - deduction);
  const gross = r2(regular + bonus);
  const { base: ssoBase, amount: ssoEmployee } = Number(emp.sso_enrolled) ? ssoContribution(basePay + overtime - deduction, sso) : { base: 0, amount: 0 };
  const ssoEmployer = ssoEmployee;
  const manual = input.whtManual === true || input.wht != null;
  const wht = manual ? r2(input.wht ?? 0) : monthlyWithholding({ regular, bonus, ssoMonthly: ssoEmployee, extraDeductions: Number(emp.tax_extra_deductions) });
  return {
    daysWorked: days,
    basePay,
    overtime,
    allowance,
    bonus,
    otherIncome,
    deduction,
    gross,
    ssoBase,
    ssoEmployee,
    ssoEmployer,
    wht,
    whtManual: manual,
    net: r2(gross - ssoEmployee - wht),
  };
}

module.exports = { SSO_DEFAULT, incomeTax, netTaxable, ssoContribution, monthlyWithholding, computeLine, r2 };
