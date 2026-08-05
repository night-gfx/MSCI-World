const $ = id => document.getElementById(id);
const PARAM_IDS = ["showRegression","regShort","regMedium","regLong","showBollinger","bollingerWindow","bollingerStd","showKalman","kalmanQ","kalmanR"];
const RANGE_OPTIONS = [["6 Monate","6m"],["1 Jahr","1y"],["2 Jahre","2y"],["5 Jahre","5y"],["Max","max"]];
const ANALYTICS_RANGE_OPTIONS = RANGE_OPTIONS;
let payload, activeTab="tools", toolRange="6m", analyticsRange="max", selectedTrade=null;
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
function rangeStart(timestamp,range){const date=new Date(timestamp);if(range==="6m")date.setUTCMonth(date.getUTCMonth()-6);else if(range==="1y")date.setUTCFullYear(date.getUTCFullYear()-1);else if(range==="2y")date.setUTCFullYear(date.getUTCFullYear()-2);else if(range==="5y")date.setUTCFullYear(date.getUTCFullYear()-5);else return -Infinity;return date.getTime();}
function filterRange(points, range){
  if (!points.length || range === "max") return points;
  const cutoff = rangeStart(points.at(-1)[0],range);
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
  if(!points.length)return [{bounds:["sat","mon"]}];const present=new Set(points.map(p=>dateKey(p[0]))),missing=[],cursor=new Date(`${dateKey(points[0][0])}T00:00:00Z`),end=new Date(`${dateKey(points.at(-1)[0])}T00:00:00Z`);
  while(cursor<=end){const day=cursor.getUTCDay();if(day!==0&&day!==6&&!present.has(dateKey(cursor)))missing.push(dateKey(cursor));cursor.setUTCDate(cursor.getUTCDate()+1);}
  const breaks=[{bounds:["sat","mon"]}];if(missing.length)breaks.push({values:missing,dvalue:86400000});return breaks;
}
function paddedRange(values,includeZero=false){const finite=values.flat().filter(Number.isFinite);if(!finite.length)return undefined;const lo=Math.min(...finite),hi=Math.max(...finite);if(includeZero){const limit=Math.max(Math.abs(lo),Math.abs(hi));return limit>0?[-limit*1.07,limit*1.07]:[-1,1];}const pad=hi===lo?Math.max(Math.abs(hi)*.05,1):(hi-lo)*.07;return [lo-pad,hi+pad];}
function axisBase(points=[]){ return {rangebreaks:tradingBreaks(points),showgrid:false,showline:false,ticks:"",tickfont:{size:10,color:"#64748b"},automargin:true}; }
function baseLayout(){ return {paper_bgcolor:"#fff",plot_bgcolor:"#fff",font:{family:"Arial, sans-serif",color:"#0f172a"},hovermode:"x unified",hoverdistance:-1,hoverlabel:{bgcolor:"#0f172a",bordercolor:"#0f172a",font:{color:"#fff",size:12}}}; }
function lineTrace(x,y,name,color,dash="solid",axis=1,width=2){ return {x,y,type:"scatter",mode:"lines",name,line:{color,width,dash,simplify:false},xaxis:axis===1?"x":`x${axis}`,yaxis:axis===1?"y":`y${axis}`,connectgaps:false}; }
function splitSigned(x,y,axis,name){
  const positiveX=[],positiveY=[],negativeX=[],negativeY=[];let previous=null,previousSign=null;
  const append=(xs,ys,xv,yv)=>{if(xs.at(-1)?.getTime?.()===xv?.getTime?.())ys[ys.length-1]=yv;else{xs.push(xv);ys.push(yv);}},close=(xs,ys)=>{if(xs.length&&xs.at(-1)!==null){xs.push(null);ys.push(null);}};
  for(let i=0;i<y.length;i++){const value=y[i];if(!Number.isFinite(value)){close(positiveX,positiveY);close(negativeX,negativeY);previous=null;previousSign=null;continue;}const sign=value>0?1:value<0?-1:(previousSign||1);if(!previous){const [xs,ys]=sign>0?[positiveX,positiveY]:[negativeX,negativeY];append(xs,ys,x[i],value);}else if(sign===previousSign){const [xs,ys]=sign>0?[positiveX,positiveY]:[negativeX,negativeY];append(xs,ys,x[i],value);}else{const fraction=Math.abs(previous.value)/(Math.abs(previous.value)+Math.abs(value)),crossing=new Date(previous.x.getTime()+(x[i].getTime()-previous.x.getTime())*fraction),[oldX,oldY]=previousSign>0?[positiveX,positiveY]:[negativeX,negativeY],[newX,newY]=sign>0?[positiveX,positiveY]:[negativeX,negativeY];append(oldX,oldY,crossing,0);close(oldX,oldY);append(newX,newY,crossing,0);append(newX,newY,x[i],value);}previous={x:x[i],value};previousSign=sign;}
  return [
    {...lineTrace(positiveX,positiveY,`${name} positiv`,"#16a34a","solid",axis,1.9),showlegend:false,hoverinfo:"none",fill:"tozeroy",fillcolor:"rgba(22,163,74,.11)"},
    {...lineTrace(negativeX,negativeY,`${name} negativ`,"#dc2626","solid",axis,1.9),showlegend:false,hoverinfo:"none",fill:"tozeroy",fillcolor:"rgba(220,38,38,.10)"}
  ];
}
function splitTrend(x,y,name){
  const risingX=[],risingY=[],fallingX=[],fallingY=[];let previousSign=null;for(let i=1;i<y.length;i++){if(!Number.isFinite(y[i-1])||!Number.isFinite(y[i])){previousSign=null;continue;}const sign=y[i]>y[i-1]?1:y[i]<y[i-1]?-1:(previousSign||1),[xs,ys]=sign>0?[risingX,risingY]:[fallingX,fallingY];if(sign!==previousSign){if(xs.length&&xs.at(-1)!==null){xs.push(null);ys.push(null);}xs.push(x[i-1]);ys.push(y[i-1]);}xs.push(x[i]);ys.push(y[i]);previousSign=sign;}
  return [
    {...lineTrace(risingX,risingY,`${name} steigend`,"#16a34a","solid",1,2),showlegend:false,hoverinfo:"skip"},
    {...lineTrace(fallingX,fallingY,`${name} fallend`,"#dc2626","solid",1,2),showlegend:false,hoverinfo:"skip"}
  ];
}
function installCrossPanelHover(graphId){
  const graph=$(graphId)?.querySelector(".js-plotly-plot"); if(!graph||!graph._fullLayout||typeof graph.on!=="function")return;
  if(graph.__msciHoverHandler&&typeof graph.removeListener==="function"){graph.removeListener("plotly_hover",graph.__msciHoverHandler);graph.removeListener("plotly_unhover",graph.__msciUnhoverHandler);if(graph.__msciClickHandler)graph.removeListener("plotly_click",graph.__msciClickHandler);}
  const markerIndexes=(graph.layout.shapes||[]).map((shape,index)=>shape?.name?.startsWith("cross-panel-marker-")?index:-1).filter(index=>index>=0);if(!markerIndexes.length)return;
  const setMarker=(x,visible)=>{const update={};for(const index of markerIndexes){update[`shapes[${index}].x0`]=x;update[`shapes[${index}].x1`]=x;update[`shapes[${index}].visible`]=visible;}Plotly.relayout(graph,update);};
  const pointX=event=>event?.points?.[0]?.x;
  graph.__msciHoverHandler=event=>{const x=pointX(event);if(x!==undefined&&!graph.__msciMarkerPinned)setMarker(x,true);};
  graph.__msciUnhoverHandler=()=>{if(!graph.__msciMarkerPinned)setMarker(graph.layout.shapes[markerIndexes[0]].x0,false);};
  graph.__msciClickHandler=event=>{const x=pointX(event);if(x===undefined)return;graph.__msciMarkerPinned=!graph.__msciMarkerPinned;setMarker(x,graph.__msciMarkerPinned);};
  graph.on("plotly_hover",graph.__msciHoverHandler);graph.on("plotly_unhover",graph.__msciUnhoverHandler);graph.on("plotly_click",graph.__msciClickHandler);
}
function installVisibleYAutoscale(graphId){
  const graph=$(graphId)?.querySelector(".js-plotly-plot");if(!graph||!graph._fullLayout||typeof graph.on!=="function")return;
  if(graph.__msciRelayoutHandler&&typeof graph.removeListener==="function")graph.removeListener("plotly_relayout",graph.__msciRelayoutHandler);
  graph.__msciRelayoutHandler=event=>{
    const rangeEntry=Object.entries(event||{}).find(([key,value])=>/^xaxis\d*\.range$/.test(key)&&Array.isArray(value));
    const startEntry=Object.entries(event||{}).find(([key])=>/^xaxis\d*\.range\[0\]$/.test(key));
    const reset=Object.entries(event||{}).some(([key,value])=>/^xaxis\d*\.autorange$/.test(key)&&value===true);
    let start=-Infinity,end=Infinity;
    if(rangeEntry){start=new Date(rangeEntry[1][0]).getTime();end=new Date(rangeEntry[1][1]).getTime();}
    else if(startEntry){const axis=startEntry[0].replace(/\.range\[0\]$/,"");start=new Date(startEntry[1]).getTime();end=new Date(event[`${axis}.range[1]`]).getTime();}
    else if(!reset)return;
    if(!Number.isFinite(start)&&start!==-Infinity)return;if(!Number.isFinite(end)&&end!==Infinity)return;
    const updates={};
    for(const axisName of Object.keys(graph._fullLayout).filter(key=>/^yaxis\d*$/.test(key))){
      const suffix=axisName.slice(5),traceAxis=suffix?`y${suffix}`:"y",values=[];
      for(const trace of graph.data){
        if((trace.yaxis||"y")!==traceAxis||!Array.isArray(trace.x)||!Array.isArray(trace.y))continue;
        trace.y.forEach((value,index)=>{const timestamp=new Date(trace.x[index]).getTime(),numeric=+value,intraday=trace.meta==="intraday-extension";if(Number.isFinite(numeric)&&(intraday||(Number.isFinite(timestamp)&&timestamp>=start&&timestamp<=end)))values.push(numeric);});
      }
      const range=paddedRange([values],graphId==="toolsChart"&&axisName!=="yaxis");if(range)updates[`${axisName}.range`]=range;
    }
    if(Object.keys(updates).length)Plotly.relayout(graph,updates);
  };
  graph.on("plotly_relayout",graph.__msciRelayoutHandler);
}
const PLOT_CONFIG={responsive:true,displaylogo:false,modeBarButtonsToAdd:["drawline","drawopenpath","eraseshape","resetScale2d"]};
function toolsSeries(){
  const inst=currentInstrument(),byDay=new Map();for(const point of inst.daily){const day=dateKey(point[0]);byDay.set(day,[Date.parse(`${day}T00:00:00Z`),+point[1]]);}
  const intraday=[...(inst.intraday||[])].filter(point=>Number.isFinite(+point[0])&&Number.isFinite(+point[1])).sort((a,b)=>a[0]-b[0]),updatedDay=dateKey(payload.updated_at),sessionDay=intraday.length?dateKey(intraday.at(-1)[0]):null,currentSession=sessionDay===updatedDay;
  if(!currentSession){const daily=[...byDay.values()].sort((a,b)=>a[0]-b[0]);return {display:daily,daily,intraday:[],intradayRange:null};}
  const today=intraday.filter(point=>dateKey(point[0])===sessionDay).map(point=>[+point[0],+point[1]]);if(inst.last_price&&dateKey(inst.last_price[0])===sessionDay&&Number.isFinite(+inst.last_price[1]))today.push([+inst.last_price[0],+inst.last_price[1]]);
  const uniqueToday=[...new Map(today.map(point=>[point[0],point])).values()].sort((a,b)=>a[0]-b[0]);byDay.delete(sessionDay);const history=[...byDay.values()].sort((a,b)=>a[0]-b[0]),latest=uniqueToday.at(-1),display=[...history,...uniqueToday],start=uniqueToday[0][0],end=Math.max(latest[0],start+300000);return {display,daily:history,intraday:uniqueToday,intradayRange:[start,end]};
}
function toolsHoverLabel(value){const date=new Date(value),hasTime=date.getUTCHours()!==0||date.getUTCMinutes()!==0;return hasTime?date.toLocaleString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}):date.toLocaleDateString("de-DE");}
function alignToolRangeCard(hasIntraday){
  const graph=$("toolsChart"),card=document.querySelector(".time-range-card"),size=graph?._fullLayout?._size;if(!graph||!card||!size)return;
  if(!hasIntraday){card.style.right="12px";return;}
  const boundary=size.l+.85*size.w;card.style.right=`${Math.max(12,graph.clientWidth-boundary)}px`;
}
if(!window.__msciRangeCardResize){window.__msciRangeCardResize=true;window.addEventListener("resize",()=>setTimeout(()=>window.__alignToolRangeCard?.(),80));}

function renderTools(){
  const source=toolsSeries(),dailyFull=source.daily,dailyY=pointPrices(dailyFull),dailyPoints=filterRange(dailyFull,toolRange),dailyStart=dailyFull.findIndex(point=>point[0]===dailyPoints[0][0]),dailyX=pointDates(dailyPoints),visibleDailyY=pointPrices(dailyPoints),intradayPoints=source.intraday,intradayX=pointDates(intradayPoints),intradayY=pointPrices(intradayPoints),hasIntraday=intradayPoints.length>0,xRange=[new Date(dailyPoints[0][0]),new Date(dailyPoints.at(-1)[0])];
  const lastFinite=values=>values.findLast(Number.isFinite),historicalDifference=values=>visibleDailyY.map((price,index)=>Number.isFinite(values[index])?price-values[index]:null),intradayDifference=last=>intradayY.map(price=>Number.isFinite(last)?price-last:null);
  const traces=[{...lineTrace(dailyX,visibleDailyY,currentInstrument().name,"#0f172a","solid",1,2.5),customdata:dailyPoints.map(point=>toolsHoverLabel(point[0])),hovertemplate:`%{customdata}<br>${currentInstrument().name}: %{y:.4f}<extra></extra>`}],panels=[];
  if($("showBollinger").checked){
    const fullBands=rolling(dailyY,Math.max(2,+$("bollingerWindow").value||20),Math.max(.1,+$("bollingerStd").value||2)),bands={mid:fullBands.mid.slice(dailyStart),upper:fullBands.upper.slice(dailyStart),lower:fullBands.lower.slice(dailyStart)};
    traces.push({...lineTrace(dailyX,bands.upper,"Bollinger Upper","#60a5fa","dot",1,1.2),hoverinfo:"skip"});traces.push({...lineTrace(dailyX,bands.lower,"Bollinger Lower","#60a5fa","dot",1,1.2),hoverinfo:"skip",fill:"tonexty",fillcolor:"rgba(59,130,246,.08)"});traces.push({...lineTrace(dailyX,bands.mid,"Bollinger Mittelwert","#2563eb","solid",1,1.4),hoverinfo:"skip"});
    const upperLast=lastFinite(bands.upper),lowerLast=lastFinite(bands.lower);panels.push({label:"Bollinger Bands",color:"#2563eb",series:[historicalDifference(bands.upper),historicalDifference(bands.lower)],intradaySeries:[intradayDifference(upperLast),intradayDifference(lowerLast)]});
  }
  if($("showRegression").checked){
    for(const [id,label] of [["regShort","Kurz"],["regMedium","Mittel"],["regLong","Lang"]]){
      const n=Math.max(2,+$(id).value||2), reg=regression(dailyFull,n).slice(dailyStart);
      const period={182:"6 Monate",365:"1 Jahr",730:"2 Jahre",1825:"5 Jahre"}[n]||`${n} Tage`;
      const last=lastFinite(reg);traces.push({...lineTrace(dailyX,reg,`Regression ${period}`,"#7c3aed","dash",1,2.1),hoverinfo:"skip"});panels.push({label:`Regression ${period}`,color:"#7c3aed",series:[historicalDifference(reg)],intradaySeries:[intradayDifference(last)]});
    }
  }
  if($("showKalman").checked){
    const fullK=kalman2d(dailyFull,Math.max(.001,+$("kalmanQ").value||1),Math.max(.001,+$("kalmanR").value||25)),k=fullK.slice(dailyStart);
    traces.push(...splitTrend(dailyX,k,"Kalman 2D"));const fullBar=fullK.map((value,index)=>index?value-fullK[index-1]:null);panels.push({label:"Kalman-Steigung zum Vortag",color:"#db2777",bar:fullBar.slice(dailyStart),intradayBar:intradayX.map(()=>0)});
  }
  if(instrumentKey()===Object.keys(payload.instruments)[0])for(const t of loadTrades()){const entryTime=new Date(t.entryDate).getTime();if(entryTime>=xRange[0].getTime()&&entryTime<=xRange[1].getTime())traces.push({x:[new Date(t.entryDate)],y:[t.entryPrice],type:"scatter",mode:"markers",name:"Kauf",showlegend:false,hoverinfo:"skip",marker:{symbol:"triangle-up",size:11,color:"#16a34a",line:{width:1.2,color:"#fff"}}});if(t.exitDate){const exitTime=new Date(t.exitDate).getTime();if(exitTime>=xRange[0].getTime()&&exitTime<=xRange[1].getTime())traces.push({x:[new Date(t.exitDate)],y:[t.exitPrice],type:"scatter",mode:"markers",name:"Verkauf",showlegend:false,hoverinfo:"skip",marker:{symbol:"triangle-down",size:11,color:"#dc2626",line:{width:1.2,color:"#fff"}}});}}
  const rows=1+panels.length,total=420+panels.length*105,main=420/total,small=105/total,leftDomain=hasIntraday?[0,.85]:[0,1],rightDomain=[.85,1],rightAxisStart=rows+1,intradayRange=hasIntraday?[new Date(intradayPoints[0][0]-300000),new Date(intradayPoints.at(-1)[0]+300000)]:null;
  if(hasIntraday){const intradayTrace={...lineTrace(intradayX,intradayY,"Heute · 5 Minuten","#0f172a","solid",rightAxisStart,2.5),yaxis:"y",meta:"intraday-extension",customdata:intradayPoints.map(point=>toolsHoverLabel(point[0])),hovertemplate:"%{customdata}<br>Intraday: %{y:.4f}<extra></extra>",showlegend:false};if(intradayX.length===1)Object.assign(intradayTrace,{mode:"markers",marker:{color:"#000",size:7,line:{color:"#000",width:1}}});traces.push(intradayTrace);}
  const chartHeight=total+114;$("toolsChart").style.height=`${chartHeight}px`;$("toolsChart").style.minHeight=`${chartHeight}px`;
  const layout={...baseLayout(),height:chartHeight,showlegend:false,hoversubplots:"axis",margin:{l:48,r:88,t:72,b:42},xaxis:{...axisBase(dailyFull),domain:leftDomain,range:xRange,anchor:"y",showticklabels:false,hoverformat:"%d.%m.%Y"},yaxis:{domain:[1-main,1],range:paddedRange(traces.filter(t=>(t.yaxis||"y")==="y").map(t=>t.y||[])),showgrid:false,showline:false,zeroline:false,tickformat:".3f",tickfont:{size:10,color:"#64748b"},automargin:true},bargap:.06,annotations:[],shapes:[]};
  if(hasIntraday){layout.shapes.push({name:"intraday-background",type:"rect",xref:"paper",yref:"paper",x0:.85,x1:1,y0:0,y1:1,fillcolor:"rgba(100,116,139,.11)",line:{width:0},layer:"below"});layout.annotations.push({xref:"paper",yref:"paper",x:.425,y:1.035,text:"<b>Daily Historical</b>",showarrow:false,xanchor:"center",yanchor:"bottom",font:{family:"Arial, sans-serif",size:11,color:"#475569"}},{xref:"paper",yref:"paper",x:.925,y:1.035,text:"<b>Intraday</b>",showarrow:false,xanchor:"center",yanchor:"bottom",font:{family:"Arial, sans-serif",size:11,color:"#475569"}});}
  panels.forEach((panel,index)=>{
    const axis=index+2,rightAxis=rightAxisStart+index+1,top=1-main-index*small,bottom=Math.max(0,top-small),allPanelValues=panel.bar?[panel.bar,panel.intradayBar]:[...panel.series,...panel.intradaySeries];
    layout[`xaxis${axis}`]={...axisBase(dailyFull),domain:leftDomain,range:xRange,anchor:`y${axis}`,matches:"x",showticklabels:index===panels.length-1,hoverformat:"%d.%m.%Y"};layout[`yaxis${axis}`]={domain:[bottom,top],range:paddedRange(allPanelValues,true),showgrid:false,showline:false,zeroline:false,showticklabels:false,ticks:""};
    layout.shapes.push({type:"line",xref:"paper",x0:0,x1:1,yref:`y${axis}`,y0:0,y1:0,line:{color:"#111827",width:.55},layer:"above"});
    layout.annotations.push({xref:"paper",yref:`y${axis}`,x:.006,y:0,text:panel.label,showarrow:false,xanchor:"left",yanchor:"bottom",yshift:3,font:{family:"Arial, sans-serif",size:10,color:panel.color},opacity:.52});
    if(panel.bar)traces.push({x:dailyX,y:panel.bar,type:"bar",name:panel.label,showlegend:false,marker:{color:panel.bar.map(v=>v>=0?"#16a34a":"#dc2626")},xaxis:`x${axis}`,yaxis:`y${axis}`,hovertemplate:"Steigung zum Vortag: %{y:.4f}<extra></extra>"});else panel.series.forEach((series,i)=>traces.push(...splitSigned(dailyX,series,axis,panel.series.length>1?(i?"Kurs - Lower Band":"Kurs - Upper Band"):panel.label)));
    if(hasIntraday){layout[`xaxis${rightAxis}`]={...axisBase(intradayPoints),domain:rightDomain,range:intradayRange,anchor:`y${axis}`,matches:rightAxis===rightAxisStart?undefined:`x${rightAxisStart}`,showticklabels:false,showgrid:false,showline:false,ticks:""};if(panel.bar){if(intradayX.length===1)traces.push({x:intradayX,y:panel.intradayBar,type:"scatter",mode:"markers",showlegend:false,meta:"intraday-extension",marker:{color:"#000",size:6},xaxis:`x${rightAxis}`,yaxis:`y${axis}`,hovertemplate:"Intraday-Steigung: %{y:.4f}<extra></extra>"});else traces.push({x:intradayX,y:panel.intradayBar,type:"bar",showlegend:false,meta:"intraday-extension",marker:{color:panel.intradayBar.map(v=>v>=0?"#16a34a":"#dc2626")},xaxis:`x${rightAxis}`,yaxis:`y${axis}`,hovertemplate:"Intraday-Steigung: %{y:.4f}<extra></extra>"});}else panel.intradaySeries.forEach((series,i)=>{const rightTraces=splitSigned(intradayX,series,axis,panel.intradaySeries.length>1?(i?"Intraday - Lower Band":"Intraday - Upper Band"):panel.label);rightTraces.forEach(trace=>{trace.xaxis=`x${rightAxis}`;trace.meta="intraday-extension";if(intradayX.length===1)Object.assign(trace,{mode:"markers",fill:"none",marker:{color:"#000",size:6}});traces.push(trace);});});}
  });
  if(hasIntraday){layout[`xaxis${rightAxisStart}`]={...axisBase(intradayPoints),domain:rightDomain,range:intradayRange,anchor:"y",showticklabels:false,showgrid:false,showline:false,ticks:""};const bottomRightAxis=rightAxisStart+rows-1,bottomAxis=layout[`xaxis${bottomRightAxis}`],midpoint=new Date((intradayPoints[0][0]+intradayPoints.at(-1)[0])/2),dateLabel=new Date(intradayPoints.at(-1)[0]).toLocaleDateString("de-DE",{day:"2-digit",month:"short",year:"numeric"});Object.assign(bottomAxis,{showticklabels:true,tickmode:"array",tickvals:[midpoint],ticktext:[dateLabel],tickfont:{family:"Arial, sans-serif",size:10,color:"#64748b"},ticks:""});}for(let index=0;index<rows;index++){const suffix=index?`${index+1}`:"",leftX=suffix?`x${suffix}`:"x",yref=suffix?`y${suffix} domain`:"y domain";layout.shapes.push({name:`cross-panel-marker-left-${index+1}`,type:"line",xref:leftX,yref,x0:dailyX[0],x1:dailyX[0],y0:0,y1:1,line:{color:"rgba(37,99,235,.68)",width:1,dash:"dash"},layer:"above",visible:false});if(hasIntraday){const rightAxis=rightAxisStart+index;layout.shapes.push({name:`cross-panel-marker-right-${index+1}`,type:"line",xref:`x${rightAxis}`,yref,x0:intradayX[0],x1:intradayX[0],y0:0,y1:1,line:{color:"rgba(37,99,235,.68)",width:1,dash:"dash"},layer:"above",visible:false});}}
  window.__alignToolRangeCard=()=>alignToolRangeCard(hasIntraday);Plotly.react("toolsChart",traces,layout,PLOT_CONFIG).then(()=>{installCrossPanelHover("toolsChart");installVisibleYAutoscale("toolsChart");alignToolRangeCard(hasIntraday);});
}

function tradeStoreKey(){ return `msci-world-trades-${instrumentKey()}`; }
function loadTrades(){ return JSON.parse(localStorage.getItem(tradeStoreKey()) || "[]"); }
function saveTrades(trades){ localStorage.setItem(tradeStoreKey(),JSON.stringify(trades)); }
function nearestPrice(date){ const target=new Date(date).getTime(), points=currentInstrument().intraday; return points.reduce((best,p)=>Math.abs(p[0]-target)<Math.abs(best[0]-target)?p:best,points[0]); }
function nearestIndex(rows,target,key="timestamp"){let best=-1,distance=Infinity;rows.forEach((row,index)=>{const value=typeof row==="number"?row:row[key],next=Math.abs(value-target);if(next<distance){distance=next;best=index;}});return best;}
function tradeMetrics(t){ if(!t.exitDate||!Number.isFinite(t.exitPrice)) return {...t,holdingDays:null,netReturn:null,pnl:null}; const gross=t.exitPrice-t.entryPrice,pnl=gross-t.fees,netReturn=t.entryPrice?pnl/t.entryPrice*100:null,holdingDays=Math.floor((new Date(t.exitDate)-new Date(t.entryDate))/86400000);return {...t,holdingDays,pnl,netReturn}; }
function renderTradeTable(){
  const trades=loadTrades().map(tradeMetrics), body=$("tradeRows"); body.innerHTML="";
  for(const t of trades){ const row=document.createElement("tr"); if(t.id===selectedTrade)row.className="selected"; row.innerHTML=`<td>${t.id}</td><td>${fmtDate(t.entryDate)}</td><td>${t.exitDate?fmtDate(t.exitDate):"–"}</td><td>${fmt(t.entryPrice,4)}</td><td>${fmt(t.exitPrice,4)}</td><td>${fmt(t.fees)}</td><td>${t.notes||""}</td><td>${t.holdingDays??"–"}</td>`; row.onclick=()=>{selectedTrade=t.id;renderTradeTable();}; body.appendChild(row); }
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
  const trades=renderTradeTable(),comparison=buildComparison(currentInstrument().intraday,trades),dataEnd=comparison.at(-1)?.timestamp??0,cutoff=Math.max(comparison[0]?.timestamp??0,rangeStart(dataEnd,analyticsRange)),visible=comparison.filter(r=>r.timestamp>=cutoff),dataStart=visible[0]?.timestamp??cutoff,x=visible.map(r=>new Date(r.timestamp)),buy=visible.map(r=>r.buy),strategy=visible.map(r=>r.strategy),invested=visible.map(r=>r.invested),xRange=[new Date(dataStart),new Date(dataEnd)];if(!visible.length)return;
  const traces=[{...lineTrace(x,buy,"Buy & Hold","#0f172a","solid",1,2.3),hovertemplate:"Buy & Hold: %{y:.2f}<extra></extra>"}];if(trades.length)traces.push({...lineTrace(x,strategy,"Meine Strategie","#7c3aed","solid",1,2.3),hovertemplate:"Meine Strategie: %{y:.2f}<extra></extra>"});
  for(const t of trades){const entryTime=new Date(t.entryDate).getTime();if(entryTime>=dataStart&&entryTime<=dataEnd){const entryIndex=nearestIndex(visible,entryTime);traces.push({x:[new Date(t.entryDate)],y:[buy[entryIndex]],type:"scatter",mode:"markers",name:`Einstieg ${t.id}`,showlegend:false,marker:{symbol:"triangle-up",size:12,color:"#16a34a",line:{width:1.3,color:"#fff"}},hovertemplate:`Einstieg · Trade ${t.id}<br>%{x|%d.%m.%Y}<extra></extra>`});}if(t.exitDate){const exitTime=new Date(t.exitDate).getTime();if(exitTime>=dataStart&&exitTime<=dataEnd){const exitIndex=nearestIndex(visible,exitTime);traces.push({x:[new Date(t.exitDate)],y:[buy[exitIndex]],type:"scatter",mode:"markers",name:`Ausstieg ${t.id}`,showlegend:false,marker:{symbol:"triangle-down",size:12,color:"#dc2626",line:{width:1.3,color:"#fff"}},hovertemplate:`Ausstieg · Trade ${t.id}<br>%{x|%d.%m.%Y}<extra></extra>`});}}}
  renderMetrics(comparison.map(r=>r.strategy).filter(Number.isFinite),comparison.map(r=>r.buy),comparison.map(r=>new Date(r.timestamp)),trades.length>0);
  const shapes=[];let start=null;for(let i=0;i<invested.length;i++){if(invested[i]&&start===null)start=x[i];if(!invested[i]&&start!==null){shapes.push({type:"rect",xref:"x",yref:"paper",x0:start,x1:x[i],y0:0,y1:1,fillcolor:"rgba(22,163,74,.055)",line:{width:0},layer:"below"});start=null;}}if(start!==null)shapes.push({type:"rect",xref:"x",yref:"paper",x0:start,x1:x.at(-1),y0:0,y1:1,fillcolor:"rgba(22,163,74,.055)",line:{width:0},layer:"below"});
  const layout={...baseLayout(),uirevision:`trading-analytics-${analyticsRange}`,showlegend:true,margin:{l:52,r:18,t:50,b:42},legend:{orientation:"h",x:0,y:1.08,xanchor:"left",yanchor:"bottom",font:{size:10},bgcolor:"rgba(255,255,255,0)"},xaxis:{...axisBase(currentInstrument().intraday),range:xRange,hoverformat:"%d.%m.%Y",rangeslider:{visible:false}},yaxis:{...axisBase(),range:paddedRange([buy,strategy]),zeroline:false,tickformat:".0f"},shapes};
  Plotly.react("analyticsChart",traces,layout,{responsive:true,displaylogo:false}).then(()=>installVisibleYAutoscale("analyticsChart"));
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
