import gzip,json,sys,os,glob,statistics
from collections import defaultdict
def games(batch):
    for arm in ('nullA','nullB'):
        for d in glob.glob(f"{batch}/arms/{arm}/*"):
            if os.path.isdir(d):
                for f in sorted(glob.glob(d+"/*.jsonl.gz")): yield arm,f
def run(batch,label):
    acc=defaultdict(lambda: defaultdict(list))
    horizons=defaultdict(lambda: defaultdict(int))
    postures=defaultdict(lambda: defaultdict(int))
    ng=0
    for arm,f in games(batch):
        hdr=None;turns=[]
        with gzip.open(f,'rt') as fh:
            for line in fh:
                r=json.loads(line)
                if r['kind']=='header':hdr=r
                elif r['kind']=='turn':turns.append(r)
        if hdr is None: continue
        ng+=1
        seat2bot={s['teamID']:s['bot'] for s in hdr['seats']}
        for t in turns:
            for team,tel in (t.get('telemetry') or {}).items():
                b=seat2bot.get(team)
                if not b or not isinstance(tel,dict): continue
                for k in ('wallMs','plansEvaluated','slices','emissions','overrunMs','assumptions','boundViolations'):
                    if k in tel and isinstance(tel[k],(int,float)): acc[b][k].append(tel[k])
                ch=tel.get('chosen') or {}
                if 'horizon' in ch: horizons[b][ch['horizon']]+=1
                if 'posture' in ch: postures[b][ch['posture']]+=1
    print(f"=== {label} ({ng} games) ===")
    for b in sorted(acc):
        a=acc[b]
        def m(k):
            return statistics.mean(a[k]) if a[k] else float('nan')
        print(f"  {b:20s} wallMs={m('wallMs'):7.0f}  plansEval={m('plansEvaluated'):9.0f}  slices={m('slices'):8.0f}  emissions={m('emissions'):5.1f}")
        print(f"      horizons={dict(sorted(horizons[b].items()))}  postures={dict(postures[b])}")
run(sys.argv[1],sys.argv[2])
