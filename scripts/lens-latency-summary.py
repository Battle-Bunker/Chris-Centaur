import json, sys, glob, statistics as st
files = sorted(glob.glob(sys.argv[1]))
runs = [json.load(open(f)) for f in files]
def med(vals):
    vals = [v for v in vals if v is not None]
    return round(st.median(vals), 2) if vals else None
keys = set()
for r in runs: keys |= set(r['spans'])
print(f"{len(runs)} runs: {[r['label'] for r in runs]}")
print(f"{'span':34} {'n':>5} {'sum':>8} {'p50':>7} {'p95':>7} {'max':>7} {'layout':>7} {'redun':>10}")
rows=[]
for k in keys:
    xs=[r['spans'][k] for r in runs if k in r['spans']]
    rows.append((med([x['sum'] for x in xs]), k, xs))
for s,k,xs in sorted(rows, reverse=True):
    red = ''
    if 'redundantWrites' in xs[0]:
        red = f"{med([x['redundantWrites'] for x in xs]):.0f}/{med([x['n'] for x in xs]):.0f}"
    print(f"{k:34} {med([x['n'] for x in xs]):>5.0f} {s:>8.1f} {med([x['p50'] for x in xs]):>7.2f} {med([x['p95'] for x in xs]):>7.2f} {med([x['max'] for x in xs]):>7.2f} {med([x['layoutReads'] for x in xs]):>7.0f} {red:>10}")
for name in ['arrivalToBoardPaintMs','arrivalToRailMs']:
    xs=[r[name] for r in runs if r.get(name)]
    print(f"{name}: p50={med([x['p50'] for x in xs])} p95={med([x['p95'] for x in xs])} max={med([x['max'] for x in xs])}")
for name in ['hoverMs','pinMs']:
    xs=[r['interaction'][name] for r in runs if r['interaction'].get(name)]
    if xs: print(f"interaction.{name}: p50={med([x['p50'] for x in xs])} p95={med([x['p95'] for x in xs])} max={med([x['max'] for x in xs])}")
for t in ['board-update','lens-frames']:
    xs=[r['messages'][t] for r in runs if t in r['messages']]
    if xs: print(f"msg {t}: n={med([x['count'] for x in xs]):.0f} parseSum={med([x['parseMs']['sum'] for x in xs])} bytes p50={med([x['bytes']['p50'] for x in xs]):.0f} max={med([x['bytes']['max'] for x in xs]):.0f} total={med([x['bytes']['sum'] for x in xs]):.0f}")
lt=[r['longTasks'] for r in runs if r['longTasks'].get('n')]
if lt: print(f"longTasks: n={med([x['n'] for x in lt]):.0f} sum={med([x['sum'] for x in lt])} p50={med([x['p50'] for x in lt])} max={med([x['max'] for x in lt])}")
print("dom:", {k: med([r['dom'][k] for r in runs]) for k in runs[0]['dom']})
agg={}
for r in runs:
    for e in r['cpu']['top']:
        agg.setdefault(e['fn'], []).append(e['ms'])
print("cpu self-time (median ms over runs, our code only):")
for fn, ms in sorted(agg.items(), key=lambda x:-st.median(x[1]))[:14]:
    print(f"   {st.median(ms):8.1f}  {fn}")
