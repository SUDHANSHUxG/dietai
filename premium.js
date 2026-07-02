/* Diet AI — Premium Pack (7-day plan + grocery list, client-side) */
(function(){
  // ==== CONFIG: paste your Razorpay Payment Link below, keep quotes ====
  var PAY_LINK = "";
  // In Razorpay, set the payment link's redirect URL to: https://dietai.in/?premium=unlocked
  var PRICE = "₹99";

  function isPremium(){ return localStorage.getItem('dietai_premium')==='1'; }

  // Unlock after Razorpay redirect
  try{
    if(new URLSearchParams(location.search).get('premium')==='unlocked'){
      localStorage.setItem('dietai_premium','1');
      history.replaceState({},'',location.pathname);
      alert('🎉 Premium unlocked! Generate your plan, then open your 7-day Premium Pack.');
    }
  }catch(e){}

  // Inject CTA card into plan results
  function injectCard(){
    var res = document.getElementById('planResults');
    if(!res || document.getElementById('premiumCard')) return;
    var d = document.createElement('div');
    d.id = 'premiumCard';
    d.style.cssText = 'margin-top:18px;padding:20px;border-radius:14px;background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;text-align:center';
    d.innerHTML =
      '<div style="font-size:20px;font-weight:800;margin-bottom:6px">🔥 Premium Pack</div>'+
      '<div style="color:#cbd5e1;font-size:14.5px;margin-bottom:14px">Your personalised <b>7-day meal plan</b> + <b>grocery list</b>, printable / save as PDF. One-time '+PRICE+', yours forever on this device.</div>'+
      '<button class="btn btn-primary" style="width:100%" id="premiumBtn"></button>'+
      '<div style="font-size:12px;color:#94a3b8;margin-top:8px">Secure payment via Razorpay · UPI, cards, netbanking</div>';
    res.appendChild(d);
    var b = document.getElementById('premiumBtn');
    refreshBtn(b);
    b.onclick = function(){
      if(isPremium()){ openPack(); return; }
      if(!PAY_LINK){ alert('Payments are being set up — check back in a day or two!'); return; }
      location.href = PAY_LINK;
    };
  }
  function refreshBtn(b){
    b = b || document.getElementById('premiumBtn');
    if(b) b.textContent = isPremium() ? '📄 Open my 7-day Premium Pack' : '⚡ Unlock Premium — '+PRICE;
  }

  // Watch for plan generation
  var orig = window.generatePlan;
  window.generatePlan = function(){ orig.apply(this,arguments); injectCard(); refreshBtn(); };

  // ===== 7-day plan builder (uses FOODS + lastPlan from main script) =====
  var SPLITS = [['Breakfast','🌅'],['Lunch','☀️'],['Dinner','🌙'],['Snack','🍎']];
  var PICKS = {
    Breakfast:[["Oats, dry (40g)","Milk, toned (1 cup)","Banana (1)"],["Idli (2)","Curd / Yogurt (1 cup)"],["Whole wheat bread (2 slices)","Egg, boiled (1)","Egg, boiled (1)"],["Poha (1 plate)","Curd / Yogurt (1 cup)"],["Dosa, plain (1)","Sprouts (1 cup)"],["Oats, dry (40g)","Greek yogurt (150g)","Almonds (10)"],["Idli (2)","Milk, toned (1 cup)","Banana (1)"]],
    Lunch:[["Roti / Chapati (1)","Roti / Chapati (1)","Dal cooked (1 cup)","Mixed veg sabzi (1 cup)","Curd / Yogurt (1 cup)"],["Plain rice (1 cup)","Rajma cooked (1 cup)","Salad bowl (veg)"],["Brown rice (1 cup)","Chicken breast (100g)","Salad bowl (veg)"],["Plain rice (1 cup)","Chole cooked (1 cup)","Salad bowl (veg)"],["Roti / Chapati (1)","Roti / Chapati (1)","Paneer (100g)","Salad bowl (veg)"],["Brown rice (1 cup)","Fish, cooked (100g)","Mixed veg sabzi (1 cup)"],["Roti / Chapati (1)","Roti / Chapati (1)","Dal cooked (1 cup)","Tofu (100g)"]],
    Dinner:[["Roti / Chapati (1)","Roti / Chapati (1)","Paneer (100g)","Mixed veg sabzi (1 cup)"],["Plain rice (1 cup)","Dal cooked (1 cup)","Tofu (100g)"],["Fish, cooked (100g)","Brown rice (1 cup)","Salad bowl (veg)"],["Chicken breast (100g)","Roti / Chapati (1)","Roti / Chapati (1)","Salad bowl (veg)"],["Dal cooked (1 cup)","Roti / Chapati (1)","Mixed veg sabzi (1 cup)","Curd / Yogurt (1 cup)"],["Paneer (100g)","Brown rice (1 cup)","Salad bowl (veg)"],["Rajma cooked (1 cup)","Plain rice (1 cup)","Salad bowl (veg)"]],
    Snack:[["Greek yogurt (150g)","Almonds (10)"],["Apple (1)","Peanuts (handful, 30g)"],["Whey protein (1 scoop)","Banana (1)"],["Sprouts (1 cup)"],["Peanut butter (1 tbsp)","Whole wheat bread (2 slices)"],["Curd / Yogurt (1 cup)","Banana (1)"],["Cheese slice (1)","Apple (1)"]]
  };
  // FOODS and lastPlan are top-level const/let in the main script: shared global lexical scope
  function foodBy(n){ try{ return FOODS.find(function(f){return f.n===n;}); }catch(e){ return null; } }

  function openPack(){
    if(typeof lastPlan==='undefined' || !lastPlan){ alert('Generate your plan above first, then open your Premium Pack.'); return; }
    var target = lastPlan.target, protein = lastPlan.protein;
    var days = '', grocery = {};
    for(var d=0; d<7; d++){
      var rows = '', dayK = 0, dayP = 0;
      SPLITS.forEach(function(s, mi){
        var opts = PICKS[s[0]];
        var items = opts[(d + mi) % opts.length];
        var k=0, p=0;
        items.forEach(function(nm){
          var f = foodBy(nm); if(f){ k+=f.k; p+=f.p; }
          grocery[nm] = (grocery[nm]||0)+1;
        });
        dayK+=k; dayP+=p;
        rows += '<tr><td>'+s[1]+' '+s[0]+'</td><td>'+items.map(function(x){return x.replace(/ \(.*?\)/,'');}).join(', ')+'</td><td style="text-align:right">'+k+' kcal · '+p+'g P</td></tr>';
      });
      days += '<h3>Day '+(d+1)+' <span style="color:#16a34a;font-size:14px">'+dayK+' kcal · '+dayP+'g protein</span></h3><table>'+rows+'</table>';
    }
    var g = Object.keys(grocery).sort().map(function(n){ return '<li>'+n+' <b>×'+grocery[n]+'</b></li>'; }).join('');
    var w = window.open('','_blank');
    w.document.write('<!DOCTYPE html><html><head><title>Diet AI Premium — 7-Day Plan</title><style>'+
      'body{font-family:Segoe UI,Arial,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#0f172a;line-height:1.5}'+
      'h1{color:#15803d}table{width:100%;border-collapse:collapse;margin:8px 0 18px}td{border-bottom:1px solid #e2e8f0;padding:8px 6px;font-size:14px}'+
      'h3{margin:18px 0 4px}ul{columns:2;font-size:14px}.no-print{background:#16a34a;color:#fff;border:none;padding:12px 22px;border-radius:10px;font-weight:700;cursor:pointer}'+
      '@media print{.no-print{display:none}}</style></head><body>'+
      '<h1>🥗 Diet AI — Premium 7-Day Plan</h1>'+
      '<p>Daily target: <b>'+target.toLocaleString()+' kcal</b> · Protein goal: <b>'+protein+'g/day</b></p>'+
      '<button class="no-print" onclick="print()">🖨️ Print / Save as PDF</button>'+
      days+'<h2>🛒 Weekly grocery list (servings)</h2><ul>'+g+'</ul>'+
      '<p style="color:#64748b;font-size:12px">General nutrition estimates, not medical advice. © dietai.in</p>'+
      '</body></html>');
    w.document.close();
  }

  document.addEventListener('DOMContentLoaded', injectCard);
  injectCard();
})();
