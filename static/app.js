const $ = id => document.getElementById(id);
const PARAM_IDS = ["showRegression","regShort","regMedium","regLong","showBollinger","bollingerWindow","bollingerStd","showKalman","kalmanQ","kalmanR"];
const RANGE_OPTIONS = [["1T","1d"],["5T","5d"],["1M","1m"],["2M","2m"],["MAX","max"]];
const ANALYTICS_RANGE_OPTIONS = [["1J","1y"],["2J","2y"],["5J","5y"],["MAX","max"]];
let payload, activeTab="tools", toolRange="1m", analyticsRange="max", selectedTrade=null;
const saved = JSON.parse(localStorage.getItem("msci-world-defaults") || "{}");
for (const id of PARAM_IDS) if (saved[id] !== undefined) $(id)[$(id).type === "checkbox" ? "checked" : "value"] = saved[id];

function instrumentKey(){ return $("instrument").value; }
function currentInstrument(){ return payload.instruments[instrumentKey()]; }
function pointDates(points){ return points.map(p => new Date(p[0])); }
function pointPrices(points){ return points.map(p => +p[1]); }
function dateKey(value){ return new Date(value).toISOString().slice(0,10); }
function fmtDate(value){ return new Date(value).toLocaleDateString("de-DE"); }
function fmt(value,digits=2){ return Number.isFinite(value) ? value.toLocaleString("de-DE",{minimumFractionDigits:digits,maximumFractionDigits:digits}) : "–"; }
function pct(value){ return Number.isFinite(value) ? `${fmt(value,2)} %` : "–"; }
function filterRange(points, range){
  if (!points.length || range === "max") return points;
  const days = {"1d":1,"5d":5,"1m":31,"2m":62,"1y":365,"2y":730,"5y":1825}[range] || 62;
  const cutoff = points.at(-1)[0] - days * 86400000;
  return points.filter(p => p[0] >= cutoff);
}
function regression(y, window){
  const start=Math.max(0,y.length-window), n=y.length-start;
  if(n<2) return Array(y.length).fill(null);
  let sx=0,sy=0,sxy=0,sxx=0;
  for(let i=0;i<n;i++){sx+=i;sy+=y[start+i];sxy+=i*y[start+i];sxx+=i*i;}
  const slope=(n*sxy-sx*sy)/(n*sxx-sx*sx), intercept=(sy-slope*sx)/n;
  return Array(start).fill(null).concat(Array.from({length:n},(_,i)=>intercept+slope*i));
}
function rolling(y, window, multiple){
  const mid=[],upper=[],lower=[];
  for(let i=0;i<y.length;i++){
    if(i<window-1){mid.push(null);upper.push(null);lower.push(null);continue;}
    const a=y.slice(i-window+1,i+1), mean=a.reduce((s,v)=>s+v,0)/window;
    const sd=Math.sqrt(a.reduce((s,v)=>s+(v-mean)**2,0)/window);
    mid.push(mean);upper.push(mean+multiple*sd);lower.push(mean-multiple*sd);
  }
  return {mid,upper,lower};
}
function kalman2d(y,q,r){
  if(!y.length) return [];
  let price=y[0], velocity=0, p00=r, p01=0, p10=0, p11=q;
  const out=[price];
  for(let i=1;i<y.length;i++){
    price += velocity; p00=p00+p01+p10+p11+q/4; p01=p01+p11+q/2; p10=p10+p11+q/2; p11+=q;
    const innovation=y[i]-price, s=p00+r, k0=p00/s, k1=p10/s;
    price+=k0*innovation; velocity+=k1*innovation;
    p00=(1-k0)*p00; p01=(1-k0)*p01; p10=p10-k1*p00; p11=p11-k1*p01;
    out.push(price);
  }
  return out;
}
function axisBase(){ return {rangebreaks:[{bounds:["sat","mon"]}],gridcolor:"#f1f5f9",zerolinecolor:"#cbd5e1"}; }
function baseLayout(){ return {paper_bgcolor:"#fff",plot_bgcolor:"#fff",font:{family:"Arial",color:"#0f172a"},margin:{l:52,r:24,t:45,b:42},hovermode:"x unified",legend:{orientation:"h",y:1.05,font:{size:10}}}; }
function lineTrace(x,y,name,color,dash="solid",axis=1){ return {x,y,type:"scatter",mode:"lines",name,line:{color,width:2,dash},xaxis:axis===1?"x":`x${axis}`,yaxis:axis===1?"y":`y${axis}`,connectgaps:false}; }

function renderTools(){
  const points=filterRange(currentInstrument().daily,toolRange), x=pointDates(points), y=pointPrices(points);
  const traces=[lineTrace(x,y,"Adj Close","#0f172a")], panels=[];
  if($("showBollinger").checked){
    const bands=rolling(y,Math.max(2,+$("bollingerWindow").value||20),Math.max(.1,+$("bollingerStd").value||2));
    traces.push({...lineTrace(x,bands.upper,"Bollinger Upper","#60a5fa","dot"),fill:null});
    traces.push({...lineTrace(x,bands.lower,"Bollinger Lower","#60a5fa","dot"),fill:"tonexty",fillcolor:"rgba(59,130,246,.08)"});
    traces.push(lineTrace(x,bands.mid,"Bollinger Mitte","#2563eb"));
    panels.push({label:"Bollinger-Abstand",series:[y.map((v,i)=>bands.upper[i]==null?null:v-bands.upper[i]),y.map((v,i)=>bands.lower[i]==null?null:v-bands.lower[i])]});
  }
  if($("showRegression").checked){
    for(const [id,label] of [["regShort","Kurz"],["regMedium","Mittel"],["regLong","Lang"]]){
      const n=Math.max(2,+$(id).value||2), reg=regression(y,n);
      traces.push(lineTrace(x,reg,`Regression ${label} (${n}T)`,"#7c3aed","dash"));
      panels.push({label:`Regression ${label}`,series:[y.map((v,i)=>reg[i]==null?null:v-reg[i])]});
    }
  }
  if($("showKalman").checked){
    const k=kalman2d(y,Math.max(.001,+$("kalmanQ").value||1),Math.max(.001,+$("kalmanR").value||25));
    traces.push(lineTrace(x,k,"Kalman-Filter 2D","#db2777"));
    panels.push({label:"Kalman-Steigung zum Vortag",bar:k.map((v,i)=>i?v-k[i-1]:null)});
  }
  const rows=1+panels.length, gap=.012, small=.12, main=Math.max(.38,1-panels.length*small-panels.length*gap);
  const layout={...baseLayout(),height:Math.max(560,420+panels.length*105),showlegend:true,xaxis:{...axisBase(),anchor:"y",showticklabels:false},yaxis:{domain:[1-main,1],gridcolor:"#f1f5f9"},bargap:.06,annotations:[]};
  panels.forEach((panel,index)=>{
    const axis=index+2, top=1-main-gap-index*(small+gap), bottom=Math.max(0,top-small);
    layout[`xaxis${axis}`]={...axisBase(),anchor:`y${axis}`,matches:"x",showticklabels:index===panels.length-1};
    layout[`yaxis${axis}`]={domain:[bottom,top],gridcolor:"#f8fafc",zeroline:true,zerolinecolor:"#94a3b8"};
    layout.annotations.push({xref:"paper",yref:"paper",x:.005,y:top,text:panel.label,showarrow:false,xanchor:"left",yanchor:"top",font:{size:10,color:"#64748b"}});
    if(panel.bar){ traces.push({x,y:panel.bar,type:"bar",name:panel.label,showlegend:false,marker:{color:panel.bar.map(v=>v>=0?"#16a34a":"#dc2626")},xaxis:`x${axis}`,yaxis:`y${axis}`,hovertemplate:"%{y:.4f}<extra></extra>"}); }
    else panel.series.forEach((series,i)=>traces.push({...lineTrace(x,series,panel.label,i?"#60a5fa":"#2563eb","solid",axis),showlegend:false,fill:"tozeroy",fillcolor:i?"rgba(96,165,250,.08)":"rgba(37,99,235,.08)"}));
  });
  Plotly.react("toolsChart",traces,layout,{responsive:true,displaylogo:false,scrollZoom:true});
}

function tradeStoreKey(){ return `msci-world-trades-${instrumentKey()}`; }
function loadTrades(){ return JSON.parse(localStorage.getItem(tradeStoreKey()) || "[]"); }
function saveTrades(trades){ localStorage.setItem(tradeStoreKey(),JSON.stringify(trades)); }
function nearestPrice(date){ const target=new Date(date).getTime(), points=currentInstrument().intraday; return points.reduce((best,p)=>Math.abs(p[0]-target)<Math.abs(best[0]-target)?p:best,points[0]); }
function tradeMetrics(t){ if(!t.exitDate||!Number.isFinite(t.exitPrice)) return {...t,netReturn:null,pnl:null}; const gross=t.exitPrice-t.entryPrice, pnl=gross-t.fees, netReturn=t.entryPrice?pnl/t.entryPrice*100:null; return {...t,pnl,netReturn}; }
function renderTradeTable(){
  const trades=loadTrades().map(tradeMetrics), body=$("tradeRows"); body.innerHTML="";
  for(const t of trades){ const row=document.createElement("tr"); if(t.id===selectedTrade)row.className="selected"; row.innerHTML=`<td>${t.id}</td><td>${fmtDate(t.entryDate)}</td><td>${t.exitDate?fmtDate(t.exitDate):"–"}</td><td>${fmt(t.entryPrice,4)}</td><td>${fmt(t.exitPrice,4)}</td><td>${fmt(t.fees)}</td><td>${pct(t.netReturn)}</td>`; row.onclick=()=>{selectedTrade=t.id;renderTradeTable();}; body.appendChild(row); }
  $("deleteTrade").disabled=!selectedTrade; return trades;
}
function performanceStats(series,x){
  if(series.length<2)return {total:NaN,annual:NaN,vol:NaN,sharpe:NaN,drawdown:NaN,returns:[]};
  const returns=series.slice(1).map((v,i)=>v/series[i]-1), elapsed=Math.max(1,(x.at(-1)-x[0])/86400000), years=elapsed/365.25;
  const total=series.at(-1)/series[0]-1, annual=(1+total)**(1/years)-1, mean=returns.reduce((a,b)=>a+b,0)/returns.length;
  const variance=returns.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,returns.length-1), periodsPerYear=returns.length/years, vol=Math.sqrt(variance*periodsPerYear);
  let peak=series[0],drawdown=0;for(const value of series){peak=Math.max(peak,value);drawdown=Math.min(drawdown,value/peak-1);}
  return {total,annual,vol,sharpe:vol?annual/vol:NaN,drawdown,returns};
}
function renderMetrics(strategy,buy,x){
  const mine=performanceStats(strategy,x), benchmark=performanceStats(buy,x), active=mine.returns.map((v,i)=>v-benchmark.returns[i]);
  const activeMean=active.reduce((a,b)=>a+b,0)/Math.max(1,active.length), activeVar=active.reduce((a,b)=>a+(b-activeMean)**2,0)/Math.max(1,active.length-1), years=Math.max(1/365.25,(x.at(-1)-x[0])/31557600000), tracking=Math.sqrt(activeVar*(active.length/years)), information=tracking?(mine.annual-benchmark.annual)/tracking:NaN;
  const rows=[["Gesamtrendite",mine.total,benchmark.total,"pct"],["Annualisierte Rendite",mine.annual,benchmark.annual,"pct"],["Volatilität",mine.vol,benchmark.vol,"pct"],["Sharpe Ratio",mine.sharpe,benchmark.sharpe,"num"],["Max. Drawdown",mine.drawdown,benchmark.drawdown,"pct"],["Information Ratio",information,0,"num"]];
  const value=(v,type)=>type==="pct"?pct(v*100):fmt(v,2), difference=(a,b,type)=>type==="pct"?pct((a-b)*100):fmt(a-b,2);
  $("metrics").innerHTML=`<div class="evaluation-table"><div class="evaluation-row evaluation-header-row"><div>Kennzahl</div><div>Meine Strategie</div><div>Buy & Hold</div><div>Differenz</div></div>${rows.map(([label,a,b,type])=>`<div class="evaluation-row"><div>${label}</div><div>${value(a,type)}</div><div>${value(b,type)}</div><div class="${a-b>=0?"positive":"negative"}">${difference(a,b,type)}</div></div>`).join("")}</div>`;
}
function renderAnalytics(){
  const points=filterRange(currentInstrument().intraday,analyticsRange), x=pointDates(points), y=pointPrices(points); if(!points.length)return;
  const returns=y.map((v,i)=>i?v/y[i-1]-1:0), buy=[],strategy=[],trades=renderTradeTable(); let b=100,s=100;
  for(let i=0;i<points.length;i++){ b*=1+returns[i]; const active=trades.some(t=>points[i][0]>=new Date(t.entryDate).getTime()&&(!t.exitDate||points[i][0]<new Date(t.exitDate).getTime())); if(i&&active)s*=1+returns[i]; buy.push(b);strategy.push(s); }
  const traces=[lineTrace(x,buy,"Buy & Hold","#0f172a"),lineTrace(x,strategy,"Meine Strategie","#7c3aed")];
  for(const t of trades){ traces.push({x:[new Date(t.entryDate)],y:[buy[Math.max(0,points.findIndex(p=>p[0]>=new Date(t.entryDate).getTime()))]],type:"scatter",mode:"markers",name:`Entry ${t.id}`,showlegend:false,marker:{symbol:"triangle-up",size:12,color:"#16a34a"}}); if(t.exitDate)traces.push({x:[new Date(t.exitDate)],y:[buy[Math.max(0,points.findIndex(p=>p[0]>=new Date(t.exitDate).getTime()))]],type:"scatter",mode:"markers",name:`Exit ${t.id}`,showlegend:false,marker:{symbol:"triangle-down",size:12,color:"#dc2626"}}); }
  renderMetrics(strategy,buy,x);
  Plotly.react("analyticsChart",traces,{...baseLayout(),xaxis:axisBase(),yaxis:{title:"Index 100",gridcolor:"#f1f5f9"}},{responsive:true,displaylogo:false,scrollZoom:true});
}
function renderAll(){ if(!payload)return; const inst=currentInstrument(); $("instrumentMeta").textContent=`${inst.name} · ISIN ${inst.isin} · Yahoo ${inst.ticker}`; renderTools(); renderAnalytics(); history.replaceState(null,"",`?instrument=${encodeURIComponent(instrumentKey())}`); }
function ranges(containerId,options,get,set){ const root=$(containerId); root.innerHTML=""; for(const [label,value] of options){ const b=document.createElement("button"); b.className=`range-button ${get()===value?"active":""}`; b.textContent=label;b.onclick=()=>{set(value);ranges(containerId,options,get,set);renderAll();};root.appendChild(b); } }
function configureRanges(){ ranges("toolRanges",RANGE_OPTIONS,()=>toolRange,v=>toolRange=v); ranges("analyticsRanges",ANALYTICS_RANGE_OPTIONS,()=>analyticsRange,v=>analyticsRange=v); }
async function fetchData(){ $("reload").disabled=true; try{ const response=await fetch(`data/dashboard.json?v=${Date.now()}`);if(!response.ok)throw Error(response.status);payload=await response.json();localStorage.setItem("msci-world-last-data",JSON.stringify(payload));$("notice").style.display="none";initializeInstrument();$("updated").textContent=`Stand ${new Date(payload.updated_at).toLocaleString("de-DE")} · automatische Aktualisierung stündlich`;renderAll();}catch(error){const cached=localStorage.getItem("msci-world-last-data");if(cached){payload=JSON.parse(cached);initializeInstrument();$("notice").textContent="Offline: letzter gespeicherter Datenstand wird angezeigt.";$("notice").style.display="block";renderAll();}else{$("notice").textContent=`Daten konnten nicht geladen werden (${error.message}).`;$('notice').style.display="block";}}finally{$("reload").disabled=false;}}
function initializeInstrument(){ const old=instrumentKey(), requested=new URLSearchParams(location.search).get("instrument"), select=$("instrument");select.innerHTML="";for(const[key,inst]of Object.entries(payload.instruments)){const option=document.createElement("option");option.value=key;option.textContent=inst.name;select.appendChild(option);}select.value=payload.instruments[old]?old:payload.instruments[requested]?requested:Object.keys(payload.instruments)[0]; }

$("instrument").onchange=()=>{selectedTrade=null;renderAll();}; $("reload").onclick=()=>{if(confirm("Kursdaten jetzt neu laden?"))fetchData();};
for(const id of PARAM_IDS) $(id).addEventListener("input",renderTools);
$("saveDefaults").onclick=()=>{ const values={};for(const id of PARAM_IDS)values[id]=$(id).type==="checkbox"?$(id).checked:$(id).value;localStorage.setItem("msci-world-defaults",JSON.stringify(values));$("settingsMessage").textContent="Standardparameter wurden im Browser gespeichert.";};
document.querySelectorAll(".tab").forEach(button=>button.onclick=()=>{activeTab=button.dataset.tab;document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b===button));$("toolsTab").classList.toggle("hidden",activeTab!=="tools");$("analyticsTab").classList.toggle("hidden",activeTab!=="analytics");setTimeout(()=>Plotly.Plots.resize(activeTab==="tools"?"toolsChart":"analyticsChart"),0);});
$("addTrade").onclick=()=>{$("entryDate").value=new Date().toISOString().slice(0,10);$("tradeDialog").showModal();}; $("cancelTrade").onclick=()=>$("tradeDialog").close();
$("tradeForm").onsubmit=event=>{event.preventDefault();const entry=nearestPrice($("entryDate").value),exit=$("exitDate").value?nearestPrice($("exitDate").value):null,trades=loadTrades(),id=Math.max(0,...trades.map(t=>t.id))+1;trades.push({id,entryDate:$("entryDate").value,exitDate:$("exitDate").value||null,entryPrice:$("entryPrice").value?+$("entryPrice").value:entry[1],exitPrice:$("exitPrice").value?+$("exitPrice").value:exit?exit[1]:null,fees:+$("fees").value||0,notes:$("notes").value});saveTrades(trades);$("tradeDialog").close();$("tradeForm").reset();$("tradeMessage").textContent=`Trade ${id} gespeichert.`;renderAnalytics();};
$("deleteTrade").onclick=()=>{if(!selectedTrade)return;if(confirm(`Trade ${selectedTrade} wirklich löschen?`)){saveTrades(loadTrades().filter(t=>t.id!==selectedTrade));selectedTrade=null;renderAnalytics();}};
configureRanges(); fetchData();
