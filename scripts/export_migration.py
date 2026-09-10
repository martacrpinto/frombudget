#!/usr/bin/env python3
"""Export the legacy SQLite backup into deterministic Supabase import files.

The source database is opened read-only.  No credentials or auth users are
created: profiles retain their legacy text IDs and auth_user_id is left null.
"""
from __future__ import annotations
import argparse, json, sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "server" / "backups" / "budget_backup_2026-09-10T20-11-58.db"
TABLES = [
    # Do not export the legacy plaintext password column. Authentication is
    # recreated through Supabase Auth invitations, never through this dump.
    ("profiles", "users", {"id":"id", "name":"name", "initials":"initials", "profile_picture":"profile_picture", "created_at":"created_at"}),
    ("budget_years", "budget_years", None), ("categories", "categories", None),
    ("year_categories", "year_categories", None), ("budget_entries", "budget_entries", None),
    ("category_order", "user_category_order", None), ("row_notes", "row_notes", None),
    ("page_comments", "page_comments", None), ("page_status", "page_status", None),
    ("audit_log", "audit_log", None), ("remuneration_config", "remuneration_config", None),
    ("remuneration_ftes", "remuneration_ftes", None),
]
RENAMES = {"user_category_order":"category_order", "user_permissions":"permissions", "user_roles":"profile_roles"}
ORDER = ["profiles", "roles", "permissions", "budget_years", "categories", "year_categories", "category_order", "budget_entries", "row_notes", "page_comments", "page_status", "audit_log", "remuneration_config", "remuneration_ftes"]

def q(v):
    if v is None: return "null"
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return str(v)
    if isinstance(v, (dict, list)): return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"

def rows(con, table):
    return [dict(r) for r in con.execute(f'SELECT * FROM "{table}"').fetchall()]

def parent_first(items, parent_key, tie_keys):
    """Stable deterministic topological order; cycles fall back to tie order."""
    by_id = {r.get("id"): r for r in items}
    pending = sorted(items, key=lambda r: tuple((r.get(k) is None, r.get(k)) for k in tie_keys))
    done, out = set(), []
    while pending:
        ready = [r for r in pending if not r.get(parent_key) or r.get(parent_key) in done or r.get(parent_key) not in by_id]
        if not ready: ready = [pending[0]]
        ready_ids = {id(r) for r in ready}
        out.extend(ready); done.update(r.get("id") for r in ready); pending = [r for r in pending if id(r) not in ready_ids]
    return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("source", type=Path, default=DEFAULT_SOURCE, nargs="?"); ap.add_argument("--out-dir", type=Path, default=Path(__file__).resolve().parent / "generated")
    a = ap.parse_args(); source = a.source.resolve(); out = a.out_dir.resolve(); out.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True); con.row_factory = sqlite3.Row
    result = {"source": str(source), "tables": {}}
    for target, source_table, mapping in TABLES:
        data = rows(con, source_table)
        if mapping:
            data = [{k: r.get(v) for k, v in mapping.items()} for r in data]
        if target == "categories": data = parent_first(data, "parent_category_id", ("sort_order", "id"))
        if target == "page_comments": data = parent_first(data, "parent_id", ("created_at", "id"))
        result["tables"][target] = data
    # Keep only year/category pairs that satisfy the destination foreign keys.
    # Legacy backups may retain links to deleted years/categories.
    valid_years = {r["year"] for r in result["tables"]["budget_years"]}
    valid_categories = {r["id"] for r in result["tables"]["categories"]}
    raw_links = result["tables"]["year_categories"]
    rejected_links = [r for r in raw_links if r.get("year") not in valid_years or r.get("category_id") not in valid_categories]
    result["tables"]["year_categories"] = [r for r in raw_links if r not in rejected_links]
    (out / "migration_anomalies.json").write_text(json.dumps({"year_categories": rejected_links}, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    # Legacy permissions/roles are separate one-to-one tables.
    result["tables"]["permissions"] = rows(con, "user_permissions") if con.execute("select count(*) from sqlite_master where type='table' and name='user_permissions'").fetchone()[0] else []
    result["tables"]["profile_roles"] = rows(con, "user_roles") if con.execute("select count(*) from sqlite_master where type='table' and name='user_roles'").fetchone()[0] else []
    result["tables"]["roles"] = [{"name":"user","is_admin":False,"is_approver":False},{"name":"approver","is_admin":False,"is_approver":True},{"name":"administrator","is_admin":True,"is_approver":True}]
    (out / "migration_data.json").write_text(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    sql = ["-- Generated deterministically; export_history intentionally excluded.", "-- Requires postgres/service role in the Supabase SQL Editor: audit triggers are disabled during legacy import.", "begin;", "set local session_replication_role = replica;"]
    for target in ORDER:
        data = result["tables"].get(target, [])
        if target == "roles":
            for r in data: sql.append(f"insert into public.roles (name,is_admin,is_approver) values ({q(r['name'])},{q(r['is_admin'])},{q(r['is_approver'])}) on conflict (name) do nothing;")
            continue
        if target == "profile_roles":
            for r in data: sql.append(f"insert into public.profile_roles (user_id,is_admin,is_approver) values ({q(r['user_id'])},{q(bool(r['is_admin']))},{q(bool(r['is_approver']))}) on conflict (user_id) do update set is_admin=excluded.is_admin,is_approver=excluded.is_approver;")
            continue
        if not data: continue
        cols = list(data[0]);
        if target == "permissions": cols = [c for c in cols if c != "user_id"] + ["user_id"]
        for r in data:
            vals = [r.get(c) for c in cols]
            if target == "permissions":
                vals = [bool(v) if c.startswith("can_") else v for c,v in zip(cols, vals)]
            sql.append(f"insert into public.{target} ({','.join(cols)}) values ({','.join(q(v) for v in vals)}) on conflict do nothing;")
    sql.append("commit;")
    (out / "migration_data.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")
    print(json.dumps({k: len(v) for k,v in result["tables"].items()}, indent=2))

if __name__ == "__main__": main()
