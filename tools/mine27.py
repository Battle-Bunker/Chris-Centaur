# TAIL-CHASING RETRODICTION (Battlesnake member, sound in our rules, no analogue here).
# For each SNAKE death, was a tail-follow legally available at the moment of death?
# A snake's tail cell vacates as it advances (unless it grew), so following your own
# tail is the canonical survival primitive. Caveat: another unit may contest the cell,
# so "available" is an upper bound on "would have survived".
import gzip,json,glob,statistics
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
ENTRAP={'bodyBlock','self','wall','edge'}
res=defaultdict(lambda: defaultdict(int))
byweight=defaultdict(lambda: [0,0])
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
        s2b={s['teamID']:s['bot'] for s in hdr['seats']}
        roster=hdr['config']['roster']; W=hdr['config']['size']
        for t in turns:
            deaths=t['events'].get('deaths') or {}
            if not deaths: continue
            body={s['id']:s['body'] for s in t['board']['snakes']}
            occupied=set()
            for s in t['board']['snakes']:
                for c in s['body']: occupied.add((c['x'],c['y']))
            for uid,d in deaths.items():
                idx=int(uid.rsplit('-',1)[1])
                if idx<len(roster) and roster[idx]!='snake': continue   # snakes only
                cause=d.get('cause') if isinstance(d,dict) else str(d)
                b=body.get(uid)
                if not b or len(b)<2: continue
                bot=s2b.get(uid.rsplit('-',1)[0])
                res[label][cause]+=1
                if cause not in ENTRAP: continue
                res[label]['ENTRAP_total']+=1
                h=b[0]; tail=b[-1]
                adj=abs(h['x']-tail['x'])+abs(h['y']-tail['y'])==1
                # tail cell is free next turn (unit vacates it) unless someone else sits there
                others=[(c['x'],c['y']) for oid,ob in body.items() if oid!=uid for c in ob]
                clean=(tail['x'],tail['y']) not in set(others)
                if adj and clean:
                    res[label]['ENTRAP_tailfollow_available']+=1
                    byweight[label][0]+=len(b)
                byweight[label][1]+=len(b)
print(f"{'cell':16s} {'snake entrapment deaths':>24s} {'tail-follow available':>22s} {'share':>7s}")
for c in ('snake6','snake5-queen','snake5-knight'):
    tot=res[c]['ENTRAP_total']; av=res[c]['ENTRAP_tailfollow_available']
    print(f"{c:16s} {tot:24d} {av:22d} {100*av/tot if tot else 0:6.1f}%")
print("\ndeath causes (snakes only):")
for c in ('snake6','snake5-queen','snake5-knight'):
    print(f"  {c:16s}", {k:v for k,v in sorted(res[c].items(),key=lambda kv:-kv[1]) if not k.startswith('ENTRAP')})
print("\nweight that a tail-follow could have preserved vs total entrapment-death weight:")
for c in ('snake6','snake5-queen','snake5-knight'):
    a,b=byweight[c]; print(f"  {c:16s} {a:6d} / {b:6d} = {100*a/b if b else 0:.1f}%")
