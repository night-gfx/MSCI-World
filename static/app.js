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
function regression(points, windowDays){
  const y=pointPrices(points), cutoff=points.at(-1)[0]-windowDays*86400000, start=Math.max(0,points.findIndex(p=>p[0]>=cutoff)), n=y.length-start;
  if(n<2) return Array(y.length).fill(null);
  let sx=0,sy=0,sxy=0,sxx=0;
  const origin=points[start][0];
  for(let i=0;i<n;i++){const xi=(points[start+i][0]-origin)/86400000;sx+=xi;sy+=y[start+i];sxy+=xi*y[start+i];sxx+=xi*xi;}
  const slope=(n*sxy-sx*sy)/(n*sxx-sx*sx), intercept=(sy-slope*sx)/n;
  return Array(start).fill(null).concat(Array.from({length:n},(_,i)=>intercept+slope*(points[start+i][0]-origin)/86400000));
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
function kalman2d(points,q,r){
  const y=pointPrices(points);
  if(!y.length) return [];
  let price=y[0], velocity=0, p00=r, p01=0, p10=0, p11=q;
  const out=[price];
  for(let i=1;i<y.length;i++){
    const dt=Math.max((points[i][0]-points[i-1][0])/86400000,1/1440),a00=p00,a01=p01,a10=p10,a11=p11;
    price += velocity*dt;
    p00=a00+dt*a10+dt*a01+dt*dt*a11+q*dt**4/4;p01=a01+dt*a11+q*dt**3/2;p10=a10+dt*a11+q*dt**3/2;p11=a11+q*dt**2;
    const innovation=y[i]-price, s=p00+r, k0=p00/s, k1=p10/s;
    price+=k0*innovation; velocity+=k1*innovation;
    const c00=1-k0,c10=-k1,b00=c00*p00,b01=c00*p01,b10=c10*p00+p10,b11=c10*p01+p11;
    p00=b00*c00+k0*k0*r;p01=b00*c10+b01+k0*k1*r;p10=b10*c00+k1*k0*r;p11=b10*c10+b11+k1*k1*r;
    out.push(price);
  }
  return out;
}
function tradingBreaks(points){
  if(!points.length)return [{bounds:["sat","mon"]}];const present=new Set(points.map(p=>dateKey(p[0]))),missing=[],cursor=new Date(points[0][0]),end=new Date(points.at(-1)[0]);cursor.setHours(0,0,0,0);
  while(cursor<=end){const day=cursor.getDay();if(day!==0&&day!==6&&!present.has(dateKey(cursor)))missing.push(dateKey(cursor));cursor.setDate(cursor.getDate()+1);}
  const breaks=[{bounds:["sat","mon"]}];if(missing.length)breaks.push({values:missing,dvalue:86400000});return breaks;
}
function paddedRange(values,includeZero=false){const finite=values.flat().filter(Number.isFinite);if(!finite.length)return undefined;let lo=Math.min(...finite),hi=Math.max(...finite);if(includeZero){lo=Math.min(lo,0);hi=Math.max(hi,0);}const span=hi-lo||Math.max(Math.abs(hi),1),pad=span*.06;return [lo-pad,hi+pad];}
function axisBase(points=[]){ return {rangebreaks:tradingBreaks(points),showgrid:false,showline:false,ticks:"",tickfont:{size:10,color:"#64748b"},automargin:true}; }
function baseLayout(){ return {paper_bgcolor:"#fff",plot_bgcolor:"#fff",font:{family:"Arial, sans-serif",color:"#0f172a"},hovermode:"x unified",hoverdistance:-1,hoverlabel:{bgcolor:"#0f172a",bordercolor:"#0f172a",font:{color:"#fff",size:12}}}; }
function lineTrace(x,y,name,color,dash="solid",axis=1,width=2){ return {x,y,type:"scatter",mode:"lines",name,line:{color,width,dash},xaxis:axis===1?"x":`x${axis}`,yaxis:axis===1?"y":`y${axis}`,connectgaps:false}; }
function splitSigned(x,y,axis,name){
  const positive=y.map(v=>v>=0?v:null),negative=y.map(v=>v<0?v:null);
  return [
    {...lineTrace(x,positive,`${name} positiv`,"#16a34a","solid",axis,1.9),showlegend:false,hoverinfo:"none",fill:"tozeroy",fillcolor:"rgba(22,163,74,.11)"},
    {...lineTrace(x,negative,`${name} negativ`,"#dc2626","solid",axis,1.9),showlegend:false,hoverinfo:"none",fill:"tozeroy",fillcolor:"rgba(220,38,38,.10)"}
  ];
}
function splitTrend(x,y,name){
  const rising=y.map((v,i)=>i&&v>=y[i-1]?v:null),falling=y.map((v,i)=>i&&v<y[i-1]?v:null);
  return [
    {...lineTrace(x,rising,`${name} steigend`,"#16a34a","solid",1,2),showlegend:false,hoverinfo:"skip"},
    {...lineTrace(x,falling,`${name} fallend`,"#dc2626","solid",1,2),showlegend:false,hoverinfo:"skip"}
  ];
}
function installCrossPanelHover(graphId){
  const graph=$(graphId)?.querySelector(".js-plotly-plot"); if(!graph||!graph._fullLayout||typeof graph.on!=="function")return;
  if(graph.__msciHoverHandler&&typeof graph.removeListener==="function"){graph.removeListener("plotly_hover",graph.__msciHoverHandler);graph.removeListener("plotly_unhover",graph.__msciUnhoverHandler);}
  let line=graph.querySelector(".cross-panel-hover-line");if(!line){line=document.createElement("div");line.className="cross-panel-hover-line";graph.appendChild(line);}
  graph.__msciHoverHandler=event=>{const point=event?.points?.[0],size=graph._fullLayout?._size;if(!point?.xaxis||!size){line.style.display="none";return;}line.style.left=`${point.xaxis.d2p(point.x)+point.xaxis._offset}px`;line.style.top=`${size.t}px`;line.style.height=`${size.h}px`;line.style.display="block";};
  graph.__msciUnhoverHandler=()=>{line.style.display="none";};graph.on("plotly_hover",graph.__msciHoverHandler);graph.on("plotly_unhover",graph.__msciUnhoverHandler);
}
const PLOT_CONFIG={responsive:true,displaylogo:false,scrollZoom:true,modeBarButtonsToAdd:["drawline","drawopenpath","eraseshape","resetScale2d"]};
function toolsPoints(){const inst=currentInstrument(),points=[...inst.daily];if(inst.last_price&&Number.isFinite(+inst.last_price[1])){points.push([+inst.last_price[0],+inst.last_price[1]]);}const unique=new Map(points.map(p=>[+p[0],[+p[0],+p[1]]]));return [...unique.values()].sort((a,b)=>a[0]-b[0]);}

function renderTools(){
  const fullPoints=toolsPoints(),fullY=pointPrices(fullPoints),points=filterRange(fullPoints,toolRange),startIndex=fullPoints.findIndex(p=>p[0]===points[0][0]),x=pointDates(points),y=pointPrices(points);
  const traces=[{...lineTrace(x,y,currentInstrument().name,"#0f172a","solid",1,2.5),hovertemplate:`${currentInstrument().name}: %{y:.4f}<extra></extra>`}], panels=[];
  if($("showBollinger").checked){
    const fullBands=rolling(fullY,Math.max(2,+$("bollingerWindow").value||20),Math.max(.1,+$("bollingerStd").value||2)),bands={mid:fullBands.mid.slice(startIndex),upper:fullBands.upper.slice(startIndex),lower:fullBands.lower.slice(startIndex)};
    traces.push({...lineTrace(x,bands.upper,"Bollinger Upper","#60a5fa","dot",1,1.2),hoverinfo:"skip"});
    traces.push({...lineTrace(x,bands.lower,"Bollinger Lower","#60a5fa","dot",1,1.2),hoverinfo:"skip",fill:"tonexty",fillcolor:"rgba(59,130,246,.08)"});
    traces.push({...lineTrace(x,bands.mid,"Bollinger Mittelwert","#2563eb","solid",1,1.4),hoverinfo:"skip"});
    panels.push({label:"Bollinger Bands",color:"#2563eb",series:[y.map((v,i)=>bands.upper[i]==null?null:v-bands.upper[i]),y.map((v,i)=>bands.lower[i]==null?null:v-bands.lower[i])]});
  }
  if($("showRegression").checked){
    for(const [id,label] of [["regShort","Kurz"],["regMedium","Mittel"],["regLong","Lang"]]){
      const n=Math.max(2,+$(id).value||2), reg=regression(fullPoints,n).slice(startIndex);
      const period={182:"6 Monate",365:"1 Jahr",730:"2 Jahre",1825:"5 Jahre"}[n]||`${n} Tage`;
      traces.push({...lineTrace(x,reg,`Regression ${period}`,"#7c3aed","dash",1,2.1),hoverinfo:"skip"});
      panels.push({label:`Regression ${period}`,color:"#7c3aed",series:[y.map((v,i)=>reg[i]==null?null:v-reg[i])]});
      const last=reg.findLastIndex(Number.isFinite);if(last>=0)panels.at(-1).endpoint={x:x[last],y:reg[last],text:period};
    }
  }
  if($("showKalman").checked){
    const fullK=kalman2d(fullPoints,Math.max(.001,+$("kalmanQ").value||1),Math.max(.001,+$("kalmanR").value||25)),k=fullK.slice(startIndex);
    traces.push(...splitTrend(x,k,"Kalman 2D"));
    const bar=Array(k.length).fill(null),lastByDay=new Map();x.forEach((d,i)=>lastByDay.set(dateKey(d),i));const dailyIndexes=[...lastByDay.values()];dailyIndexes.forEach((idx,i)=>{if(i)bar[idx]=k[idx]-k[dailyIndexes[i-1]];});
    panels.push({label:"Kalman-Steigung zum Vortag",color:"#db2777",bar});
  }
  if(instrumentKey()===Object.keys(payload.instruments)[0])for(const t of loadTrades()){const entryIndex=points.findIndex(p=>p[0]>=new Date(t.entryDate).getTime());if(entryIndex>=0)traces.push({x:[x[entryIndex]],y:[t.entryPrice],type:"scatter",mode:"markers",name:"Kauf",showlegend:false,hoverinfo:"skip",marker:{symbol:"triangle-up",size:11,color:"#16a34a",line:{width:1.2,color:"#fff"}}});if(t.exitDate){const exitIndex=points.findIndex(p=>p[0]>=new Date(t.exitDate).getTime());if(exitIndex>=0)traces.push({x:[x[exitIndex]],y:[t.exitPrice],type:"scatter",mode:"markers",name:"Verkauf",showlegend:false,hoverinfo:"skip",marker:{symbol:"triangle-down",size:11,color:"#dc2626",line:{width:1.2,color:"#fff"}}});}}
  const rows=1+panels.length,total=420+panels.length*105,main=420/total,small=105/total;
  const layout={...baseLayout(),height:total+114,showlegend:false,hoversubplots:"axis",uirevision:`tools-${instrumentKey()}-${toolRange}`,margin:{l:48,r:88,t:72,b:42},xaxis:{...axisBase(fullPoints),anchor:"y",showticklabels:false,hoverformat:"%d.%m.%Y %H:%M"},yaxis:{domain:[1-main,1],range:paddedRange(traces.filter(t=>!t.yaxis||t.yaxis==="y").map(t=>t.y||[])),showgrid:false,showline:false,zeroline:false,tickformat:".3f",tickfont:{size:10,color:"#64748b"},automargin:true},bargap:.06,annotations:[],shapes:[]};
  for(const panel of panels)if(panel.endpoint)layout.annotations.push({x:panel.endpoint.x,y:panel.endpoint.y,xref:"x",yref:"y",text:panel.endpoint.text,showarrow:false,xanchor:"left",yanchor:"middle",xshift:7,font:{family:"Arial, sans-serif",size:10,color:panel.color},bgcolor:"rgba(255,255,255,.88)",borderpad:2});
  panels.forEach((panel,index)=>{
    const axis=index+2, top=1-main-index*small, bottom=Math.max(0,top-small);
    layout[`xaxis${axis}`]={...axisBase(fullPoints),anchor:`y${axis}`,matches:"x",showticklabels:index===panels.length-1,hoverformat:"%d.%m.%Y %H:%M"};
    layout[`yaxis${axis}`]={domain:[bottom,top],range:paddedRange(panel.bar?[panel.bar]:panel.series,true),showgrid:false,showline:false,zeroline:false,showticklabels:false,ticks:""};
    layout.shapes.push({type:"line",xref:"paper",x0:0,x1:1,yref:`y${axis}`,y0:0,y1:0,line:{color:"#111827",width:.55},layer:"above"});
    layout.annotations.push({xref:"paper",yref:`y${axis}`,x:.006,y:0,text:panel.label,showarrow:false,xanchor:"left",yanchor:"bottom",yshift:3,font:{family:"Arial, sans-serif",size:10,color:panel.color},opacity:.52});
    if(panel.bar){ traces.push({x,y:panel.bar,type:"bar",name:panel.label,showlegend:false,marker:{color:panel.bar.map(v=>v>=0?"#16a34a":"#dc2626")},xaxis:`x${axis}`,yaxis:`y${axis}`,hovertemplate:"%{y:.4f}<extra></extra>"}); }
    else panel.series.forEach((series,i)=>traces.push(...splitSigned(x,series,axis,panel.series.length>1?(i?"Kurs - Lower Band":"Kurs - Upper Band"):panel.label)));
  });
  Plotly.react("toolsChart",traces,layout,PLOT_CONFIG).then(()=>installCrossPanelHover("toolsChart"));
}

function tradeStoreKey(){ return `msci-world-trades-${instrumentKey()}`; }
function loadTrades(){ return JSON.parse(localStorage.getItem(tradeStoreKey()) || "[]"); }
function saveTrades(trades){ localStorage.setItem(tradeStoreKey(),JSON.stringify(trades)); }
function nearestPrice(date){ const target=new Date(date).getTime(), points=currentInstrument().intraday; return points.reduce((best,p)=>Math.abs(p[0]-target)<Math.abs(best[0]-target)?p:best,points[0]); }
function tradeMetrics(t){ if(!t.exitDate||!Number.isFinite(t.exitPrice)) return {...t,holdingDays:null,netReturn:null,pnl:null}; const gross=t.exitPrice-t.entryPrice,pnl=gross-t.fees,netReturn=t.entryPrice?pnl/t.entryPrice*100:null,holdingDays=Math.floor((new Date(t.exitDate)-new Date(t.entryDate))/86400000);return {...t,holdingDays,pnl,netReturn}; }
function renderTradeTable(){
  const trades=loadTrades().map(tradeMetrics), body=$("tradeRows"); body.innerHTML="";
  for(const t of trades){ const row=document.createElement("tr"); if(t.id===selectedTrade)row.className="selected"; row.innerHTML=`<td>${t.id}</td><td>${fmtDate(t.entryDate)}</td><td>${t.exitDate?fmtDate(t.exitDate):"–"}</td><td>${fmt(t.entryPrice,4)}</td><td>${fmt(t.exitPrice,4)}</td><td>${fmt(t.fees)}</td><td>${t.holdingDays??"–"}</td><td>${t.notes||""}</td>`; row.onclick=()=>{selectedTrade=t.id;renderTradeTable();}; body.appendChild(row); }
  $("deleteTrade").disabled=!selectedTrade; return trades;
}
function performanceStats(series,x){
  if(series.length<2)return {annual:NaN,vol:NaN,sharpe:NaN,drawdown:NaN,returns:[]};
  const returns=series.slice(1).map((v,i)=>v/series[i]-1).filter(Number.isFinite),elapsed=Math.max(1,(x.at(-1)-x[0])/86400000),years=elapsed/365.25,total=series.at(-1)/series[0]-1,annual=(1+total)**(1/years)-1,mean=returns.reduce((a,b)=>a+b,0)/returns.length;
  const variance=returns.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,returns.length-1),sd=Math.sqrt(variance),vol=returns.length>1?sd*Math.sqrt(252):NaN;
  let peak=series[0],drawdown=0;for(const value of series){peak=Math.max(peak,value);drawdown=Math.min(drawdown,value/peak-1);}
  return {annual,vol,sharpe:sd?mean/sd*Math.sqrt(252):NaN,drawdown,returns};
}
function renderMetrics(strategy,buy,x,hasTrades){
  if(!hasTrades){const empty=[["Rendite p.a.","–","–","–"],["Volatilität p.a.","–","–","–"],["Sharpe Ratio","–","–","–"],["Max. Drawdown","–","–","–"],["Information Ratio","–","–","–"]];$("metrics").innerHTML=evaluationMarkup(empty);return;}
  const mine=performanceStats(strategy,x), benchmark=performanceStats(buy,x), active=mine.returns.map((v,i)=>v-benchmark.returns[i]);
  const activeMean=active.reduce((a,b)=>a+b,0)/Math.max(1,active.length),activeVar=active.reduce((a,b)=>a+(b-activeMean)**2,0)/Math.max(1,active.length-1),activeSd=Math.sqrt(activeVar),information=active.length>1&&activeSd?activeMean/activeSd*Math.sqrt(252):NaN;
  const rows=[["Rendite p.a.",mine.annual,benchmark.annual,"pct"],["Volatilität p.a.",mine.vol,benchmark.vol,"pct"],["Sharpe Ratio",mine.sharpe,benchmark.sharpe,"num"],["Max. Drawdown",mine.drawdown,benchmark.drawdown,"pct"]];
  const value=(v,type)=>type==="pct"?pct(v*100):fmt(v,2), difference=(a,b,type)=>type==="pct"?pct((a-b)*100):fmt(a-b,2);
  $("metrics").innerHTML=evaluationMarkup([...rows.map(([label,a,b,type])=>[label,value(a,type),value(b,type),difference(a,b,type)]),["Information Ratio",fmt(information,2),"–","–"]]);
}
function evaluationMarkup(rows){return `<div class="evaluation-table"><div class="evaluation-row evaluation-header-row"><div>Kennzahl</div><div>Meine Strategie</div><div>Buy & Hold</div><div>Differenz</div></div>${rows.map(row=>`<div class="evaluation-row">${row.map(value=>`<div>${value}</div>`).join("")}</div>`).join("")}</div>`;}
function buildComparison(points,trades){if(!points.length)return [];const valid=trades.filter(t=>t.entryDate),start=valid.length?Math.min(...valid.map(t=>new Date(t.entryDate).getTime())):points[0][0],source=points.filter(p=>p[0]>=start),rows=[];let buy=100,strategy=100,previousInvested=false;source.forEach((p,i)=>{const marketReturn=i?p[1]/source[i-1][1]-1:0,invested=valid.some(t=>p[0]>=new Date(t.entryDate).getTime()&&(!t.exitDate||p[0]<new Date(t.exitDate).getTime()));buy*=1+marketReturn;if(previousInvested)strategy*=1+marketReturn;rows.push({timestamp:p[0],buy,strategy:valid.length?strategy:null,invested});previousInvested=invested;});return rows;}
function renderAnalytics(){
  const trades=renderTradeTable(),comparison=buildComparison(currentInstrument().intraday,trades),visiblePairs=filterRange(comparison.map(r=>[r.timestamp,r.buy]),analyticsRange),cutoff=visiblePairs[0]?.[0]??0,visible=comparison.filter(r=>r.timestamp>=cutoff),x=visible.map(r=>new Date(r.timestamp)),buy=visible.map(r=>r.buy),strategy=visible.map(r=>r.strategy),invested=visible.map(r=>r.invested);if(!visible.length)return;
  const traces=[{...lineTrace(x,buy,"Buy & Hold","#0f172a","solid",1,2.3),hovertemplate:"Buy & Hold: %{y:.2f}<extra></extra>"}];if(trades.length)traces.push({...lineTrace(x,strategy,"Meine Strategie","#7c3aed","solid",1,2.3),hovertemplate:"Meine Strategie: %{y:.2f}<extra></extra>"});
  for(const t of trades){const entryTime=new Date(t.entryDate).getTime(),entryIndex=visible.findIndex(p=>p.timestamp>=entryTime);if(entryIndex>=0)traces.push({x:[new Date(t.entryDate)],y:[buy[entryIndex]],type:"scatter",mode:"markers",name:`Einstieg ${t.id}`,showlegend:false,marker:{symbol:"triangle-up",size:12,color:"#16a34a",line:{width:1.3,color:"#fff"}},hovertemplate:`Einstieg · Trade ${t.id}<br>%{x|%d.%m.%Y}<extra></extra>`});if(t.exitDate){const exitTime=new Date(t.exitDate).getTime(),exitIndex=visible.findIndex(p=>p.timestamp>=exitTime);if(exitIndex>=0)traces.push({x:[new Date(t.exitDate)],y:[buy[exitIndex]],type:"scatter",mode:"markers",name:`Ausstieg ${t.id}`,showlegend:false,marker:{symbol:"triangle-down",size:12,color:"#dc2626",line:{width:1.3,color:"#fff"}},hovertemplate:`Ausstieg · Trade ${t.id}<br>%{x|%d.%m.%Y}<extra></extra>`});}}
  renderMetrics(comparison.map(r=>r.strategy).filter(Number.isFinite),comparison.map(r=>r.buy),comparison.map(r=>new Date(r.timestamp)),trades.length>0);
  const shapes=[];let start=null;for(let i=0;i<invested.length;i++){if(invested[i]&&start===null)start=x[i];if(!invested[i]&&start!==null){shapes.push({type:"rect",xref:"x",yref:"paper",x0:start,x1:x[i],y0:0,y1:1,fillcolor:"rgba(22,163,74,.055)",line:{width:0},layer:"below"});start=null;}}if(start!==null)shapes.push({type:"rect",xref:"x",yref:"paper",x0:start,x1:x.at(-1),y0:0,y1:1,fillcolor:"rgba(22,163,74,.055)",line:{width:0},layer:"below"});
  const layout={...baseLayout(),uirevision:`trading-analytics-${analyticsRange}`,showlegend:true,margin:{l:52,r:18,t:50,b:42},legend:{orientation:"h",x:0,y:1.08,xanchor:"left",yanchor:"bottom",font:{size:10},bgcolor:"rgba(255,255,255,0)"},xaxis:{...axisBase(currentInstrument().intraday),hoverformat:"%d.%m.%Y",rangeslider:{visible:false}},yaxis:{...axisBase(),range:paddedRange([buy,strategy]),zeroline:false,tickformat:".0f"},shapes};
  Plotly.react("analyticsChart",traces,layout,{responsive:true,displaylogo:false});
}
function renderAll(){ if(!payload)return; const inst=currentInstrument(); $("instrumentMeta").textContent=`${inst.name} · ISIN ${inst.isin} · Yahoo ${inst.ticker} · Trading Tools: Tagesdaten (MAX, Adj Close) · Trading Analytics: 5-Minuten-Daten`; renderTools(); renderAnalytics(); history.replaceState(null,"",`?instrument=${encodeURIComponent(instrumentKey())}`); }
function ranges(containerId,options,get,set){ const root=$(containerId); root.innerHTML=""; for(const [label,value] of options){ const b=document.createElement("button"); b.className=`range-button ${get()===value?"active":""}`; b.textContent=label;b.onclick=()=>{set(value);ranges(containerId,options,get,set);renderAll();};root.appendChild(b); } }
function configureRanges(){ ranges("toolRanges",RANGE_OPTIONS,()=>toolRange,v=>toolRange=v); ranges("analyticsRanges",ANALYTICS_RANGE_OPTIONS,()=>analyticsRange,v=>analyticsRange=v); }
async function fetchData(manual=false){ $("reload").disabled=true;try{const response=await fetch(`data/dashboard.json?v=${Date.now()}`,{cache:"no-store"});if(!response.ok)throw Error(response.status);payload=await response.json();localStorage.setItem("msci-world-last-data",JSON.stringify(payload));$("notice").style.display="none";initializeInstrument();$("updated").textContent=`Stand ${new Date(payload.updated_at).toLocaleString("de-DE")} · automatische Aktualisierung stündlich`;if(manual)$("settingsMessage").textContent="Der neueste auf GitHub Pages veröffentlichte Datenstand wurde geladen.";renderAll();}catch(error){const cached=localStorage.getItem("msci-world-last-data");if(cached){payload=JSON.parse(cached);initializeInstrument();$("notice").textContent="Offline: letzter gespeicherter Datenstand wird angezeigt.";$("notice").style.display="block";renderAll();}else{$("notice").textContent=`Daten konnten nicht geladen werden (${error.message}).`;$('notice').style.display="block";}}finally{$("reload").disabled=false;}}
function initializeInstrument(){ const old=instrumentKey(), requested=new URLSearchParams(location.search).get("instrument"), select=$("instrument");select.innerHTML="";for(const[key,inst]of Object.entries(payload.instruments)){const option=document.createElement("option");option.value=key;option.textContent=inst.name;select.appendChild(option);}select.value=payload.instruments[old]?old:payload.instruments[requested]?requested:Object.keys(payload.instruments)[0]; }

$("instrument").onchange=()=>{selectedTrade=null;renderAll();}; $("reload").onclick=()=>{if(confirm("Veröffentlichten Kursdatenstand jetzt neu laden?"))fetchData(true);};
for(const id of PARAM_IDS) $(id).addEventListener("input",renderTools);
$("saveDefaults").onclick=()=>{ const values={};for(const id of PARAM_IDS)values[id]=$(id).type==="checkbox"?$(id).checked:$(id).value;localStorage.setItem("msci-world-defaults",JSON.stringify(values));$("settingsMessage").textContent="Parameter wurden als Standardwerte für diesen Browser gespeichert.";};
document.querySelectorAll(".tab").forEach(button=>button.onclick=()=>{activeTab=button.dataset.tab;document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b===button));$("toolsTab").classList.toggle("hidden",activeTab!=="tools");$("analyticsTab").classList.toggle("hidden",activeTab!=="analytics");setTimeout(()=>Plotly.Plots.resize(activeTab==="tools"?"toolsChart":"analyticsChart"),0);});
$("addTrade").onclick=()=>{$("entryDate").value=new Date().toISOString().slice(0,10);$("modalTradeMessage").textContent="";$("tradeDialog").showModal();};$("cancelTrade").onclick=$("closeTrade").onclick=()=>$("tradeDialog").close();
$("tradeForm").onsubmit=event=>{event.preventDefault();const entry=nearestPrice($("entryDate").value),exit=$("exitDate").value?nearestPrice($("exitDate").value):null;if(exit&&exit[0]<entry[0]){$("modalTradeMessage").textContent="Das Exit-Datum darf nicht vor dem Entry-Datum liegen.";return;}const trades=loadTrades(),id=Math.max(0,...trades.map(t=>t.id))+1;trades.push({id,entryDate:new Date(entry[0]).toISOString(),exitDate:exit?new Date(exit[0]).toISOString():null,entryPrice:$("entryPrice").value?+$("entryPrice").value:entry[1],exitPrice:$("exitPrice").value?+$("exitPrice").value:exit?exit[1]:null,fees:+$("fees").value||0,notes:$("notes").value});saveTrades(trades);$("tradeDialog").close();$("tradeForm").reset();$("tradeMessage").textContent=`Trade ${id} gespeichert.`;renderTools();renderAnalytics();};
$("deleteTrade").onclick=()=>{if(!selectedTrade)return;if(confirm(`Trade ${selectedTrade} wirklich löschen?`)){saveTrades(loadTrades().filter(t=>t.id!==selectedTrade));selectedTrade=null;renderTools();renderAnalytics();}};
configureRanges();fetchData();
