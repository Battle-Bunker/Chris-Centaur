import gzip,json,sys,os,glob,statistics
from collections import defaultdict
def games(batch):
    for arm in ('nullA','nullB'):
        for d in glob.glob(f"{batch}/arms/{arm}/*"):
            if os.path.isdir(d):
                for f in sorted(glob.glob(d+"/*.jsonl.gz")): yield arm,f
def run(batch,label,CUT=40):
    d_early=defaultdict(int); d_late=defaultdict(int)
    kd=defaultdict(int); sd=defaultdict(int)
    mat_at=defaultdict(lambda: defaultdict(list))
    alive_at=defaultdict(list)
    ng=0
    for arm,f in games(batch):
        hdr=None;turns=[];res=None
        with gzip.open(f,'rt') as fh:
            for line in fh:
                r=json.loads(line)
                if r['kind']=='header':hdr=r
                elif r['kind']=='result':res=r
                elif r['kind']=='turn':turns.append(r)
        if hdr is None: continue
        ng+=1
        s2b={s['teamID']:s['bot'] for s in hdr['seats']}
        roster=hdr['config']['roster']
        for t in turns:
            tn=t['turn']
            for uid in (t['events'].get('deaths') or {}):
                team=uid.rsplit('-',1)[0]; idx=int(uid.rsplit('-',1)[1]); b=s2b.get(team)
                kind=roster[idx] if idx<len(roster) else '?'
                (d_early if tn<=CUT else d_late)[b]+=1
                if kind=='knight': kd[b]+=1
                else: sd[b]+=1
            for st in (t.get('standings') or []):
                if tn in (20,40,60,80,120):
                    mat_at[s2b.get(st['teamID'])][tn].append(st['material'])
        # teams alive at turn 40
        for t in turns:
            if t['turn']==40:
                alive_at['n'].append(sum(1 for st in t['standings'] if st.get('alive')))
    print(f"=== {label} ({ng} games) ===  teams alive @t40: mean {statistics.mean(alive_at['n']):.2f}" if alive_at['n'] else f"=== {label} ===")
    print(f"{'bot':22s} {'deaths t<=40':>13s} {'deaths t>40':>12s} {'knightD':>8s} {'snakeD':>7s} | material at turn:")
    for b in sorted(d_early|d_late):
        row=f"{b:22s} {d_early[b]/ng:13.2f} {d_late[b]/ng:12.2f} {kd[b]/ng:8.2f} {sd[b]/ng:7.2f} | "
        row+=" ".join(f"t{tn}={statistics.mean(v):5.1f}" for tn,v in sorted(mat_at[b].items()) if v)
        print(row)
run(sys.argv[1],sys.argv[2])
