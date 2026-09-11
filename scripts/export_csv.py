#!/usr/bin/env python3
"""Create Supabase Table Editor CSVs from the local migration JSON."""

import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent / "generated"
SOURCE = ROOT / "migration_data.json"
DESTINATION = ROOT / "csv"


def csv_value(value):
    if value is None:
        return ""
    if value is True:
        return "true"
    if value is False:
        return "false"
    return value


def main():
    tables = json.loads(SOURCE.read_text(encoding="utf-8"))["tables"]
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for name, rows in tables.items():
        if not rows:
            continue
        columns = list(rows[0].keys())
        target = DESTINATION / f"{name}.csv"
        with target.open("w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(
                {column: csv_value(value) for column, value in row.items()}
                for row in rows
            )
        print(f"{target.name}\t{len(rows)}")


if __name__ == "__main__":
    main()
