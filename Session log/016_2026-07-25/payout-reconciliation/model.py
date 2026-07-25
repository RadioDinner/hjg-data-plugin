"""Build the Harry Shenk manual-payout data model from the raw dashboard export
plus the Notion mentee database. Emits `model.json` consumed by build_xlsx.py."""
import pandas as pd, json, re, datetime as dt

RAW = 'raw/'
NOTION = '/root/.claude/uploads/c3bf1149-3792-577a-9f33-56f56d325713/ff0ff244-Mentees_Database_5a5cd7941be5456f9602439a17bbceb8_all.csv'
HARRY_ID = 29074
HARRY_START_YM = '2024-05'          # earliest CA engagement for coach 29074
RAMP = [0.35, 0.50, 0.60]            # HJG policy: ramps on the MENTOR's tenure
END_YM = '2026-07'                   # data horizon

# ---------------------------------------------------------------- roster
def strip_url(v):
    if pd.isna(v):
        return None
    return re.sub(r'\s*\(https://[^)]*\)', '', str(v)).strip()

nd = pd.read_csv(NOTION)
nd['M1'] = nd['Mentor 1'].map(strip_url)
nd['who'] = nd['Mentees Paired'].astype(str).str.replace('—.*', '', regex=True).str.strip()
notion_harry = nd[(nd['Mentor'] == 'Harry Shenk') | (nd['M1'] == 'Harry Shenk')].copy()

mentees = pd.read_csv(RAW + 'mentees.csv')
ALIAS = {'Isaiah Hursh': 'Ike Hursh', 'Sam Glick': 'Samuel Glick'}
ca_by_name = dict(zip(mentees['ca_name'], mentees['client_id']))

roster = []
for _, r in notion_harry.iterrows():
    nm = r['who']
    ca_name = ALIAS.get(nm, nm)
    cid = ca_by_name.get(ca_name)
    roster.append({
        'notion_name': nm,
        'ca_name': ca_name if cid else None,
        'client_id': int(cid) if cid else None,
        'notion_status': r['Status'],
        'notion_tier_amount': r['Current Invoice Amount'],
    })

# ---------------------------------------------------------- line classifier
MENTORING = re.compile(r'^MN Subscription \| \((\d)x Month\) Zoom Meetings|'
                       r'^One-on-One Mentoring$|^Monthly Mentoring Subscription$|'
                       r'^JumpStart Your Freedom & One-on-One Mentoring$')
NOT_MENTORING = ('JYF Supervised Progress', 'One-Time Setup Fee',
                 'JumpStart Your Freedom Supervised Progress', 'JumpStart Your Freedom',
                 'MT Engagement', 'Tracking Together')


def classify(item, amount):
    """-> ('mentoring', tier) | ('credit', None) | ('excluded', None)"""
    it = (item or '').strip()
    if amount < 0:
        return 'credit', None
    # Mentoring test runs FIRST: "JumpStart Your Freedom & One-on-One Mentoring" is a
    # bundled mentoring subscription, not a JYF-only fee, and would otherwise be
    # swallowed by the "JumpStart Your Freedom" exclusion below.
    mm = MENTORING.match(it)
    if mm:
        return 'mentoring', (mm.group(1) + 'x') if mm.group(1) else '4x'
    if any(k in it for k in NOT_MENTORING):
        return 'excluded', None
    return 'excluded', None


def coach_in_label(item):
    m = re.search(r'\(([^)]+)\)\s*$', item or '')
    return m.group(1) if m else None


# ------------------------------------------------------------- invoices
inv = pd.read_csv(RAW + 'ca_invoices.csv')
inv['client_id'] = inv['client_id'].astype('Int64')
ids = {r['client_id'] for r in roster if r['client_id']}
sub = inv[inv['client_id'].isin(ids)].copy()
sub['date_of'] = sub['date_of'].astype(str).str[:10]
sub = sub.sort_values(['client_id', 'date_of', 'invoice_number'])

events = {}   # client_id -> list of billing events
adjustments = []

for _, r in sub.iterrows():
    cid = int(r['client_id'])
    lis = json.loads(r['line_items']) if isinstance(r['line_items'], str) and r['line_items'].strip() else []
    ment, creds, excl = [], [], []
    for i, x in enumerate(lis):
        kind, tier = classify(x['item'], x['amount'])
        rec = {'idx': i, 'item': x['item'], 'amount': x['amount'], 'tier': tier}
        (ment if kind == 'mentoring' else creds if kind == 'credit' else excl).append(rec)
    if not ment:
        continue
    inv_no = str(r['invoice_number'])
    # Primary mentoring line = the largest; any FURTHER mentoring lines on the same
    # invoice are duplicates the reviewer decides on (user: "Josh one").
    ment.sort(key=lambda z: -z['amount'])
    primary, dups = ment[0], ment[1:]
    ev = {
        'client_id': cid,
        'invoice_number': inv_no,
        'invoice_id': int(r['id']),
        'date': r['date_of'],
        'ym': r['date_of'][:7],
        'day': int(r['date_of'][8:10]),
        'tier': primary['tier'],
        'tier_price': primary['amount'],
        'invoice_amount': float(r['amount']),
        'collected': float(r['amount_paid']),
        'label_coach': coach_in_label(primary['item']),
        'primary_item': primary['item'],
        'excluded_lines': [(z['item'], z['amount']) for z in excl],
        'adj_keys': [],
    }
    key_base = f"{inv_no}"
    for d in dups:
        k = f"{key_base}#dup{d['idx']}"
        adjustments.append({'key': k, 'client_id': cid, 'invoice_number': inv_no,
                            'date': r['date_of'], 'item': d['item'], 'amount': d['amount'],
                            'kind': 'duplicate mentoring line', 'default_include': 'N'})
        ev['adj_keys'].append(k)
    for c in creds:
        k = f"{key_base}#cr{c['idx']}"
        adjustments.append({'key': k, 'client_id': cid, 'invoice_number': inv_no,
                            'date': r['date_of'], 'item': c['item'], 'amount': c['amount'],
                            'kind': 'credit / discount', 'default_include': 'N'})
        ev['adj_keys'].append(k)
    events.setdefault(cid, []).append(ev)

# ------------------------------------------------------- per-mentee columns
def ym_add(ym, n):
    y, m = map(int, ym.split('-'))
    o = y * 12 + (m - 1) + n
    return f"{o // 12}-{o % 12 + 1:02d}"

def ym_diff(a, b):
    ya, ma = map(int, a.split('-')); yb, mb = map(int, b.split('-'))
    return (yb * 12 + mb) - (ya * 12 + ma)

def split_pct(ym):
    t = ym_diff(HARRY_START_YM, ym) + 1
    return RAMP[min(max(t, 1), len(RAMP)) - 1]

MONTH_NAME = ['', 'January', 'February', 'March', 'April', 'May', 'June',
              'July', 'August', 'September', 'October', 'November', 'December']

blocks = []
for r in roster:
    cid = r['client_id']
    evs = sorted(events.get(cid, []), key=lambda e: (e['date'], e['invoice_number']))
    if not evs:
        blocks.append({**r, 'columns': [], 'note': 'no mentoring invoices in the raw data'})
        continue
    first_ym, last_ym = evs[0]['ym'], evs[-1]['ym']
    # One trailing month past the last invoice: that's where its elapsed slice lands.
    tail_ym = ym_add(last_ym, 1)
    cols = []
    ym = first_ym
    while ym_diff(ym, tail_ym) >= 0:
        month_evs = [e for e in evs if e['ym'] == ym]
        if month_evs:
            for e in month_evs:
                y, mo = map(int, ym.split('-'))
                cols.append({
                    'ym': ym, 'label': f"{MONTH_NAME[mo]} {y}",
                    'date': e['date'], 'day': e['day'],
                    'tier': e['tier'], 'tier_price': e['tier_price'],
                    'invoice_number': e['invoice_number'],
                    'invoice_amount': e['invoice_amount'], 'collected': e['collected'],
                    'label_coach': e['label_coach'], 'primary_item': e['primary_item'],
                    'excluded_lines': e['excluded_lines'],
                    'adj_keys': e['adj_keys'],
                    'pct': split_pct(ym), 'gap': False,
                })
        else:
            y, mo = map(int, ym.split('-'))
            cols.append({'ym': ym, 'label': f"{MONTH_NAME[mo]} {y}", 'date': None, 'day': None,
                         'tier': '—', 'tier_price': 0.0, 'invoice_number': None,
                         'invoice_amount': 0.0, 'collected': 0.0, 'label_coach': None,
                         'primary_item': None, 'excluded_lines': [], 'adj_keys': [],
                         'pct': split_pct(ym), 'gap': True})
        ym = ym_add(ym, 1)
    blocks.append({**r, 'columns': cols, 'note': None})

blocks.sort(key=lambda b: (0 if b['columns'] else 1, b['notion_name']))

# ------------------------------------------------------- dashboard paystub
dash = pd.read_csv('/root/.claude/uploads/c3bf1149-3792-577a-9f33-56f56d325713/'
                   'd67b1f42-payoutbuildharryshenk20260620260725.csv')
dash = dash[dash['Mentee'] != 'TOTAL']
dash_lines = {}
for _, r in dash.iterrows():
    if pd.notna(r['Effective payout']):
        dash_lines[r['Mentee']] = {
            'client_id': int(r['Client ID']), 'tier': r['Tier'],
            'engine': float(r['Engine payout']) if pd.notna(r['Engine payout']) else 0.0,
            'effective': float(r['Effective payout']),
        }

out = {'roster': roster, 'blocks': blocks, 'adjustments': adjustments,
       'dash_lines': dash_lines, 'harry_start_ym': HARRY_START_YM, 'ramp': RAMP}
json.dump(out, open('model.json', 'w'), indent=1, default=str)

print(f"roster={len(roster)}  blocks_with_data={sum(1 for b in blocks if b['columns'])}  "
      f"adjustments={len(adjustments)}  dash_lines={len(dash_lines)}")
print(f"widest block = {max((len(b['columns']) for b in blocks), default=0)} columns")
for b in blocks:
    if b['columns']:
        c = b['columns']
        print(f"  {b['notion_name']:22} {len(c):3d} cols  {c[0]['ym']} -> {c[-1]['ym']}"
              f"  adj={sum(len(x['adj_keys']) for x in c)}")
    else:
        print(f"  {b['notion_name']:22}   -  {b['note']}")
