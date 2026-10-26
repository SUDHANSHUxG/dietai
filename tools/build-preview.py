#!/usr/bin/env python3
"""Build a self-contained preview of the site for publishing as a Claude artifact.

    python3 tools/build-preview.py <out_dir>

Writes <out_dir>/index.html (the homepage) and <out_dir>/<guide>/index.html.
Not part of the site. Rules for the preview:
  - analytics are replaced by a stub that sends nothing, on every page — a real
    beacon from a preview would land in the live funnel this site depends on
  - the Razorpay link is neutralised, so a preview can never reach a payment
  - links are rewritten to be relative, so the homepage and guides navigate
    inside the preview instead of jumping to the live dietai.in
  - no service worker, manifest or icons (those paths don't exist there)
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(sys.argv[1]).resolve()
GUIDES = sorted(p.parent.name for p in ROOT.glob('*/index.html') if p.parent.name.endswith(('diet-plan', 'weight-loss')))
assert len(GUIDES) == 7, GUIDES

STUB = """<script>
/* preview: analytics stub — every call works, nothing is sent anywhere */
window.dietaiLog=function(ev,meta){if(window.console)console.info('[preview] event not sent:',ev,meta||'');};
window.dietaiLogOnce=window.dietaiLog;
</script>"""

BANNER = """<div id="pvBar"><div class="pv-in">
<div class="pv-msg"><b>PREVIEW BUILD</b> — dietai.in from the updated code. Not the live site: analytics and payments are off here. The planner is pre-filled with an example body (32&nbsp;yrs, 175&nbsp;cm, 90&nbsp;kg) — change it and regenerate.</div>
<div class="pv-btns"><button type="button" id="pvFree">👤 Visitor view</button><button type="button" id="pvPaid">⭐ Paying-customer view</button><a href="indian-diet-plan-for-weight-loss/index.html" id="pvGuide">📖 Guide pages</a></div>
</div></div>
<style>
#pvBar{background:linear-gradient(135deg,#ffb84d,#ff8a3d);color:#241303;font:600 13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:10px 14px}
#pvBar .pv-in{max-width:1000px;margin:0 auto;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
#pvBar .pv-msg{max-width:600px}
#pvBar .pv-btns{display:flex;gap:8px;flex-wrap:wrap}
#pvBar button,#pvBar a{border:1px solid rgba(0,0,0,.35);background:rgba(255,255,255,.75);color:#241303;font:700 12.5px system-ui,sans-serif;padding:7px 12px;border-radius:9px;cursor:pointer;text-decoration:none}
#pvBar button[aria-pressed="true"]{background:#241303;color:#ffd9a0;border-color:#241303}
</style>"""

PREVIEW_JS = """<script>
/* preview-only controls; none of this ships to dietai.in */
(function(){
  function isPrem(){try{return localStorage.getItem('dietai_premium')==='1';}catch(e){return false;}}
  function set(on){try{on?localStorage.setItem('dietai_premium','1'):localStorage.removeItem('dietai_premium');}catch(e){}location.reload();}
  var f=document.getElementById('pvFree'),p=document.getElementById('pvPaid');
  f.setAttribute('aria-pressed',String(!isPrem()));p.setAttribute('aria-pressed',String(isPrem()));
  f.onclick=function(){if(isPrem())set(false);};p.onclick=function(){if(!isPrem())set(true);};
  var pay=document.getElementById('payBtn');
  if(pay){pay.removeAttribute('href');pay.removeAttribute('target');pay.style.cursor='pointer';
    pay.addEventListener('click',function(e){e.preventDefault();e.stopImmediatePropagation();
      if(typeof toast==='function')toast('Preview: payment is off. Use "Paying-customer view" above.');},true);}
  try{if(!localStorage.getItem('dietai_plan')){
    document.getElementById('age').value=32;document.getElementById('height').value=175;document.getElementById('weight').value=90;
    if(typeof generatePlan==='function'){generatePlan();window.scrollTo(0,0);}}}catch(e){}
})();
</script>"""

# ---- homepage --------------------------------------------------------------
src = (ROOT / 'index.html').read_text(encoding='utf-8')
style = re.search(r'<style>.*?</style>', src, re.S).group(0)
body = re.search(r'<body>(.*?)</body>', src, re.S).group(1)
body = body.replace("if('serviceWorker' in navigator&&location.protocol==='https:'){", "if(false){")
for g in GUIDES:
    body = body.replace(f'href="/{g}/"', f'href="{g}/index.html"')
assert not any(f'href="/{g}/"' in body for g in GUIDES), 'a guide link was not rewritten'
home = '<title>Diet AI Preview</title>\n' + style + '\n' + STUB + '\n' + BANNER + body + PREVIEW_JS
assert 'sendBeacon' not in home and '/events.js' not in home
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'index.html').write_text(home, encoding='utf-8')

# ---- guides ----------------------------------------------------------------
for g in GUIDES:
    h = (ROOT / g / 'index.html').read_text(encoding='utf-8')
    h = h.replace('<script src="/events.js"></script>', STUB)
    h = re.sub(r'href="/\?', 'href="../index.html?', h)          # planner CTAs
    h = h.replace('href="/"', 'href="../index.html"')            # logo, breadcrumb, footer
    for o in GUIDES:
        h = h.replace(f'href="/{o}/"', f'href="../{o}/index.html"')
    h = h.replace('<body>', '<body><div style="background:#ffb84d;color:#241303;font:600 12.5px system-ui,sans-serif;padding:8px 14px;text-align:center">PREVIEW — guide page as it will appear at dietai.in/' + g + '/ · <a href="../index.html" style="color:#241303">back to the app</a></div>', 1)
    assert '/events.js' not in h and 'sendBeacon' not in h
    left = re.findall(r'href="/[^"]*"', h)
    assert not left, (g, left)
    (OUT / g).mkdir(exist_ok=True)
    (OUT / g / 'index.html').write_text(h, encoding='utf-8')

print('preview:', OUT / 'index.html', '+', len(GUIDES), 'guides')
