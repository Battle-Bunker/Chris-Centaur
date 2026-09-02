"""INSTRUMENT 2 - Nash averaging + transitive/cyclic (Hodge) decomposition.

Antisymmetric payoff A[i][j] = mean(sharePar_i - sharePar_j) over games where both
were seated. Two readings:

  MAXENT NASH mass concentration -> a NUMBER for lineage redundancy. If the equilibrium
  puts its mass on a handful of arms, the rest are strategically redundant: the archive
  contains fewer distinct competitors than it contains names.

  HODGE SPLIT  A = A_transitive + A_cyclic, with A_transitive[i][j] = r_i - r_j fitted by
  weighted least squares over OBSERVED edges (HodgeRank). A non-negligible cyclic fraction
  means "which bot is better" is ill-posed and rosters must be mixtures.

Bounded statistics are checked against their bounds (standing rule): cyclicity is in
[0,1] and Nash mass in [0,1]; both are asserted.
"""
import csv,math,statistics,itertools,sys
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"

def pairwise(rows, mingames=20):
    bygame=defaultdict(dict)
    for r in rows: bygame[r['game']][r['bot']]=float(r['sharePar'])
    diff=defaultdict(list)
    for g,d in bygame.items():
        for i,j in itertools.combinations(sorted(d),2):
            diff[(i,j)].append(d[i]-d[j])
    A={}; N={}
    for (i,j),v in diff.items():
        if len(v)<mingames: continue
        A[(i,j)]=statistics.mean(v); A[(j,i)]=-A[(i,j)]
        N[(i,j)]=N[(j,i)]=len(v)
    bots=sorted({b for p in A for b in p})
    return bots,A,N

def components(bots,A):
    adj=defaultdict(set)
    for (i,j) in A: adj[i].add(j)
    seen=set(); comps=[]
    for b in bots:
        if b in seen: continue
        st=[b]; c=set()
        while st:
            x=st.pop()
            if x in c: continue
            c.add(x); st+=[y for y in adj[x] if y not in c]
        seen|=c; comps.append(sorted(c))
    return comps

def max_clique(bots,A):
    best=[]
    for r in range(len(bots),1,-1):
        for cand in itertools.combinations(bots,r):
            if all((i,j) in A for i,j in itertools.combinations(cand,2)):
                return list(cand)
    return best

def qre_nash(bots,A,tau=0.02,iters=20000,damp=0.05):
    """Entropy-regularised (maxent-selecting) equilibrium: p = softmax(A p / tau)."""
    n=len(bots); p=[1.0/n]*n
    idx={b:k for k,b in enumerate(bots)}
    M=[[A.get((bots[i],bots[j]),0.0) for j in range(n)] for i in range(n)]
    for _ in range(iters):
        u=[sum(M[i][j]*p[j] for j in range(n)) for i in range(n)]
        m=max(u); e=[math.exp((x-m)/tau) for x in u]; s=sum(e)
        q=[x/s for x in e]
        p=[(1-damp)*a+damp*b for a,b in zip(p,q)]
    u=[sum(M[i][j]*p[j] for j in range(n)) for i in range(n)]
    return p,max(u)

def hodge(bots,A,N):
    """Weighted least-squares gradient fit over observed edges; returns ratings and split."""
    n=len(bots); idx={b:k for k,b in enumerate(bots)}
    r=[0.0]*n
    edges=[(idx[i],idx[j],A[(i,j)],N[(i,j)]) for (i,j) in A if i<j]
    for _ in range(50000):                       # Jacobi on the weighted graph Laplacian
        num=[0.0]*n; den=[0.0]*n
        for a,b,v,w in edges:
            num[a]+=w*(r[b]+v); den[a]+=w
            num[b]+=w*(r[a]-v); den[b]+=w
        new=[num[k]/den[k] if den[k] else r[k] for k in range(n)]
        mu=sum(new)/n; new=[x-mu for x in new]
        if max(abs(x-y) for x,y in zip(new,r))<1e-12: r=new; break
        r=new
    num=den=0.0
    for a,b,v,w in edges:
        t=r[a]-r[b]; num+=w*(v-t)**2; den+=w*v*v
    return r, (num/den if den else 0.0)

def report(rows,label,mingames=20):
    bots,A,N=pairwise(rows,mingames)
    print(f"\n{'='*78}\n{label}   (edge = a bot pair with >= {mingames} shared games)\n{'='*78}")
    print(f"bots with at least one edge: {len(bots)}")
    npairs=len(bots)*(len(bots)-1)//2; obs=len([1 for (i,j) in A if i<j])
    print(f"TOURNAMENT GRAPH DENSITY: {obs}/{npairs} pairs observed = {100*obs/npairs:.0f}%")
    comps=components(bots,A)
    print(f"connected components: {len(comps)}")
    for c in comps: print(f"    {len(c)}: {c}")
    cl=max_clique(bots,A)
    print(f"largest complete subgraph (all pairs played): {len(cl)} -> {cl}")
    r,cyc=hodge(bots,A,N)
    assert 0.0-1e-9<=cyc<=1.0+1e-9, f"cyclicity {cyc} outside [0,1]"
    order=sorted(range(len(bots)),key=lambda k:-r[k])
    print(f"\nHODGE (all observed edges, weighted by shared games):")
    print(f"    transitive ratings: " + ", ".join(f"{bots[k]}={r[k]:+.3f}" for k in order))
    print(f"    CYCLIC FRACTION of ||A||^2 = {100*cyc:.1f}%   (bounded [0,100], checked)")
    if len(cl)>=3:
        sub={(i,j):A[(i,j)] for i in cl for j in cl if i!=j}
        subN={(i,j):N[(i,j)] for i in cl for j in cl if i!=j}
        rc,cycc=hodge(cl,sub,subN)
        p,val=qre_nash(cl,sub)
        assert abs(sum(p)-1)<1e-6
        ent=-sum(x*math.log(x) for x in p if x>1e-12); eff=math.exp(ent)
        pr=sorted(zip(cl,p),key=lambda kv:-kv[1])
        print(f"\nON THE COMPLETE SUBGRAPH {cl}:")
        print(f"    cyclic fraction = {100*cycc:.1f}%")
        print(f"    maxent Nash (tau=0.02): " + ", ".join(f"{b}={q:.3f}" for b,q in pr))
        print(f"    top-1 mass {pr[0][1]:.3f}   effective support exp(H) = {eff:.2f} of {len(cl)}"
              f"   -> REDUNDANCY = {100*(1-eff/len(cl)):.0f}%")
        print(f"    max exploitability {val:+.4f} (0 = exact Nash)")

if __name__=='__main__':
    rows=list(csv.DictReader(open(f"{SP}/archx-value/tools/population.csv")))
    report(rows,"WHOLE ARCHIVE")
    report([r for r in rows if r['src']=='native'],"NATIVE sharePar ONLY")
