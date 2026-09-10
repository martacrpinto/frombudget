#!/usr/bin/env python3
"""Read-only reconciliation report for the legacy SQLite backup."""
import argparse, json, sqlite3
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
DEFAULT = ROOT / "server" / "backups" / "budget_backup_2026-09-10T20-11-58.db"
TABLES = ["users","categories","budget_years","budget_entries","audit_log","user_category_order","year_categories","user_permissions","user_roles","remuneration_config","remuneration_ftes","page_comments","page_status"]
def main():
    p=argparse.ArgumentParser(); p.add_argument("source",type=Path,default=DEFAULT,nargs="?"); a=p.parse_args()
    c=sqlite3.connect(f"file:{a.source.resolve().as_posix()}?mode=ro",uri=True); c.row_factory=sqlite3.Row
    counts={t:c.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0] for t in TABLES}
    totals={}
    for year in (2026,2027):
        totals[str(year)] = c.execute("select round(coalesce(sum(value),0),2) total, count(*) entries from budget_entries where year=?",(year,)).fetchone()
        totals[str(year)] = {"total":totals[str(year)][0],"entries":totals[str(year)][1]}
    years={r[0] for r in c.execute("select year from budget_years")}; cats={r[0] for r in c.execute("select id from categories")}
    raw_links=c.execute("select year,category_id from year_categories").fetchall()
    valid_links=[r for r in raw_links if r[0] in years and r[1] in cats]
    report={"source":str(a.source.resolve()),"counts":counts,"budget_by_year":totals,"year_categories":{"raw":len(raw_links),"valid":len(valid_links),"rejected":len(raw_links)-len(valid_links)},"export_history_excluded":True}
    print(json.dumps(report,indent=2,ensure_ascii=False))
if __name__ == "__main__": main()
