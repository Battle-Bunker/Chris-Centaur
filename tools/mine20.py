# ATTRIBUTION AUDIT: per-turn, does the sum of per-unit flow events equal the team's
# actual weight change (standings.material)? Any gap is weight the evaluator's flow
# model cannot see. Reports the size of the gap and which events it co-occurs with.
import gzip,json,glob,statistics
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
tot=defaultdict(float); n=0
gapby=defaultdict(float); absgap=defaultdict(float)
examples=[]
for batch,label in [("rl1","snake6"),("rl4","snake5-queen"),("rl3","snake5-knight")]:
    for f in sorted(glob.glob(f"{SP}/continuous/{batch}/arms/*/*/*.jsonl.gz")):
        hdr=None;turns=[]
        try:
            with gzip.open(f,'rt') as fh:
                for line in fh:
                    r=json.loads(line)
                    if r['kind']=='header':hdr=r
                    elif r['kind']=='turn':turns.append(r)
        except Exception: pass
        if not(hdr and turns): continue
        n+=1
        prevlen={};prevstand=None
        for t in turns:
            cur={s['id']:s['length'] for s in t['board']['snakes']}
            st={s['teamID']:s['material'] for s in t['standings']}
            if prevstand:
                dead=set(t['events'].get('deaths') or {})
                acct=defaultdict(float)   # per-unit reconstruction
                for uid,pl in prevlen.items():
                    tm=uid.rsplit('-',1)[0]
                    if uid in dead: acct[tm]-=pl
                    else: acct[tm]+= cur.get(uid,pl)-pl
                for uid in cur:                      # units that APPEARED (respawn/new)
                    if uid not in prevlen: acct[uid.rsplit('-',1)[0]]+=cur[uid]
                for tm in set(st)|set(prevstand):
                    actual=st.get(tm,0)-prevstand.get(tm,0)
                    g=actual-acct[tm]
                    tot[label]+=abs(g); absgap['all']+=abs(g)
                    tot[label+'_moved']+=abs(actual)
                    if abs(g)>0.5 and len(examples)<6:
                        ev={k:v for k,v in t['events'].items() if v and k not in('clashes',)}
                        examples.append((label,t['turn'],tm,actual,acct[tm],g,list(ev.keys())))
            prevlen=cur; prevstand=st
print(f"ATTRIBUTION AUDIT over {n} games\n")
print(f"{'cell':16s} {'unattributed |weight|':>22s} {'total |weight moved|':>21s} {'gap share':>10s}")
for c in ('snake6','snake5-queen','snake5-knight'):
    a=tot[c]; m=tot[c+'_moved']
    print(f"{c:16s} {a:22.0f} {m:21.0f} {100*a/m if m else 0:9.2f}%")
print("\nsample unattributed turns (cell, turn, team, actual dW, reconstructed, gap, events present):")
for e in examples: print("   ",e)
