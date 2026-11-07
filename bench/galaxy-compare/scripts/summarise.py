import json, statistics as st, collections
R = collections.defaultdict(list)
for l in open('out/results.jsonl'):
    r = json.loads(l); R[(r['id'], r['viewer'])].append(r)
order = ['nt_1k_x300','nt_10k_x300','nt_50k_x300','nt_2k_x6000','nt_500_x50k','aa_1k_x400','aa_10k_x400','aa_50k_x400','aa_100k_x400']
size = {'nt_1k_x300':(1000,300),'nt_10k_x300':(10000,300),'nt_50k_x300':(50000,300),'nt_2k_x6000':(2000,6000),'nt_500_x50k':(500,50000),
        'aa_1k_x400':(1000,400),'aa_10k_x400':(10000,400),'aa_50k_x400':(50000,400),'aa_100k_x400':(100000,400)}
def med(rs, f):
    v = [f(r) for r in rs if r.get('status') == 'ok']
    v = [x for x in v if x is not None]
    return st.median(v) if v else None
rows = []
for d in order:
    for v in ['va','av2','ajs']:
        rs = R[(d, v)]; ok = sum(r.get('status') == 'ok' for r in rs)
        fails = sorted({r.get('reason','') for r in rs if r.get('status') != 'ok'})
        rows.append(dict(dataset=d, seqs=size[d][0], cols=size[d][1], residuesM=round(size[d][0]*size[d][1]/1e6,2), viewer=v,
            runs_ok=f'{ok}/{len(rs)}', ready_s=med(rs, lambda r: r['readyMs']/1000), interactive_s=med(rs, lambda r: r['interactiveMs']/1000),
            heap_MB=med(rs, lambda r: r['heapMB']),
            scrollV_p95_ms=med(rs, lambda r: r['scroll_v']['p95FrameMs']), scrollV_janky=med(rs, lambda r: r['scroll_v']['framesOver50ms']),
            scrollH_p95_ms=med(rs, lambda r: r['scroll_h']['p95FrameMs']), scrollH_janky=med(rs, lambda r: r['scroll_h']['framesOver50ms']),
            proceed_dialog=any(r.get('proceedDialog') for r in rs), failures='; '.join(fails)))
import csv
with open('out/summary.csv','w',newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
fmt = lambda x: '-' if x is None else (f'{x:.1f}' if isinstance(x,float) else str(x))
for r in rows:
    print(f"{r['dataset']:13} {r['viewer']:4} {r['runs_ok']:4} ready {fmt(r['ready_s']):>5}s inter {fmt(r['interactive_s']):>5}s heap {fmt(r['heap_MB']):>5}MB  V p95 {fmt(r['scrollV_p95_ms']):>6} jank {fmt(r['scrollV_janky']):>4}  H p95 {fmt(r['scrollH_p95_ms']):>6} jank {fmt(r['scrollH_janky']):>4} {'PROCEED' if r['proceed_dialog'] else ''} {r['failures']}")
