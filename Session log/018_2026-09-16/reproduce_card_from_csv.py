#!/usr/bin/env python3
"""Reproduce the Metrics "Discovery calls -> conversion" card (003) from a Raw
data tab CSV export of ca_appointments. Mirrors src/db.ts pageDiscovery:
category in (discoveryPhone, discoveryZoom), status = 'A', range applied to
date_added (booking date) with start_date as the fallback. Does NOT apply the
ca_clients.is_excluded / mentees.is_test drops (not in the export).

usage: reproduce_card_from_csv.py <export.csv> [from YYYY-MM-DD] [to YYYY-MM-DD]
"""
import collections, csv, sys

path = sys.argv[1]
d_from = sys.argv[2] if len(sys.argv) > 2 else "2026-01-01"
d_to = sys.argv[3] if len(sys.argv) > 3 else "2026-12-31"
rows = list(csv.DictReader(open(path, encoding="utf-8-sig")))

sel = []
for r in rows:
    if r["category"] not in ("discoveryPhone", "discoveryZoom") or r["status"] != "A":
        continue
    basis = r["date_added"] or r["start_date"]
    if basis and d_from <= basis <= d_to:
        sel.append(r)

print(f"{len(sel)} rows the card counts for {d_from}..{d_to}\n")
print(f"{'id':>8} {'booked':10} {'scheduled':10} {'client':>7} {'coach':>6} {'category':14} name")
for r in sorted(sel, key=lambda r: r["date_added"] or r["start_date"]):
    print(f"{r['id']:>8} {r['date_added']:10} {r['start_date']:10} {r['client_id']:>7} "
          f"{r['coach_id']:>6} {r['category']:14} {r['name']}")
print("\nby booked month:", sorted(collections.Counter((r["date_added"] or r["start_date"])[:7] for r in sel).items()))
print("by label:", collections.Counter(r["name"] for r in sel).most_common())
