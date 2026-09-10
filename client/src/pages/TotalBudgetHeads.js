// TotalBudgetHeads — same as TotalBudget but only sums non-approver users
import TotalBudget from './TotalBudget';

export default function TotalBudgetHeads() {
  return <TotalBudget mode="heads" />;
}
