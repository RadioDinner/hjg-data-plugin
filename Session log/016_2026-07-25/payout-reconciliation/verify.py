"""Python mirror of the workbook formulas — used to sanity-check what Excel will
compute and to drive the June reconciliation numbers."""
import json, calendar

d = json.load(open('model.json'))
inc = {a['key']: (a['default_include'] == 'Y') for a in d['adjustments']}
adj = {a['key']: a for a in d['adjustments']}


def amount(col):
    """Tier price plus any adjustment lines toggled ON (credits are negative)."""
    return col['tier_price'] + sum(adj[k]['amount'] for k in col['adj_keys'] if inc[k])


def frac(col):
    if col['gap'] or not col['date']:
        return 0.0
    y, m, dd = map(int, col['date'].split('-'))
    return 1 - dd / calendar.monthrange(y, m)[1]


def pay_series(cols):
    out = []
    for i, c in enumerate(cols):
        p = amount(c) * c['pct'] * frac(c)
        if i:
            pv = cols[i - 1]
            p += (1 - frac(pv)) * amount(pv) * pv['pct']
        out.append(p)
    return out


bymonth, june = {}, {}
for b in d['blocks']:
    if not b['columns']:
        continue
    ps = pay_series(b['columns'])
    for c, p in zip(b['columns'], ps):
        bymonth[c['ym']] = bymonth.get(c['ym'], 0) + p
        if c['ym'] == '2026-06':
            june[b['notion_name']] = june.get(b['notion_name'], 0) + p

print("=== Harry's pay by calendar month (manual method) ===")
for k in sorted(bymonth):
    print(f"  {k}  {bymonth[k]:10.2f}")

print("\n=== JUNE 2026: manual vs dashboard ===")
ALIAS = {'Isaiah Hursh': 'Ike Hursh'}
dash = d['dash_lines']
names = sorted(set(list(june) + [k for k in dash]))
tm = td = 0.0
print(f"{'Mentee':22}{'Manual':>10}{'Dashboard':>11}{'Variance':>10}")
for n in names:
    dn = ALIAS.get(n, n)
    mv = june.get(n, june.get(dn, 0.0))
    dv = dash.get(dn, {}).get('effective', 0.0)
    if n in ALIAS.values() and n not in june:
        continue
    tm += mv; td += dv
    flag = '' if abs(mv - dv) < 0.005 else '  <<<'
    print(f"{n:22}{mv:>10.2f}{dv:>11.2f}{mv - dv:>10.2f}{flag}")
print(f"{'TOTAL':22}{tm:>10.2f}{td:>11.2f}{tm - td:>10.2f}")
