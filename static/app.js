const $ = id => document.getElementById(id);
const PARAM_IDS = ["showRegression","regShort","regMedium","regLong","showBollinger","bollingerWindow","bollingerStd","showKalman","kalmanQ","kalmanR","showWhittaker","smoothLambda","whittakerRegressionHoldout"];
const WT_BT_IDS = ["wtBtWindow","wtBtConfirmDays","wtBtMinPositivePct","wtBtCapital","wtBtSpread","wtBtRange","wtBtBuyOperator","wtBtBuyValue","wtBtSellOperator","wtBtSellValue"];
const RANGE_OPTIONS = [["6 Monate","6m"],["1 Jahr","1y"],["2 Jahre","2y"],["5 Jahre","5y"],["Max","max"]];
const ANALYTICS_RANGE_OPTIONS = RANGE_OPTIONS;
const WHITTAKER_REGRESSION_HOLDOUT_DAYS = 10;
let payload, activeTab="tools", toolRange="6m", analyticsRange="max", backtestRange="5y", selectedTrade=null,backtestResults={},whittakerSimulationTimer=null,whittakerSimulationRunning=false,whittakerSimulationMode=false,whittakerSimulationStartTimestamp=null,whittakerToolsBacktestTimer=null,wtSpreadInstrument=null;
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
function whittakerEilers(points,lambdaValue){
  const y=pointPrices(points),n=y.length;if(n<3)return y;const lambda=Math.max(.1,+lambdaValue||1000),diagonal=Array(n).fill(1),upper1=Array(n-1).fill(0),upper2=Array(n-2).fill(0);for(let i=0;i<n-2;i++){diagonal[i]+=lambda;diagonal[i+1]+=4*lambda;diagonal[i+2]+=lambda;upper1[i]-=2*lambda;upper1[i+1]-=2*lambda;upper2[i]+=lambda;}const m=n-1,d=diagonal.slice(0,m),u1=upper1.slice(0,m-1),u2=upper2.slice(0,m-2),l1=[...u1],l2=[...u2],b=y.slice(0,m);b[m-1]-=upper1[m-1]*y[n-1];if(m>1)b[m-2]-=upper2[m-2]*y[n-1];for(let i=0;i<m;i++){if(i+1<m){const factor=l1[i]/d[i];d[i+1]-=factor*u1[i];if(i+1<m-1)u1[i+1]-=factor*u2[i];b[i+1]-=factor*b[i];}if(i+2<m){const factor=l2[i]/d[i];l1[i+1]-=factor*u1[i];d[i+2]-=factor*u2[i];b[i+2]-=factor*b[i];}}const x=Array(m);for(let i=m-1;i>=0;i--)x[i]=(b[i]-(i+1<m?u1[i]*x[i+1]:0)-(i+2<m?u2[i]*x[i+2]:0))/d[i];return [...x,y[n-1]];
}
function whittakerEilersStandard(points,lambdaValue){
  const y=pointPrices(points),n=y.length;if(n<3)return y;const lambda=Math.max(.1,+lambdaValue||1000),diagonal=Array(n).fill(1),upper1=Array(n-1).fill(0),upper2=Array(n-2).fill(0);for(let i=0;i<n-2;i++){diagonal[i]+=lambda;diagonal[i+1]+=4*lambda;diagonal[i+2]+=lambda;upper1[i]-=2*lambda;upper1[i+1]-=2*lambda;upper2[i]+=lambda;}const d=[...diagonal],u1=[...upper1],u2=[...upper2],l1=[...upper1],l2=[...upper2],b=[...y];for(let i=0;i<n;i++){if(i+1<n){const factor=l1[i]/d[i];d[i+1]-=factor*u1[i];if(i+1<n-1)u1[i+1]-=factor*u2[i];b[i+1]-=factor*b[i];}if(i+2<n){const factor=l2[i]/d[i];l1[i+1]-=factor*u1[i];d[i+2]-=factor*u2[i];b[i+2]-=factor*b[i];}}const x=Array(n);for(let i=n-1;i>=0;i--)x[i]=(b[i]-(i+1<n?u1[i]*x[i+1]:0)-(i+2<n?u2[i]*x[i+2]:0))/d[i];return x;
}
function linearFitFiltered(points,values,start,end){
  if(!points.length||end-start<1)return null;let n=0,sx=0,sy=0,sxy=0,sxx=0;
  for(let i=start;i<=end;i++){const value=values[i];if(!Number.isFinite(value))continue;const x=i-start;n++;sx+=x;sy+=value;sxy+=x*value;sxx+=x*x;}
  const denominator=n*sxx-sx*sx;if(n<2||Math.abs(denominator)<1e-12)return null;const slope=(n*sxy-sx*sy)/denominator,intercept=(sy-slope*sx)/n,mean=sy/n;
  let ssRes=0,ssTot=0;for(let i=start;i<=end;i++){const value=values[i];if(!Number.isFinite(value))continue;const fitted=intercept+slope*(i-start);ssRes+=(value-fitted)**2;ssTot+=(value-mean)**2;}
  const r2=ssTot>1e-12?1-ssRes/ssTot:1;
  return {start,end,slope,intercept,r2,n,valueAtIndex:index=>intercept+slope*(index-start)};
}
function whittakerTurningPoints(values,endIndex,minDistance=1){
  const pivots=[];let previousSign=0;for(let i=1;i<=endIndex;i++){if(!Number.isFinite(values[i])||!Number.isFinite(values[i-1]))continue;const delta=values[i]-values[i-1],sign=delta>0?1:delta<0?-1:0;if(!sign)continue;if(previousSign&&sign!==previousSign){const pivot=i-1;if(!pivots.length||pivot-pivots.at(-1)>=minDistance)pivots.push(pivot);}previousSign=sign;}return pivots;
}
function phaseFromModel(model,displayEnd,completed){
  if(!model)return null;const positive=model.slope>=0;
  return {...model,displayEnd,completed,color:positive?"#16a34a":"#dc2626",direction:positive?1:-1};
}
function whittakerTrendRegressions(points,values,holdoutDays=WHITTAKER_REGRESSION_HOLDOUT_DAYS){
  if(points.length<3)return null;
  const analysisIndex=points.length-1,holdout=Math.max(0,Math.floor(+holdoutDays||0)),fitEnd=analysisIndex-holdout;
  if(fitEnd<1)return {analysisIndex,fitEnd,holdout,pivots:[],completed:[],active:null,phases:[],activeStart:null};
  // The phase and its regression are determined only from information available through fitEnd.
  // The fitted line is then extrapolated across the held-out days to analysisIndex.
  const pivots=whittakerTurningPoints(values,fitEnd),completed=[];
  for(let i=1;i<pivots.length;i++){
    const start=pivots[i-1],end=pivots[i],model=linearFitFiltered(points,values,start,end),phase=phaseFromModel(model,end,true);
    if(phase)completed.push(phase);
  }
  let activeStart=pivots.length?pivots.at(-1):0;
  if(fitEnd-activeStart<1&&pivots.length>1)activeStart=pivots.at(-2);
  if(fitEnd-activeStart<1)activeStart=Math.max(0,fitEnd-20);
  const active=fitEnd-activeStart>=1?phaseFromModel(linearFitFiltered(points,values,activeStart,fitEnd),analysisIndex,false):null;
  const phases=active?[...completed,active]:completed;
  return {analysisIndex,fitEnd,holdout,pivots,completed,active,phases,activeStart};
}
function whittakerPivotKind(values,index){const before=values[index]-values[index-1],after=values[index+1]-values[index];return before>0&&after<0?"Hoch":before<0&&after>0?"Tief":"Wende";}
function strictWhittakerWalkForwardState(points,index,{window=250,lambda=1000,holdout=10,confirmDays=5,minPositivePct=1}={}){
  if(index<2)return null;
  const windowSize=Math.max(20,Math.floor(window)),first=Math.max(0,index-windowSize+1),sample=points.slice(first,index+1),smooth=whittakerEilers(sample,lambda),analysisEnd=smooth.length-1;
  if(analysisEnd<2)return null;
  const pivots=whittakerTurningPoints(smooth,analysisEnd);let phaseStart=pivots.length?pivots.at(-1):0;
  if(analysisEnd-phaseStart<1&&pivots.length>1)phaseStart=pivots.at(-2);
  if(analysisEnd-phaseStart<1)phaseStart=Math.max(0,analysisEnd-20);
  if(analysisEnd-phaseStart<1)return null;
  const phaseModel=linearFitFiltered(sample,smooth,phaseStart,analysisEnd),direction=phaseModel?.slope>=0?1:-1,phaseAge=analysisEnd-phaseStart+1,phaseStartValue=smooth[phaseStart],phaseEndValue=smooth[analysisEnd],phaseGainPct=Number.isFinite(phaseStartValue)&&phaseStartValue!==0?(phaseEndValue/phaseStartValue-1)*100:null,confirmed=phaseAge>=Math.max(1,Math.floor(confirmDays)),positiveEnough=direction>0&&Number.isFinite(phaseGainPct)&&phaseGainPct>=Math.max(0,+minPositivePct||0),eligible=confirmed&&positiveEnough;
  const holdoutDays=Math.max(0,Math.floor(holdout)),fitEnd=analysisEnd-holdoutDays,model=fitEnd-phaseStart>=1?linearFitFiltered(sample,smooth,phaseStart,fitEnd):null,estimate=model?model.valueAtIndex(analysisEnd):null,signal=Number.isFinite(estimate)&&estimate!==0?(points[index][1]/estimate-1)*100:null;
  return {index,first,sample,smooth,analysisEnd,pivots,phaseStart,phaseStartGlobal:first+phaseStart,phaseModel,model,fitEnd,fitGlobalEnd:model?first+fitEnd:null,estimate,direction,phaseAge,phaseGainPct,confirmed,positiveEnough,eligible,signal};
}
function calculateLatchedWhittakerWalkForward(points,endIndex,{window=250,lambda=1000,holdout=10,confirmDays=5,minPositivePct=1}={}){
  const states=Array(points.length).fill(null),regime=Array(points.length).fill(false),activation=Array(points.length).fill(false),rawEligible=Array(points.length).fill(false);let latched=false;
  for(let i=2;i<=Math.min(endIndex,points.length-1);i++){
    const state=strictWhittakerWalkForwardState(points,i,{window,lambda,holdout,confirmDays,minPositivePct});states[i]=state;if(!state){regime[i]=latched;continue;}
    rawEligible[i]=state.eligible;
    if(state.direction<0)latched=false;
    else if(!latched&&state.eligible){latched=true;activation[i]=true;}
    regime[i]=latched;
  }
  return {states,regime,activation,rawEligible};
}
function tradingBreaks(points){
  if(!points.length)return [{bounds:["sat","mon"]}];const present=new Set(points.map(p=>dateKey(p[0]))),missing=[],cursor=new Date(`${dateKey(points[0][0])}T00:00:00Z`),end=new Date(`${dateKey(points.at(-1)[0])}T00:00:00Z`);
  while(cursor<=end){const day=cursor.getUTCDay();if(day!==0&&day!==6&&!present.has(dateKey(cursor)))missing.push(dateKey(cursor));cursor.setUTCDate(cursor.getUTCDate()+1);}
  const breaks=[{bounds:["sat","mon"]}];if(missing.length)breaks.push({values:missing,dvalue:86400000});return breaks;
}
function paddedRange(values,includeZero=false){const finite=values.flat().filter(Number.isFinite);if(!finite.length)return undefined;const lo=Math.min(...finite),hi=Math.max(...finite);if(includeZero){const limit=Math.max(Math.abs(lo),Math.abs(hi));return limit>0?[-limit*1.07,limit*1.07]:[-1,1];}const pad=hi===lo?Math.max(Math.abs(hi)*.05,1):(hi-lo)*.07;return [lo-pad,hi+pad];}
function symmetricPriceRange(values,center){const finite=values.flat().filter(Number.isFinite),distance=Math.max(...finite.map(value=>Math.abs(value-center)),Math.abs(center)*.001,.001)*1.08;return [center-distance,center+distance];}
function alignedIntradayDomain(center,historicalRange,historicalDomain){const fraction=Math.max(0,Math.min(1,(center-historicalRange[0])/(historicalRange[1]-historicalRange[0]))),paperY=historicalDomain[0]+fraction*(historicalDomain[1]-historicalDomain[0]),half=Math.min(paperY,1-paperY);return [paperY-half,paperY+half];}
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
function splitPriceAroundClose(x,y,axis,previousClose){
  const traces=splitSigned(x,y.map(value=>Number.isFinite(value)?value-previousClose:null),axis,"Intraday-Kurs");
  return traces.flatMap(trace=>{trace.y=trace.y.map(value=>Number.isFinite(value)?value+previousClose:value);trace.fill="tonexty";trace.hoverinfo="skip";trace.line.width=1.8;trace.meta="intraday-extension";const baseline={...trace,y:trace.y.map(value=>Number.isFinite(value)?previousClose:value),name:`${trace.name} Referenz`,fill:"none",fillcolor:"rgba(0,0,0,0)",line:{color:"rgba(15,23,42,0)",width:0},hoverinfo:"skip"};return [baseline,trace];});
}
function splitTrend(x,y,name,baseline=null){
  const segments=[];let current=null,previousSign=null;for(let i=1;i<y.length;i++){if(!Number.isFinite(y[i-1])||!Number.isFinite(y[i])){if(current)segments.push(current);current=null;previousSign=null;continue;}const sign=y[i]>y[i-1]?1:y[i]<y[i-1]?-1:(previousSign||1);if(!current||sign!==previousSign){if(current)segments.push(current);current={sign,start:i-1,end:i};}else current.end=i;previousSign=sign;}if(current)segments.push(current);return segments.flatMap(segment=>{const rising=segment.sign>0,color=rising?"#16a34a":"#dc2626",segmentX=x.slice(segment.start,segment.end+1),segmentY=y.slice(segment.start,segment.end+1),line={...lineTrace(segmentX,segmentY,`${name} ${rising?"steigend":"fallend"}`,color,"solid",1,2),showlegend:false,hoverinfo:"skip"};if(!baseline)return [line];const base={...lineTrace(segmentX,baseline.slice(segment.start,segment.end+1),`${name} Kursreferenz`,"rgba(0,0,0,0)","solid",1,0),meta:"trend-fill",showlegend:false,hoverinfo:"skip"};line.fill="tonexty";line.fillcolor=rising?"rgba(22,163,74,.14)":"rgba(220,38,38,.13)";return [base,line];});
}
function splitByDirection(x,y,directions,axis,name,width=1.7){
  const traces=[];let segmentX=[],segmentY=[],direction=null;
  const flush=()=>{if(segmentX.length>=1&&direction!==null){const color=direction>0?"#16a34a":"#dc2626";traces.push({...lineTrace(segmentX,segmentY,name,color,"solid",axis,width),showlegend:false,hoverinfo:"skip"});}segmentX=[];segmentY=[];direction=null;};
  for(let i=0;i<y.length;i++){const value=y[i],nextDirection=directions[i];if(!Number.isFinite(value)||!Number.isFinite(nextDirection)){flush();continue;}if(direction===null){direction=nextDirection;segmentX=[x[i]];segmentY=[value];continue;}if(nextDirection===direction){segmentX.push(x[i]);segmentY.push(value);continue;}const previousX=segmentX.at(-1),previousY=segmentY.at(-1);flush();direction=nextDirection;if(previousX!==undefined){segmentX=[previousX,x[i]];segmentY=[previousY,value];}else{segmentX=[x[i]];segmentY=[value];}}
  flush();return traces;
}
function plotlyGraph(graphId){const root=$(graphId);return root?.classList?.contains("js-plotly-plot")?root:root?.querySelector(".js-plotly-plot");}
function installCrossPanelHover(graphId){
  const graph=plotlyGraph(graphId); if(!graph||!graph._fullLayout||typeof graph.on!=="function")return;
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
  const graph=plotlyGraph(graphId);if(!graph||!graph._fullLayout||typeof graph.on!=="function")return;
  if(graph.__msciRelayoutHandler&&typeof graph.removeListener==="function")graph.removeListener("plotly_relayout",graph.__msciRelayoutHandler);
  graph.__msciRelayoutHandler=event=>{
    if(!Object.keys(event||{}).some(key=>/^xaxis\d*\.(range|range\[[01]\]|autorange)$/.test(key)))return;
    clearTimeout(graph.__msciAutoscaleTimer);graph.__msciAutoscaleTimer=setTimeout(()=>{
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
      if(graphId==="toolsChart"&&Number.isFinite(graph.__msciSymmetricCenters?.[axisName]))continue;
      const suffix=axisName.slice(5),traceAxis=suffix?`y${suffix}`:"y",values=[];
      for(const trace of graph.data){
        if((trace.yaxis||"y")!==traceAxis||trace.meta==="trend-fill"||!Array.isArray(trace.x)||!Array.isArray(trace.y))continue;
        trace.y.forEach((value,index)=>{const timestamp=new Date(trace.x[index]).getTime(),numeric=+value,intraday=trace.meta==="intraday-extension";if(Number.isFinite(numeric)&&(intraday||(Number.isFinite(timestamp)&&timestamp>=start&&timestamp<=end)))values.push(numeric);});
      }
      const symmetricCenter=graph.__msciSymmetricCenters?.[axisName],includeZero=(graphId==="toolsChart"&&axisName!=="yaxis"&&!graph.__msciNoZeroAxes?.includes(axisName))||Boolean(graph.__msciZeroCenteredAxes?.includes(axisName)),range=Number.isFinite(symmetricCenter)?symmetricPriceRange([values],symmetricCenter):paddedRange([values],includeZero);if(range)updates[`${axisName}.range`]=range;
    }
    if(Object.keys(updates).length)Plotly.relayout(graph,updates);
    },80);
  };
  graph.on("plotly_relayout",graph.__msciRelayoutHandler);
}
const PLOT_CONFIG={responsive:true,displaylogo:false,scrollZoom:true,doubleClick:"reset+autosize",modeBarButtonsToAdd:["drawline","drawopenpath","eraseshape","resetScale2d"]};
function toolsSeries(){
  const inst=currentInstrument(),byDay=new Map();for(const point of inst.daily){const day=dateKey(point[0]);byDay.set(day,[Date.parse(`${day}T00:00:00Z`),+point[1]]);}
  const rawIntraday=[...(inst.intraday||[])].filter(point=>Number.isFinite(+point[0])&&Number.isFinite(+point[1])).sort((a,b)=>a[0]-b[0]),lastQuote=inst.last_price&&Number.isFinite(+inst.last_price[0])&&Number.isFinite(+inst.last_price[1])?[+inst.last_price[0],+inst.last_price[1]]:null,updatedDay=dateKey(payload.updated_at),sessionDay=rawIntraday.length?dateKey(rawIntraday.at(-1)[0]):lastQuote?dateKey(lastQuote[0]):null,currentSession=sessionDay===updatedDay;
  if(!currentSession){const daily=[...byDay.values()].sort((a,b)=>a[0]-b[0]);return {display:daily,daily,intraday:[],intradayRange:null,sessionDay:updatedDay,previousClose:daily.at(-1)?.[1]??null};}
  const today=rawIntraday.filter(point=>dateKey(point[0])===sessionDay).map(point=>[+point[0],+point[1]]);if(lastQuote&&dateKey(lastQuote[0])===sessionDay)today.push(lastQuote);
  const uniqueToday=[...new Map(today.map(point=>[point[0],point])).values()].sort((a,b)=>a[0]-b[0]),latest=uniqueToday.at(-1);
  byDay.delete(sessionDay);const history=[...byDay.values()].sort((a,b)=>a[0]-b[0]),previousClose=history.at(-1)?.[1]??latest?.[1]??null,daily=latest?[...history,[latest[0],latest[1]]]:history;
  const start=uniqueToday.length?uniqueToday[0][0]:Date.parse(`${sessionDay}T09:00:00Z`),end=latest?Math.max(latest[0],start+300000):start+300000;
  return {display:daily,daily,intraday:uniqueToday,intradayRange:[start,end],sessionDay,previousClose};
}
function toolsHoverLabel(value){const date=new Date(value),hasTime=date.getUTCHours()!==0||date.getUTCMinutes()!==0;return hasTime?date.toLocaleString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}):date.toLocaleDateString("de-DE");}
const INTRADAY_SESSIONS={
  "LWLD.PA":{timeZone:"Europe/Paris",openHour:9,openMinute:0,closeHour:17,closeMinute:30},
  "IQQW.DE":{timeZone:"Europe/Berlin",openHour:9,openMinute:0,closeHour:17,closeMinute:30},
  "CO2.L":{timeZone:"Europe/London",openHour:8,openMinute:0,closeHour:16,closeMinute:30}
};
function zonedSessionTimestamp(reference,timeZone,hour,minute){
  const formatter=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}),parts=Object.fromEntries(formatter.formatToParts(new Date(reference)).filter(part=>part.type!=="literal").map(part=>[part.type,+part.value]));
  const target=Date.UTC(parts.year,parts.month-1,parts.day,hour,minute),wallAtGuess=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second);return target+(reference-wallAtGuess);
}
function intradaySessionRange(instrument,reference){const session=INTRADAY_SESSIONS[instrument.ticker]||{timeZone:"Europe/Berlin",openHour:9,openMinute:0,closeHour:17,closeMinute:30};return [zonedSessionTimestamp(reference,session.timeZone,session.openHour,session.openMinute),zonedSessionTimestamp(reference,session.timeZone,session.closeHour,session.closeMinute)];}
function alignToolRangeCard(hasIntraday){
  const graph=$("toolsChart"),card=document.querySelector(".time-range-card"),size=graph?._fullLayout?._size;if(!graph||!card||!size)return;
  card.style.left=`${Math.max(12,size.l)}px`;card.style.right="auto";
}
if(!window.__msciRangeCardResize){window.__msciRangeCardResize=true;window.addEventListener("resize",()=>setTimeout(()=>window.__alignToolRangeCard?.(),80));}

function whittakerSimulationDates(){return payload?toolsSeries().daily:[]}
function stopWhittakerSimulation(renderBacktest=false){
  if(whittakerSimulationTimer){clearTimeout(whittakerSimulationTimer);whittakerSimulationTimer=null;}
  whittakerSimulationRunning=false;
  if($("whittakerSimPlay"))$("whittakerSimPlay").disabled=false;
  if($("whittakerSimPause"))$("whittakerSimPause").disabled=true;
  if(renderBacktest&&payload)renderWhittakerToolsBacktest();
}
function syncWhittakerSimulationControls(points){
  const slider=$("whittakerSimSlider"),label=$("whittakerSimDate"),dateInput=$("whittakerAsOfDate");if(!slider||!label||!points?.length)return;
  const max=points.length-1,cutoff=toolRange==="max"?-Infinity:rangeStart(points.at(-1)[0],toolRange);let min=Math.max(2,points.findIndex(point=>point[0]>=cutoff));if(min<2)min=2;if(min>max)min=Math.max(2,max-1);
  slider.min=String(Math.min(min,max));slider.max=String(max);if(dateInput)dateInput.max=dateKey(points[max][0]);
  const asOf=dateInput?.value;
  if(asOf){const limit=Date.parse(`${asOf}T23:59:59.999Z`);let index=points.findLastIndex(point=>point[0]<=limit);if(index<min)index=min;index=Math.min(max,index);slider.value=String(index);label.textContent=fmtDate(points[index][0]);}
  else if(!whittakerSimulationRunning){slider.value=String(max);label.textContent="Aktuell";}
}
function setWhittakerSimulationIndex(index,render=true){
  const points=whittakerSimulationDates(),slider=$("whittakerSimSlider");if(!points.length||!slider)return;
  syncWhittakerSimulationControls(points);const min=+slider.min||2,max=+slider.max||points.length-1,next=Math.max(min,Math.min(max,Math.floor(index)));
  whittakerSimulationMode=true;slider.value=String(next);$("showWhittaker").checked=true;if($("whittakerAsOfDate"))$("whittakerAsOfDate").value=next>=max?"":dateKey(points[next][0]);if($("whittakerSimDate"))$("whittakerSimDate").textContent=next>=max?"Aktuell":fmtDate(points[next][0]);
  if(render)renderWhittakerSimulationGraph();
}
function startWhittakerSimulation(){
  const points=whittakerSimulationDates(),slider=$("whittakerSimSlider");if(points.length<3||!slider)return;
  stopWhittakerSimulation(false);$("showWhittaker").checked=true;syncWhittakerSimulationControls(points);
  const min=+slider.min||2,max=+slider.max||points.length-1,current=+slider.value||max;whittakerSimulationMode=true;if(current>=max)setWhittakerSimulationIndex(min,true);
  whittakerSimulationRunning=true;$("whittakerSimPlay").disabled=true;$("whittakerSimPause").disabled=false;
  const tick=()=>{if(!whittakerSimulationRunning)return;const now=+slider.value||min;if(now>=max){stopWhittakerSimulation(true);return;}setWhittakerSimulationIndex(now+1,true);whittakerSimulationTimer=setTimeout(tick,Math.max(80,+$("whittakerSimSpeed").value||500));};
  whittakerSimulationTimer=setTimeout(tick,Math.max(80,+$("whittakerSimSpeed").value||500));
}
function resetWhittakerSimulation(){stopWhittakerSimulation(false);whittakerSimulationMode=false;whittakerSimulationStartTimestamp=null;if($("whittakerAsOfDate"))$("whittakerAsOfDate").value="";const points=whittakerSimulationDates();syncWhittakerSimulationControls(points);renderWhittakerSimulationGraph();}

function renderWhittakerSimulationGraph(){
  const lab=$("whittakerWalkForwardLab"),panel=$("whittakerSimulationPanel"),pair=$("toolsChartPair"),chart=$("whittakerSimulationChart");if(!lab||!panel||!chart||!payload)return;const active=$("showWhittaker").checked;lab.classList.toggle("hidden",!active);panel.classList.toggle("hidden",!active);pair?.classList.toggle("simulation-active",active);if(!active)return;
  const points=whittakerSimulationDates();if(points.length<3){chart.innerHTML="<div class='backtest-empty'>Zu wenige Daten für die Walk-forward-Simulation.</div>";return;}
  syncWhittakerSimulationControls(points);const slider=$("whittakerSimSlider"),max=points.length-1,min=+slider.min||2,index=Math.max(min,Math.min(max,+slider.value||max)),snapshot=points.slice(0,index+1),lambda=Math.max(.1,+$("smoothLambda").value||1000),window=Math.max(20,+$("wtBtWindow").value||250),confirmDays=Math.max(1,Math.floor(+$("wtBtConfirmDays").value||5)),minPositivePct=Math.max(0,+$("wtBtMinPositivePct").value||0),holdout=Math.max(0,Math.floor(+$("whittakerRegressionHoldout").value||0)),smooth=whittakerEilers(snapshot,lambda),displayStart=Math.min(index,Math.max(0,min)),x=pointDates(snapshot.slice(displayStart)),price=pointPrices(snapshot.slice(displayStart)),smoothVisible=smooth.slice(displayStart),walk=calculateLatchedWhittakerWalkForward(points,index,{window,lambda,holdout,confirmDays,minPositivePct}),regime=walk.regime,states=walk.states,activation=walk.activation;
  const phaseAge=states.map(state=>state?.phaseAge??null),phaseGain=states.map(state=>state?.phaseGainPct??null),gray=smoothVisible.map((v,i)=>regime[displayStart+i]?null:v),green=smoothVisible.map((v,i)=>regime[displayStart+i]?v:null),walkRegression=states.map(state=>state?.estimate??null),grayRegression=walkRegression.slice(displayStart,index+1).map((v,i)=>regime[displayStart+i]?null:v),greenRegression=walkRegression.slice(displayStart,index+1).map((v,i)=>regime[displayStart+i]?v:null),traces=[{...lineTrace(x,price,"Tatsächlicher Kurs","#0f172a","solid",1,1.7),hovertemplate:"Kurs: %{y:.4f}<extra></extra>"},{...lineTrace(x,gray,"Whittaker · noch nicht bestätigt","#94a3b8","solid",1,2.5),connectgaps:false,customdata:x.map((_,i)=>[phaseAge[displayStart+i],phaseGain[displayStart+i]]),hovertemplate:"Whittaker: %{y:.4f}<br>Damals erkanntes Phasenalter: %{customdata[0]} Tage<br>Damals erkannter Phasenanstieg: %{customdata[1]:+.2f} %<extra></extra>"},{...lineTrace(x,green,"Bestätigtes Long-Regime · unveränderlich","#16a34a","solid",1,3.1),connectgaps:false,customdata:x.map((_,i)=>[phaseAge[displayStart+i],phaseGain[displayStart+i]]),hovertemplate:"Bestätigtes Long-Regime<br>Whittaker: %{y:.4f}<br>Alter bei damaliger Berechnung: %{customdata[0]} Tage<br>Anstieg: %{customdata[1]:+.2f} %<extra></extra>"},{...lineTrace(x,grayRegression,"Walk-forward-Regression · vor Bestätigung","#cbd5e1","solid",1,1.3),showlegend:false,connectgaps:false,hoverinfo:"skip"},{...lineTrace(x,greenRegression,"Walk-forward-Regression · bestätigtes Regime","#15803d","solid",1,1.9),showlegend:false,connectgaps:false,hovertemplate:"Damals verfügbare Regression: %{y:.4f}<extra></extra>"}];
  const activationIndexes=activation.map((value,i)=>value&&i>=displayStart&&i<=index?i:-1).filter(i=>i>=0);if(activationIndexes.length)traces.push({x:activationIndexes.map(i=>new Date(points[i][0])),y:activationIndexes.map(i=>smooth[i]??points[i][1]),type:"scatter",mode:"markers",name:"Bestätigungssignal",marker:{symbol:"triangle-up",size:10,color:"#16a34a",line:{color:"#fff",width:1}},customdata:activationIndexes.map(i=>[phaseAge[i],phaseGain[i]]),hovertemplate:"Bestätigung wurde an diesem Tag fixiert<br>Alter: %{customdata[0]} Tage<br>Anstieg: %{customdata[1]:+.2f} %<extra></extra>"});
  const asOf=snapshot.at(-1)[0],height=Math.max(520,parseInt($("toolsChart")?.style?.height)||560),layout={...baseLayout(),height,showlegend:true,margin:{l:58,r:24,t:62,b:44},legend:{orientation:"h",x:0,y:1.08,font:{size:10}},xaxis:{...axisBase(snapshot.slice(displayStart)),hoverformat:"%d.%m.%Y"},yaxis:{range:paddedRange([price,smoothVisible,grayRegression,greenRegression]),tickformat:".3f",showgrid:true,gridcolor:"#f1f5f9"},annotations:[{xref:"paper",yref:"paper",x:0,y:1.03,text:`<b>Informationsstand ${fmtDate(asOf)} · Signal wird ab Bestätigung fixiert</b>`,showarrow:false,xanchor:"left",font:{size:11,color:"#475569"}}]};
  chart.style.height=`${height}px`;chart.style.minHeight=`${height}px`;Plotly.react("whittakerSimulationChart",traces,layout,PLOT_CONFIG).then(()=>installVisibleYAutoscale("whittakerSimulationChart"));
}
function renderWhittakerWalkForwardLab(){const lab=$("whittakerWalkForwardLab"),panel=$("whittakerSimulationPanel"),pair=$("toolsChartPair");if(!lab)return;const active=$("showWhittaker").checked;lab.classList.toggle("hidden",!active);panel?.classList.toggle("hidden",!active);pair?.classList.toggle("simulation-active",active);if(!active)return;renderWhittakerSimulationGraph();renderWhittakerToolsBacktest();}

function renderTools(skipEmbeddedBacktest=false){
  const source=toolsSeries(),dailyFull=source.daily;if(!dailyFull.length)return;
  const dailyY=pointPrices(dailyFull),dailyPoints=filterRange(dailyFull,toolRange),dailyStart=dailyFull.findIndex(point=>point[0]===dailyPoints[0][0]),dailyX=pointDates(dailyPoints),visibleDailyY=pointPrices(dailyPoints),intradayPoints=source.intraday,intradayX=pointDates(intradayPoints),intradayY=pointPrices(intradayPoints),hasIntraday=true,hasIntradayData=intradayPoints.length>0,sessionReference=hasIntradayData?intradayPoints[0][0]:Date.parse(`${source.sessionDay}T12:00:00Z`),xRange=[new Date(dailyPoints[0][0]),new Date(dailyPoints.at(-1)[0])];
  syncWhittakerSimulationControls(dailyFull);
  const historicalDifference=values=>visibleDailyY.map((price,index)=>Number.isFinite(values[index])?price-values[index]:null);
  const traces=[{...lineTrace(dailyX,visibleDailyY,currentInstrument().name,"#0f172a","solid",1,2.5),customdata:dailyPoints.map(point=>toolsHoverLabel(point[0])),hovertemplate:`%{customdata}<br>${currentInstrument().name}: %{y:.4f}<extra></extra>`}],panels=[];
  if($("showBollinger").checked){
    const bollingerWindow=Math.max(2,+$("bollingerWindow").value||20),bollingerMultiple=Math.max(.1,+$("bollingerStd").value||2),fullBands=rolling(dailyY,bollingerWindow,bollingerMultiple),bands={mid:fullBands.mid.slice(dailyStart),upper:fullBands.upper.slice(dailyStart),lower:fullBands.lower.slice(dailyStart)};
    traces.push({...lineTrace(dailyX,bands.upper,"Bollinger Upper","#60a5fa","dot",1,1.2),hoverinfo:"skip"});traces.push({...lineTrace(dailyX,bands.lower,"Bollinger Lower","#60a5fa","dot",1,1.2),hoverinfo:"skip",fill:"tonexty",fillcolor:"rgba(59,130,246,.08)"});traces.push({...lineTrace(dailyX,bands.mid,"Bollinger Mittelwert","#2563eb","solid",1,1.4),hoverinfo:"skip"});
    panels.push({label:"Bollinger Bands",color:"#2563eb",series:[historicalDifference(bands.upper),historicalDifference(bands.lower)]});
  }
  if($("showRegression").checked){
    for(const [id,label] of [["regShort","Kurz"],["regMedium","Mittel"],["regLong","Lang"]]){
      const n=Math.max(2,+$(id).value||2),reg=regression(dailyFull,n).slice(dailyStart);
      const period={182:"6 Monate",365:"1 Jahr",730:"2 Jahre",1825:"5 Jahre"}[n]||`${n} Tage`;
      traces.push({...lineTrace(dailyX,reg,`Regression ${period}`,"#7c3aed","dash",1,2.1),hoverinfo:"skip"});panels.push({label:`Regression ${period}`,color:"#7c3aed",series:[historicalDifference(reg)]});
    }
  }
  if($("showKalman").checked){
    const kalmanQ=Math.max(.001,+$("kalmanQ").value||1),kalmanR=Math.max(.001,+$("kalmanR").value||25),fullK=kalman2d(dailyFull,kalmanQ,kalmanR),k=fullK.slice(dailyStart);
    traces.push(...splitTrend(dailyX,k,"Kalman 2D"));const fullBar=fullK.map((value,index)=>index?value-fullK[index-1]:null);panels.push({label:"Kalman-Steigung zum Vortag",color:"#db2777",bar:fullBar.slice(dailyStart)});
  }
  if($("showWhittaker").checked){
    const lambda=Math.max(.1,+$("smoothLambda").value||1000),analysisPoints=dailyFull;
    if(analysisPoints.length>=3){
      const fullSmooth=whittakerEilers(analysisPoints,lambda),filterOnDaily=Array(dailyFull.length).fill(null);for(let i=0;i<fullSmooth.length;i++)filterOnDaily[i]=fullSmooth[i];const smooth=filterOnDaily.slice(dailyStart);
      traces.push(...splitTrend(dailyX,smooth,"Whittaker–Eilers-Smoother · aktueller Anker",visibleDailyY));
      const regressionHoldout=Math.max(0,Math.floor(+$("whittakerRegressionHoldout").value||0)),regressions=whittakerTrendRegressions(analysisPoints,fullSmooth,regressionHoldout);
      if(regressions?.phases?.length){
        const pivotIndexes=regressions.pivots.filter(index=>index>0&&index<fullSmooth.length-1),pivotX=pivotIndexes.map(index=>new Date(analysisPoints[index][0])),pivotY=pivotIndexes.map(index=>fullSmooth[index]),pivotKinds=pivotIndexes.map(index=>whittakerPivotKind(fullSmooth,index));if(pivotX.length)traces.push({x:pivotX,y:pivotY,type:"scatter",mode:"markers",name:"Whittaker Hoch-/Tiefpunkte",showlegend:false,marker:{size:7,color:pivotKinds.map(kind=>kind==="Hoch"?"#dc2626":"#16a34a"),symbol:pivotKinds.map(kind=>kind==="Hoch"?"triangle-down":"triangle-up"),line:{color:"#fff",width:.8}},customdata:pivotKinds,hovertemplate:"%{customdata}: %{y:.4f}<extra></extra>"});
        const visibleSegments=[];
        regressions.phases.forEach(phase=>{
          const startIndex=Math.max(phase.start,dailyStart),endIndex=Math.min(phase.displayEnd,analysisPoints.length-1,dailyFull.length-1);if(endIndex<startIndex)return;
          const indices=Array.from({length:endIndex-startIndex+1},(_,offset)=>startIndex+offset),x=indices.map(index=>new Date(dailyFull[index][0])),actual=indices.map(index=>dailyY[index]),regressionValues=indices.map(index=>phase.valueAtIndex(index)),residualAbs=indices.map((index,j)=>Number.isFinite(actual[j])&&Number.isFinite(regressionValues[j])?actual[j]-regressionValues[j]:null),residualPct=indices.map((index,j)=>Number.isFinite(residualAbs[j])&&regressionValues[j]!==0?residualAbs[j]/regressionValues[j]*100:null);
          visibleSegments.push({phase,indices,x,actual,regression:regressionValues,residualAbs,residualPct});
        });
        if(visibleSegments.length){
          panels.push({kind:"whittaker-phase-regression",label:"Tatsächlicher Kurs & Whittaker-Phasenregressionen",color:"#0891b2",segments:visibleSegments,actualX:dailyX,actualY:visibleDailyY});
          panels.push({kind:"whittaker-phase-residual",label:"Kurs − Phasenregression (%)",color:"#0891b2",segments:visibleSegments});
        }
      }
    }
  }
  if(instrumentKey()===Object.keys(payload.instruments)[0])for(const t of loadTrades()){const entryTime=new Date(t.entryDate).getTime();if(entryTime>=xRange[0].getTime()&&entryTime<=xRange[1].getTime())traces.push({x:[new Date(t.entryDate)],y:[t.entryPrice],type:"scatter",mode:"markers",name:"Kauf",showlegend:false,hoverinfo:"skip",marker:{symbol:"triangle-up",size:11,color:"#16a34a",line:{width:1.2,color:"#fff"}}});if(t.exitDate){const exitTime=new Date(t.exitDate).getTime();if(exitTime>=xRange[0].getTime()&&exitTime<=xRange[1].getTime())traces.push({x:[new Date(t.exitDate)],y:[t.exitPrice],type:"scatter",mode:"markers",name:"Verkauf",showlegend:false,hoverinfo:"skip",marker:{symbol:"triangle-down",size:11,color:"#dc2626",line:{width:1.2,color:"#fff"}}});}}
  const rows=1+panels.length,total=420+panels.length*105,main=420/total,small=105/total,leftDomain=[0,.91],rightDomain=[.92,1],rightAxisStart=rows+1,sessionRange=intradaySessionRange(currentInstrument(),sessionReference),intradayRange=sessionRange.map(value=>new Date(value)),previousClose=Number.isFinite(source.previousClose)?source.previousClose:(visibleDailyY.at(-2)??visibleDailyY.at(-1));
  if(hasIntradayData){traces.push(...splitPriceAroundClose(intradayX,intradayY,rightAxisStart,previousClose));traces.push({x:intradayX,y:intradayY,type:"scatter",mode:"markers",xaxis:`x${rightAxisStart}`,yaxis:`y${rightAxisStart}`,meta:"intraday-extension",showlegend:false,marker:{size:intradayX.length===1?7:9,color:intradayX.length===1?"#000":"rgba(0,0,0,0)",line:{color:"#000",width:intradayX.length===1?1:0}},customdata:intradayPoints.map(point=>toolsHoverLabel(point[0])),hovertemplate:"%{customdata}<br>Intraday-Kurs: %{y:.4f}<extra></extra>"});}
  const chartHeight=total+114,historicalDomain=[1-main,1],historicalYRange=paddedRange(traces.filter(t=>(t.yaxis||"y")==="y"&&t.meta!=="trend-fill").map(t=>t.y||[]));$("toolsChart").style.height=`${chartHeight}px`;$("toolsChart").style.minHeight=`${chartHeight}px`;
  const layout={...baseLayout(),height:chartHeight,dragmode:"zoom",showlegend:false,hoversubplots:"axis",margin:{l:48,r:88,t:72,b:42},xaxis:{...axisBase(dailyFull),domain:leftDomain,range:xRange,anchor:"y",showticklabels:false,hoverformat:"%d.%m.%Y"},yaxis:{domain:historicalDomain,range:historicalYRange,showgrid:false,showline:false,zeroline:false,tickformat:".3f",tickfont:{size:10,color:"#64748b"},automargin:true},bargap:.06,annotations:[],shapes:[]};
  if(hasIntraday){const intradayDate=new Date(sessionReference).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}),intradayValues=[intradayY,[previousClose]],intradayDomain=[0,1];layout[`yaxis${rightAxisStart}`]={domain:intradayDomain,range:paddedRange(intradayValues),side:"right",showticklabels:true,tickformat:".3f",nticks:7,tickfont:{family:"Arial, sans-serif",size:9,color:"#64748b"},showgrid:false,showline:false,zeroline:false,ticks:"",automargin:true};layout.shapes.push({name:"intraday-background",type:"rect",xref:"paper",yref:"paper",x0:rightDomain[0],x1:rightDomain[1],y0:0,y1:1,fillcolor:"rgba(100,116,139,.075)",line:{width:0},layer:"below"},{name:"previous-close-reference",type:"line",xref:`x${rightAxisStart}`,yref:`y${rightAxisStart}`,x0:intradayRange[0],x1:intradayRange[1],y0:previousClose,y1:previousClose,line:{color:"#0f172a",width:1.5,dash:"dot"},layer:"below"});layout.annotations.push({xref:"paper",yref:"paper",x:.455,y:1.035,text:"<b>Daily Historical</b>",showarrow:false,xanchor:"center",yanchor:"bottom",font:{family:"Arial, sans-serif",size:11,color:"#475569"}},{xref:"paper",yref:"paper",x:(rightDomain[0]+rightDomain[1])/2,y:1.035,text:`<b>Intraday (${intradayDate})</b>`,showarrow:false,xanchor:"center",yanchor:"bottom",font:{family:"Arial, sans-serif",size:10,color:"#475569"}});if(hasIntradayData){const latestPrice=intradayY.at(-1),changePct=(latestPrice/previousClose-1)*100,changeText=`${changePct>=0?"+":""}${changePct.toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})} %`,changeColor=changePct>=0?"#15803d":"#b91c1c";layout.annotations.push({xref:`x${rightAxisStart}`,yref:`y${rightAxisStart}`,x:intradayX.at(-1),y:latestPrice,text:`<b>${changeText}</b>`,showarrow:false,xanchor:"right",yanchor:"middle",xshift:-3,font:{family:"Arial, sans-serif",size:9,color:changeColor},bgcolor:"rgba(255,255,255,.82)",borderpad:1});}}
  const noZeroAxes=[];
  panels.forEach((panel,index)=>{
    const axis=index+2,top=1-main-index*small,bottom=Math.max(0,top-small),isPhaseRegression=panel.kind==="whittaker-phase-regression",isPhaseResidual=panel.kind==="whittaker-phase-residual",allPanelValues=isPhaseRegression?[panel.actualY,...panel.segments.map(segment=>segment.regression)]:isPhaseResidual?panel.segments.map(segment=>segment.residualPct):panel.bar?[panel.bar]:panel.series,includeZero=!isPhaseRegression;
    if(isPhaseRegression)noZeroAxes.push(`yaxis${axis}`);
    layout[`xaxis${axis}`]={...axisBase(dailyFull),domain:leftDomain,range:xRange,anchor:`y${axis}`,matches:"x",showticklabels:index===panels.length-1,hoverformat:"%d.%m.%Y"};layout[`yaxis${axis}`]={domain:[bottom,top],range:paddedRange(allPanelValues,includeZero),showgrid:false,showline:false,zeroline:false,showticklabels:isPhaseRegression||isPhaseResidual,tickformat:isPhaseResidual?".2f":isPhaseRegression?".3f":undefined,ticks:"",tickfont:{size:9,color:"#64748b"}};
    if(includeZero)layout.shapes.push({type:"line",xref:"paper",x0:0,x1:leftDomain[1],yref:`y${axis}`,y0:0,y1:0,line:{color:"#111827",width:.55},layer:"above"});
    layout.annotations.push({xref:"paper",yref:`y${axis}`,x:.006,y:isPhaseRegression?1:0,text:panel.label,showarrow:false,xanchor:"left",yanchor:isPhaseRegression?"top":"bottom",yshift:isPhaseRegression?-3:3,font:{family:"Arial, sans-serif",size:10,color:panel.color},opacity:.66});
    if(isPhaseRegression){
      traces.push({...lineTrace(panel.actualX,panel.actualY,"Tatsächlicher Kurs","#0f172a","solid",axis,1.5),showlegend:false,hovertemplate:"Kurs: %{y:.4f}<extra></extra>"});
      panel.segments.forEach((segment,segmentIndex)=>{
        const phase=segment.phase,color=phase.color,label=`${phase.direction>0?"Grüne":"Rote"} Phase ${segmentIndex+1}${phase.completed?"":" · aktuell"}`;
        traces.push({...lineTrace(segment.x,segment.regression,`${label} Regression`,color,"solid",axis,2.35),showlegend:false,hovertemplate:`${label}<br>Regression: %{y:.4f}<extra></extra>`});
      });
    }else if(isPhaseResidual){
      panel.segments.forEach((segment,segmentIndex)=>{
        const phase=segment.phase,color=phase.color,label=`${phase.direction>0?"Grüne":"Rote"} Phase ${segmentIndex+1}${phase.completed?"":" · aktuell"}`;
        traces.push({...lineTrace(segment.x,segment.residualPct,`${label} Abweichung`,color,"solid",axis,1.8),showlegend:false,fill:"tozeroy",fillcolor:phase.direction>0?"rgba(22,163,74,.09)":"rgba(220,38,38,.08)",customdata:segment.residualAbs,hovertemplate:`${label}<br>Kurs − Regression: %{y:+.2f} %<br>Absolut: %{customdata:+.4f}<extra></extra>`});
      });
    }else if(panel.bar)traces.push({x:dailyX,y:panel.bar,type:"bar",name:panel.label,showlegend:false,marker:{color:panel.bar.map(v=>v>=0?"#16a34a":"#dc2626")},xaxis:`x${axis}`,yaxis:`y${axis}`,hovertemplate:"Steigung zum Vortag: %{y:.4f}<extra></extra>"});else panel.series.forEach((series,i)=>traces.push(...splitSigned(dailyX,series,axis,panel.series.length>1?(i?"Kurs - Lower Band":"Kurs - Upper Band"):panel.label)));

  });
  if(hasIntraday)layout[`xaxis${rightAxisStart}`]={...axisBase(intradayPoints),domain:rightDomain,range:intradayRange,anchor:`y${rightAxisStart}`,showticklabels:true,tickformat:"%H:%M",nticks:3,ticklabelposition:"inside bottom",tickfont:{family:"Arial, sans-serif",size:10,color:"#64748b"},showgrid:false,showline:false,ticks:""};for(let index=0;index<rows;index++){const suffix=index?`${index+1}`:"",leftX=suffix?`x${suffix}`:"x",yref=suffix?`y${suffix} domain`:"y domain";layout.shapes.push({name:`cross-panel-marker-left-${index+1}`,type:"line",xref:leftX,yref,x0:dailyX[0],x1:dailyX[0],y0:0,y1:1,line:{color:"rgba(37,99,235,.68)",width:1,dash:"dash"},layer:"above",visible:false});if(hasIntraday&&index===0){const markerX=intradayX[0]||intradayRange[0];layout.shapes.push({name:"cross-panel-marker-right-1",type:"line",xref:`x${rightAxisStart}`,yref:`y${rightAxisStart} domain`,x0:markerX,x1:markerX,y0:0,y1:1,line:{color:"rgba(37,99,235,.68)",width:1,dash:"dash"},layer:"above",visible:false});}}
  window.__alignToolRangeCard=()=>alignToolRangeCard(hasIntraday);Plotly.react("toolsChart",traces,layout,PLOT_CONFIG).then(()=>{const graph=plotlyGraph("toolsChart");if(graph){graph.__msciSymmetricCenters=hasIntraday?{[`yaxis${rightAxisStart}`]:previousClose}:{};graph.__msciNoZeroAxes=noZeroAxes;}installCrossPanelHover("toolsChart");installVisibleYAutoscale("toolsChart");alignToolRangeCard(hasIntraday);});
  if(!skipEmbeddedBacktest)renderWhittakerWalkForwardLab();
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
function comparisonEvaluationMarkup(strategy,buy,x,hasStrategy=true){
  if(!hasStrategy){const empty=[["Rendite p.a.","–","–","–"],["Volatilität p.a.","–","–","–"],["Sharpe Ratio","–","–","–"],["Max. Drawdown","–","–","–"],["Information Ratio","–","–","–"]];return evaluationMarkup(empty);}
  const mine=performanceStats(strategy,x),benchmark=performanceStats(buy,x),active=mine.returns.map((v,i)=>v-benchmark.returns[i]);
  const activeMean=active.reduce((a,b)=>a+b,0)/Math.max(1,active.length),activeVar=active.reduce((a,b)=>a+(b-activeMean)**2,0)/Math.max(1,active.length-1),activeSd=Math.sqrt(activeVar),information=active.length>1&&activeSd?activeMean/activeSd*Math.sqrt(252):NaN;
  const rows=[["Rendite p.a.",mine.annual,benchmark.annual,"pct"],["Volatilität p.a.",mine.vol,benchmark.vol,"pct"],["Sharpe Ratio",mine.sharpe,benchmark.sharpe,"num"],["Max. Drawdown",mine.drawdown,benchmark.drawdown,"pct"]],value=(v,type)=>type==="pct"?pct(v*100):fmt(v,2),difference=(a,b,type)=>type==="pct"?pct((a-b)*100):fmt(a-b,2);
  return evaluationMarkup([...rows.map(([label,a,b,type])=>[label,value(a,type),value(b,type),difference(a,b,type)]),["Information Ratio",fmt(information,2),"–","–"]]);
}
function renderMetrics(strategy,buy,x,hasTrades){$("metrics").innerHTML=comparisonEvaluationMarkup(strategy,buy,x,hasTrades);}
function evaluationMarkup(rows){return `<div class="evaluation-table"><div class="evaluation-row evaluation-header-row"><div>Kennzahl</div><div>Meine Strategie</div><div>Buy & Hold</div><div>Differenz</div></div>${rows.map(row=>`<div class="evaluation-row">${row.map(value=>`<div>${value}</div>`).join("")}</div>`).join("")}</div>`;}
const DEFAULT_SPREADS={amundi_2x:12,ishares_msci_world:4,co2_allowances:35};let spreadInstrument=null,backtestTimer=null;
function backtestOhlc(){const inst=currentInstrument(),source=inst.daily_ohlc?.length?inst.daily_ohlc:inst.daily.map(point=>[point[0],point[1],point[1],point[1],point[1],point[1]]);return source.filter(row=>row.length>=5&&row.slice(0,5).every(Number.isFinite)).sort((a,b)=>a[0]-b[0]);}
function backtestSignalPoints(rows,type){const useLastPrice=type==="whittaker",points=rows.map(row=>[row[0],useLastPrice&&Number.isFinite(+row[5])?+row[5]:+row[4]]),quote=currentInstrument().last_price;if(useLastPrice&&points.length&&quote&&Number.isFinite(+quote[0])&&Number.isFinite(+quote[1])&&dateKey(+quote[0])===dateKey(points.at(-1)[0]))points[points.length-1]=[points.at(-1)[0],+quote[1]];return points;}
function filterSlope(values,index){const current=values[index],previous=values[index-1];return Number.isFinite(current)&&Number.isFinite(previous)&&previous!==0?(current/previous-1)*100:null;}
function backtestSignals(rows,type,calculationStart){const points=backtestSignalPoints(rows,type),signals=Array(rows.length).fill(null),filter=Array(rows.length).fill(null);
  if(type==="kalman"){const values=kalman2d(points,Math.max(.001,+$("btKalmanQ").value||1),Math.max(.001,+$("btKalmanR").value||25));for(let i=1;i<values.length;i++){filter[i]=values[i];signals[i]=filterSlope(values,i);}return {signals,filter};}
  if(type==="regression"){const window=Math.max(3,+$("btRegressionWindow").value||182);for(let i=Math.max(2,calculationStart);i<points.length;i++){const sample=points.slice(Math.max(0,i-window+1),i+1),fitted=regression(sample,window);filter[i]=fitted.at(-1);signals[i]=filterSlope(fitted,fitted.length-1);}return {signals,filter};}
  if(type==="bollinger"){const window=Math.max(2,+$("btBollingerWindow").value||20),multiple=Math.max(.1,+$("btBollingerStd").value||2),bands=rolling(points.map(p=>p[1]),window,multiple);for(let i=0;i<points.length;i++){const upper=bands.upper[i],lower=bands.lower[i];filter[i]=bands.mid[i];if(Number.isFinite(upper)&&Number.isFinite(lower)&&upper!==lower)signals[i]=(points[i][1]-lower)/(upper-lower)*100;}return {signals,filter,bands};}
  const window=Math.max(10,+$("btWhittakerWindow").value||250),lambda=Math.max(.1,+$("btWhittakerLambda").value||1000),holdout=Math.max(0,Math.floor(+$("btWhittakerHoldout").value||0)),phaseRegression=Array(rows.length).fill(null),phaseDirection=Array(rows.length).fill(null);
  // Strict walk-forward: for the signal on day i, the Whittaker filter and phase
  // regression are estimated only with data available through i-holdout. The fitted
  // phase line is then extrapolated across the held-out trading days to i.
  // This prevents those days (including day i when holdout > 0) from reshaping
  // the smoother or the phase that generated the regression signal.
  for(let i=Math.max(2,calculationStart);i<points.length;i++){
    const fitGlobalEnd=i-holdout;if(fitGlobalEnd<2)continue;
    const first=Math.max(0,fitGlobalEnd-window+1),fitSample=points.slice(first,fitGlobalEnd+1),smooth=whittakerEilers(fitSample,lambda),fitEnd=smooth.length-1;
    filter[i]=smooth.at(-1);
    if(fitEnd<1)continue;
    const pivots=whittakerTurningPoints(smooth,fitEnd);let phaseStart=pivots.length?pivots.at(-1):0;
    if(fitEnd-phaseStart<1&&pivots.length>1)phaseStart=pivots.at(-2);
    if(fitEnd-phaseStart<1)phaseStart=Math.max(0,fitEnd-20);
    if(fitEnd-phaseStart<1)continue;
    const model=linearFitFiltered(fitSample,smooth,phaseStart,fitEnd);if(!model)continue;
    const projectionIndex=fitEnd+(i-fitGlobalEnd),estimate=model.valueAtIndex(projectionIndex);phaseRegression[i]=estimate;phaseDirection[i]=model.slope>=0?1:-1;
    if(Number.isFinite(estimate)&&estimate!==0)signals[i]=(points[i][1]/estimate-1)*100;
  }
  return {signals,filter,phaseRegression,phaseDirection};
}
function compareSignal(value,operator,threshold){if(!Number.isFinite(value))return false;if(operator===">")return value>threshold;if(operator===">=")return value>=threshold;if(operator==="<")return value<threshold;return value<=threshold;}
function runBacktest(rows,signals,type,start){const capital=Math.max(10,+$("btCapital").value||10000),spread=Math.max(0,+$("btSpread").value||0)/20000,buyOperator=$("btBuyOperator").value,buyThreshold=+$("btBuyValue").value||0,sellOperator=$("btSellOperator").value,sellThreshold=+$("btSellValue").value||0;let cash=capital,shares=0,basis=0,taxes=0,fees=0,peak=capital,maxDrawdown=0;const curve=[],trades=[];
  for(let i=start;i<rows.length;i++){const signal=signals[i-1],open=rows[i][1],close=rows[i][4];if(!shares&&compareSignal(signal,buyOperator,buyThreshold)&&cash>1){const ask=open*(1+spread),spend=cash-1;shares=spend/ask;basis=cash;cash=0;fees+=1;trades.push({side:"Kauf",signalDate:rows[i-1][0],date:rows[i][0],price:ask,chartPrice:close,cost:1,tax:0,capital:shares*close});}else if(shares&&compareSignal(signal,sellOperator,sellThreshold)){const bid=open*(1-spread),gross=shares*bid-1,profit=gross-basis,tax=Math.max(0,profit)*.25;cash=gross-tax;taxes+=tax;fees+=1;shares=0;basis=0;trades.push({side:"Verkauf",signalDate:rows[i-1][0],date:rows[i][0],price:bid,chartPrice:close,cost:1,tax,capital:cash});}const equity=cash+shares*close;peak=Math.max(peak,equity);maxDrawdown=Math.min(maxDrawdown,equity/peak-1);curve.push([rows[i][0],equity]);}
  const final=curve.at(-1)?.[1]??capital;return {type,curve,trades,capital,final,returnPct:(final/capital-1)*100,maxDrawdown:maxDrawdown*100,taxes,fees,open:shares>0};
}

function runWhittakerLongOnlyBacktest(rows,computed,start){
  const capital=Math.max(10,+$("wtBtCapital").value||10000),spread=Math.max(0,+$("wtBtSpread").value||0)/20000,buyOperator=$("wtBtBuyOperator").value,buyThreshold=+$("wtBtBuyValue").value||0,sellOperator=$("wtBtSellOperator").value,sellThreshold=+$("wtBtSellValue").value||0;
  let cash=capital,shares=0,basis=0,taxes=0,fees=0,peak=capital,maxDrawdown=0;const curve=[],trades=[];
  for(let i=start;i<rows.length;i++){
    const signalIndex=i-1,signal=computed.signals[signalIndex],eligible=!!computed.eligible[signalIndex],open=rows[i][1],close=rows[i][4];
    if(!shares&&eligible&&compareSignal(signal,buyOperator,buyThreshold)&&cash>1){
      const ask=open*(1+spread),spend=cash-1;shares=spend/ask;basis=cash;cash=0;fees+=1;trades.push({side:"Kauf",signalDate:rows[signalIndex][0],date:rows[i][0],price:ask,chartPrice:close,cost:1,tax:0,capital:shares*close,reason:"Bestätigte grüne Phase"});
    }else if(shares){
      const regimeExit=!eligible,signalExit=eligible&&compareSignal(signal,sellOperator,sellThreshold);
      if(regimeExit||signalExit){
        const bid=open*(1-spread),gross=shares*bid-1,profit=gross-basis,tax=Math.max(0,profit)*.25;cash=gross-tax;taxes+=tax;fees+=1;shares=0;basis=0;trades.push({side:"Verkauf",signalDate:rows[signalIndex][0],date:rows[i][0],price:bid,chartPrice:close,cost:1,tax,capital:cash,reason:regimeExit?"Regime-Exit":"Abweichungssignal"});
      }
    }
    const equity=cash+shares*close;peak=Math.max(peak,equity);maxDrawdown=Math.min(maxDrawdown,equity/peak-1);curve.push([rows[i][0],equity]);
  }
  const final=curve.at(-1)?.[1]??capital;return {type:"whittaker-tools",curve,trades,capital,final,returnPct:(final/capital-1)*100,maxDrawdown:maxDrawdown*100,taxes,fees,open:shares>0};
}
function calculateWhittakerToolsWalkForward(rows,calculationStart){
  const points=backtestSignalPoints(rows,"whittaker"),window=Math.max(20,+$("wtBtWindow").value||250),lambda=Math.max(.1,+$("smoothLambda").value||1000),holdout=Math.max(0,Math.floor(+$("whittakerRegressionHoldout").value||0)),confirmDays=Math.max(1,Math.floor(+$("wtBtConfirmDays").value||5)),minPositivePct=Math.max(0,+$("wtBtMinPositivePct").value||0),signals=Array(rows.length).fill(null),phaseRegression=Array(rows.length).fill(null),phaseDirection=Array(rows.length).fill(null),phaseAge=Array(rows.length).fill(null),phaseGainPct=Array(rows.length).fill(null),confirmed=Array(rows.length).fill(false),eligible=Array(rows.length).fill(false),rawEligible=Array(rows.length).fill(false),activation=Array(rows.length).fill(false),walk=calculateLatchedWhittakerWalkForward(points,points.length-1,{window,lambda,holdout,confirmDays,minPositivePct});
  for(let i=Math.max(2,calculationStart);i<points.length;i++){
    const state=walk.states[i];if(!state)continue;signals[i]=state.signal;phaseRegression[i]=state.estimate;phaseDirection[i]=state.direction;phaseAge[i]=state.phaseAge;phaseGainPct[i]=state.phaseGainPct;confirmed[i]=state.confirmed;rawEligible[i]=state.eligible;eligible[i]=walk.regime[i];activation[i]=walk.activation[i];
  }
  return {points,signals,phaseRegression,phaseDirection,phaseAge,phaseGainPct,confirmed,eligible,rawEligible,activation,window,lambda,holdout,confirmDays,minPositivePct};
}
function renderWhittakerToolsBacktest(){
  const section=$("whittakerToolsBacktest");if(!section||!payload||!$("showWhittaker").checked)return;
  const key=instrumentKey();if(wtSpreadInstrument!==key){$("wtBtSpread").value=DEFAULT_SPREADS[key]??10;wtSpreadInstrument=key;}
  const rows=backtestOhlc();if(rows.length<30){$("wtBacktestChart").innerHTML="<div class='backtest-empty'>Für diesen Stand fehlen ausreichende Tagesdaten.</div>";return;}
  const range=$("wtBtRange").value||"5y",cutoff=rangeStart(rows.at(-1)[0],range),start=Math.max(1,rows.findIndex(row=>row[0]>=cutoff)),window=Math.max(20,+$("wtBtWindow").value||250),holdout=Math.max(0,Math.floor(+$("whittakerRegressionHoldout").value||0)),confirmDays=Math.max(1,Math.floor(+$("wtBtConfirmDays").value||5)),minPositivePct=Math.max(0,+$("wtBtMinPositivePct").value||0),calculationStart=Math.max(2,start-window-holdout-confirmDays-5),computed=calculateWhittakerToolsWalkForward(rows,calculationStart),result=runWhittakerLongOnlyBacktest(rows,computed,start);
  const visible=rows.slice(start),dates=visible.map(row=>new Date(row[0])),signalPoints=computed.points.slice(start),prices=signalPoints.map(point=>point[1]),regression=computed.phaseRegression.slice(start),direction=computed.phaseDirection.slice(start),eligible=computed.eligible.slice(start),phaseAge=computed.phaseAge.slice(start),phaseGain=computed.phaseGainPct.slice(start),signals=computed.signals.slice(start),eligibleRegression=regression.map((value,i)=>eligible[i]&&direction[i]>0?value:null),eligibleSignals=signals.map((value,i)=>eligible[i]?value:null),traces=[{...lineTrace(dates,prices,"Last Price / Tages-Close","#0f172a","solid",1,1.7),hovertemplate:"Kurs: %{y:.4f}<extra></extra>"},{...lineTrace(dates,eligibleRegression,"Bestätigte positive Phasenregression","#16a34a","solid",1,2.4),connectgaps:false,hovertemplate:"Bestätigte Regression: %{y:.4f}<extra></extra>"}];
  for(const side of ["Kauf","Verkauf"]){const selected=result.trades.filter(trade=>trade.side===side),markerY=selected.map(trade=>{const index=rows.findIndex(row=>row[0]===trade.date);return index>=0?computed.points[index][1]:trade.chartPrice;});traces.push({x:selected.map(trade=>new Date(trade.date)),y:markerY,type:"scatter",mode:"markers",name:side,marker:{symbol:side==="Kauf"?"triangle-up":"triangle-down",size:12,color:side==="Kauf"?"#16a34a":"#dc2626",line:{color:"#fff",width:1.1}},customdata:selected.map(trade=>[trade.reason,trade.price]),hovertemplate:`${side}<br>%{x|%d.%m.%Y}<br>%{customdata[0]}<br>Ausführung: %{customdata[1]:.4f}<extra></extra>`});}
  traces.push({x:dates,y:eligibleSignals,type:"bar",name:"Abweichung in bestätigter Phase",showlegend:false,xaxis:"x2",yaxis:"y2",marker:{color:"#16a34a"},customdata:phaseAge.map((age,i)=>[age,phaseGain[i]]),hovertemplate:"Kurs − Regression: %{y:+.3f} %<br>Phasenalter: %{customdata[0]} Tage<br>Phasenanstieg: %{customdata[1]:+.2f} %<extra></extra>"});
  const initial=Math.max(10,+$("wtBtCapital").value||10000),spread=Math.max(0,+$("wtBtSpread").value||0)/20000,firstAsk=visible[0][1]*(1+spread),buyShares=(initial-1)/firstAsk,buyHold=visible.map(row=>[row[0],buyShares*row[4]]);traces.push({...lineTrace(pointDates(result.curve),pointPrices(result.curve),"Strategie nach Kosten/Steuer","#0891b2","solid",3,2.2),hovertemplate:"Strategie: %{y:.2f} €<extra></extra>"},{...lineTrace(pointDates(buyHold),pointPrices(buyHold),"Buy & Hold (offen)","#64748b","dot",3,1.5),hovertemplate:"Buy & Hold: %{y:.2f} €<extra></extra>"});
  const shapes=[{type:"line",xref:"paper",x0:0,x1:1,yref:"y2",y0:0,y1:0,line:{color:"#64748b",width:1}},{type:"line",xref:"paper",x0:0,x1:1,yref:"y2",y0:+$("wtBtBuyValue").value||0,y1:+$("wtBtBuyValue").value||0,line:{color:"#16a34a",width:1,dash:"dot"}},{type:"line",xref:"paper",x0:0,x1:1,yref:"y2",y0:+$("wtBtSellValue").value||0,y1:+$("wtBtSellValue").value||0,line:{color:"#0e7490",width:1,dash:"dot"}}];let regimeStart=null;eligible.forEach((value,i)=>{if(value&&regimeStart===null)regimeStart=dates[i];if(!value&&regimeStart!==null){shapes.push({type:"rect",xref:"x",yref:"paper",x0:regimeStart,x1:dates[i],y0:.52,y1:1,fillcolor:"rgba(22,163,74,.045)",line:{width:0},layer:"below"});regimeStart=null;}});if(regimeStart!==null)shapes.push({type:"rect",xref:"x",yref:"paper",x0:regimeStart,x1:dates.at(-1),y0:.52,y1:1,fillcolor:"rgba(22,163,74,.045)",line:{width:0},layer:"below"});
  const layout={...baseLayout(),height:820,showlegend:true,bargap:.08,margin:{l:62,r:24,t:58,b:42},legend:{orientation:"h",x:0,y:1.07},xaxis:{...axisBase(signalPoints),domain:[0,1],anchor:"y",showticklabels:false,hoverformat:"%d.%m.%Y"},yaxis:{domain:[.52,1],range:paddedRange([prices,eligibleRegression]),tickformat:".3f",showgrid:true,gridcolor:"#f1f5f9"},xaxis2:{...axisBase(signalPoints),domain:[0,1],anchor:"y2",matches:"x",showticklabels:false,hoverformat:"%d.%m.%Y"},yaxis2:{domain:[.31,.45],range:paddedRange([eligibleSignals],true),ticksuffix:" %",tickformat:".3f",showgrid:true,gridcolor:"#f8fafc",zeroline:false},xaxis3:{...axisBase(visible.map(row=>[row[0],row[4]])),domain:[0,1],anchor:"y3",matches:"x",hoverformat:"%d.%m.%Y"},yaxis3:{domain:[0,.23],range:paddedRange([pointPrices(result.curve),pointPrices(buyHold)]),tickformat:",.0f",ticksuffix:" €",showgrid:true,gridcolor:"#f1f5f9"},annotations:[{xref:"paper",yref:"paper",x:0,y:1.02,text:`<b>Long only · Bestätigung wird ab ${confirmDays} Tagen und +${fmt(minPositivePct,1)} % fixiert</b>`,showarrow:false,xanchor:"left"},{xref:"paper",yref:"paper",x:0,y:.47,text:"<b>Kurs − Walk-forward-Phasenregression (%)</b>",showarrow:false,xanchor:"left"},{xref:"paper",yref:"paper",x:0,y:.26,text:"<b>Vermögensentwicklung</b>",showarrow:false,xanchor:"left"}],shapes};
  $("wtBacktestChart").style.height="820px";Plotly.react("wtBacktestChart",traces,layout,PLOT_CONFIG).then(()=>{const graph=plotlyGraph("wtBacktestChart");if(graph)graph.__msciZeroCenteredAxes=["yaxis2"];installVisibleYAutoscale("wtBacktestChart");});
  const tile=(label,value,tone)=>`<div class="metric"><span>${label}</span><strong${tone?` class="${tone}"`:""}>${value}</strong></div>`;$("wtBacktestMetrics").innerHTML=tile("Endkapital",`${fmt(result.final)} €`)+tile("Rendite",pct(result.returnPct),result.returnPct>=0?"positive":"negative")+tile("Max. Drawdown",pct(result.maxDrawdown),"negative")+tile("Ausführungen",result.trades.length)+tile("Bestätigung",`${confirmDays} Tage`)+tile("Mindestanstieg",`${fmt(minPositivePct,1)} %`);
  $("wtBacktestEvaluation").innerHTML=comparisonEvaluationMarkup(pointPrices(result.curve),pointPrices(buyHold),pointDates(result.curve),true);$("wtBacktestTradeRows").innerHTML=result.trades.length?result.trades.map(trade=>`<tr><td>${trade.side}</td><td>${fmtDate(trade.signalDate)}</td><td>${fmtDate(trade.date)}</td><td>${trade.reason}</td><td>${fmt(trade.price,4)} €</td><td>${fmt(trade.tax)} €</td><td>${fmt(trade.capital)} €</td></tr>`).join(""):`<tr><td colspan="7">Keine Trades mit den aktuellen Bestätigungs- und Abweichungsregeln.</td></tr>`;
}
function backtestName(type){return type==="regression"?"Lineare Regression":type==="kalman"?"Kalman-Filter 2D":type==="bollinger"?"Bollinger Bands":"Whittaker–Eilers";}
function btStrategyValue(){return document.querySelector('input[name="btStrategyRadio"]:checked').value;}
function renderBacktestTrades(){const result=backtestResults[btStrategyValue()],body=$("backtestTradeRows");body.innerHTML=result?.trades.length?result.trades.map(trade=>`<tr><td>${trade.side}</td><td>${fmtDate(trade.signalDate)}</td><td>${fmtDate(trade.date)}</td><td>${fmt(trade.price,4)} €</td><td>${fmt(trade.cost)} €</td><td>${fmt(trade.tax)} €</td><td>${fmt(trade.capital)} €</td></tr>`).join(""):`<tr><td colspan="7">Keine Trades für diese Regel.</td></tr>`;}
let conditionsIsBollinger=null;
function syncBacktestControls(){const type=btStrategyValue();document.querySelectorAll(".strategy-settings").forEach(card=>card.classList.toggle("hidden",card.dataset.strategy!==type));$("btStrategyCard").classList.remove("regression-card","bollinger-card","kalman-card","whittaker-card");$("btStrategyCard").classList.add(`${type}-card`);const key=instrumentKey();if(spreadInstrument!==key){$("btSpread").value=DEFAULT_SPREADS[key]??10;spreadInstrument=key;}
  const isBollinger=type==="bollinger",isWhittaker=type==="whittaker";$("btConditionLabel").textContent=isBollinger?"%B (Position im Band)":isWhittaker?"Kurs − Phasenregression (%)":"Filtersteigung in %";
  if(conditionsIsBollinger!==isBollinger){$("btBuyOperator").value=isBollinger?"<":">";$("btBuyValue").value=isBollinger?20:0;$("btSellOperator").value=isBollinger?">":"<";$("btSellValue").value=isBollinger?80:0;conditionsIsBollinger=isBollinger;}}
function renderBacktest(){
  if(!payload)return;syncBacktestControls();const rows=backtestOhlc();if(rows.length<3){$("backtestChart").innerHTML="<div class='backtest-empty'>Für dieses Instrument fehlen noch Tages-OHLC-Daten.</div>";return;}
  const type=btStrategyValue(),isWhittaker=type==="whittaker",color=type==="regression"?"#7c3aed":type==="bollinger"?"#2563eb":type==="kalman"?"#db2777":"#0891b2",cutoff=rangeStart(rows.at(-1)[0],backtestRange),start=Math.max(1,rows.findIndex(row=>row[0]>=cutoff)),window=type==="regression"?Math.max(3,+$("btRegressionWindow").value||182):isWhittaker?Math.max(10,+$("btWhittakerWindow").value||250):type==="bollinger"?Math.max(2,+$("btBollingerWindow").value||20):20,calculationStart=Math.max(1,start-window-2),computed=backtestSignals(rows,type,calculationStart),result=runBacktest(rows,computed.signals,type,start);backtestResults={[type]:result};
  const visible=rows.slice(start),signalPoints=backtestSignalPoints(rows,type).slice(start),dates=visible.map(row=>new Date(row[0])),prices=signalPoints.map(point=>point[1]),filter=computed.filter.slice(start),phaseRegression=isWhittaker?computed.phaseRegression.slice(start):[],phaseDirection=isWhittaker?computed.phaseDirection.slice(start):[],signalBars=computed.signals.slice(start),bandExtras=type==="bollinger"?[computed.bands.upper.slice(start),computed.bands.lower.slice(start)]:[],priceLabel=isWhittaker?"Last Price / Tages-Close":"Adjusted Close",traces=[{...lineTrace(dates,prices,priceLabel,"#0f172a","solid",1,1.8),hovertemplate:`${priceLabel}: %{y:.4f}<extra></extra>`}];
  if(type==="bollinger"){
    traces.push({...lineTrace(dates,bandExtras[0],"Bollinger Upper","#60a5fa","dot",1,1.2),hoverinfo:"skip"},{...lineTrace(dates,bandExtras[1],"Bollinger Lower","#60a5fa","dot",1,1.2),hoverinfo:"skip",fill:"tonexty",fillcolor:"rgba(59,130,246,.08)"},{...lineTrace(dates,filter,"Bollinger Mittelwert",color,"solid",1,1.4),hoverinfo:"skip"});
  }else if(isWhittaker){
    let segmentX=[],segmentY=[],segmentDirection=null;
    const flush=()=>{if(segmentX.length>=2){const direction=segmentDirection>=0?1:-1,segmentColor=direction>0?"#16a34a":"#dc2626";traces.push({...lineTrace(segmentX,segmentY,`${direction>0?"Grüne":"Rote"} Walk-forward-Phasenregression`,segmentColor,"solid",1,2.35),showlegend:false,hovertemplate:"Walk-forward-Phasenregression: %{y:.4f}<extra></extra>"});}segmentX=[];segmentY=[];segmentDirection=null;};
    for(let i=0;i<phaseRegression.length;i++){
      const value=phaseRegression[i],direction=phaseDirection[i];
      if(!Number.isFinite(value)||!Number.isFinite(direction)){flush();continue;}
      if(segmentDirection===null){segmentDirection=direction;segmentX=[dates[i]];segmentY=[value];continue;}
      if(direction===segmentDirection){segmentX.push(dates[i]);segmentY.push(value);continue;}
      const previousX=segmentX.at(-1),previousY=segmentY.at(-1);flush();segmentDirection=direction;segmentX=[previousX,dates[i]];segmentY=[previousY,value];
    }
    flush();
  }else{
    traces.push({...lineTrace(dates,filter,backtestName(type),color,"solid",1,2.2),hovertemplate:"Filterstand: %{y:.4f}<extra></extra>"});
  }
  for(const side of ["Kauf","Verkauf"]){const selected=result.trades.filter(trade=>trade.side===side);traces.push({x:selected.map(trade=>new Date(trade.date)),y:selected.map(trade=>trade.price),type:"scatter",mode:"markers",name:side,marker:{symbol:side==="Kauf"?"triangle-up":"triangle-down",size:12,color:side==="Kauf"?"#16a34a":"#dc2626",line:{color:"#fff",width:1.2}},hovertemplate:`${side} am nächsten Open<br>%{x|%d.%m.%Y}<br>Ausführung: %{y:.4f}<extra></extra>`});}
  const initial=Math.max(10,+$("btCapital").value||10000),spread=Math.max(0,+$("btSpread").value||0)/20000,firstAsk=visible[0][1]*(1+spread),buyShares=(initial-1)/firstAsk,buyHold=visible.map(row=>[row[0],buyShares*row[4]]),wealthAxis=isWhittaker?3:2;
  if(isWhittaker)traces.push({x:dates,y:signalBars,type:"bar",name:"Kursabstand zur Phasenregression",showlegend:false,xaxis:"x2",yaxis:"y2",marker:{color:signalBars.map(value=>Number.isFinite(value)&&value>=0?"#16a34a":"#dc2626")},hovertemplate:"Kurs − Phasenregression: %{y:+.3f} %<extra></extra>"});
  traces.push({...lineTrace(pointDates(result.curve),pointPrices(result.curve),"Strategie nach Kosten/Steuer",color,"solid",wealthAxis,2.2),hovertemplate:"Strategie: %{y:.2f} €<extra></extra>"},{...lineTrace(pointDates(buyHold),pointPrices(buyHold),"Buy & Hold (offen)","#64748b","dot",wealthAxis,1.5),hovertemplate:"Buy & Hold: %{y:.2f} €<extra></extra>"});
  const height=isWhittaker?820:650,priceDomain=isWhittaker?[.52,1]:[.38,1],wealthDomain=isWhittaker?[0,.23]:[0,.27],wealthAnnotationY=isWhittaker?.26:.3,priceRangeValues=isWhittaker?[prices,phaseRegression]:[prices,filter,...bandExtras],layout={...baseLayout(),height,showlegend:true,bargap:.08,margin:{l:62,r:24,t:58,b:42},legend:{orientation:"h",x:0,y:1.07},xaxis:{...axisBase(signalPoints),domain:[0,1],anchor:"y",showticklabels:false,hoverformat:"%d.%m.%Y"},yaxis:{domain:priceDomain,range:paddedRange(priceRangeValues),tickformat:".3f",showgrid:true,gridcolor:"#f1f5f9"},annotations:[{xref:"paper",yref:"paper",x:0,y:1.02,text:`<b>${isWhittaker?`Last Price & Walk-forward-Phasenregression`:"Kurs, damaliger Filterstand und Ausführungen"}</b>`,showarrow:false,xanchor:"left"},{xref:"paper",yref:"paper",x:0,y:wealthAnnotationY,text:"<b>Vermögensentwicklung</b>",showarrow:false,xanchor:"left"}],shapes:[]};
  if(isWhittaker){
    layout.xaxis2={...axisBase(signalPoints),domain:[0,1],anchor:"y2",matches:"x",showticklabels:false,hoverformat:"%d.%m.%Y"};layout.yaxis2={domain:[.31,.45],range:paddedRange([signalBars],true),ticksuffix:" %",tickformat:".3f",showgrid:true,gridcolor:"#f8fafc",zeroline:false};layout.annotations.push({xref:"paper",yref:"paper",x:0,y:.47,text:"<b>Kurs − Walk-forward-Phasenregression (%)</b>",showarrow:false,xanchor:"left"});layout.shapes.push({type:"line",xref:"paper",x0:0,x1:1,yref:"y2",y0:0,y1:0,line:{color:"#64748b",width:1}},{type:"line",xref:"paper",x0:0,x1:1,yref:"y2",y0:+$("btBuyValue").value||0,y1:+$("btBuyValue").value||0,line:{color:"#16a34a",width:1,dash:"dot"}},{type:"line",xref:"paper",x0:0,x1:1,yref:"y2",y0:+$("btSellValue").value||0,y1:+$("btSellValue").value||0,line:{color:"#dc2626",width:1,dash:"dot"}});layout.xaxis3={...axisBase(visible.map(row=>[row[0],row[4]])),domain:[0,1],anchor:"y3",matches:"x",hoverformat:"%d.%m.%Y"};layout.yaxis3={domain:wealthDomain,range:paddedRange([pointPrices(result.curve),pointPrices(buyHold)]),tickformat:",.0f",ticksuffix:" €",showgrid:true,gridcolor:"#f1f5f9"};
  }else{
    layout.xaxis2={...axisBase(visible.map(row=>[row[0],row[4]])),domain:[0,1],anchor:"y2",matches:"x",hoverformat:"%d.%m.%Y"};layout.yaxis2={domain:wealthDomain,range:paddedRange([pointPrices(result.curve),pointPrices(buyHold)]),tickformat:",.0f",ticksuffix:" €",showgrid:true,gridcolor:"#f1f5f9"};
  }
  $("backtestChart").style.height=`${height}px`;$("backtestChart").style.minHeight=`${height}px`;Plotly.react("backtestChart",traces,layout,PLOT_CONFIG).then(()=>{const graph=plotlyGraph("backtestChart");if(graph)graph.__msciZeroCenteredAxes=isWhittaker?["yaxis2"]:[];installVisibleYAutoscale("backtestChart");});
  const tile=(label,value,tone)=>`<div class="metric"><span>${label}</span><strong${tone?` class="${tone}"`:""}>${value}</strong></div>`;$('backtestMetrics').innerHTML=tile("Endkapital",`${fmt(result.final)} €`)+tile("Rendite",pct(result.returnPct),result.returnPct>=0?"positive":"negative")+tile("Max. Drawdown",pct(result.maxDrawdown),"negative")+tile("Ausführungen",result.trades.length)+tile("Gebühren",`${fmt(result.fees)} €`)+tile("Steuer",`${fmt(result.taxes)} €`)+(result.open?`<p class="backtest-note">Position am Ende offen; darauf noch keine Steuer.</p>`:"");
  $("backtestEvaluation").innerHTML=comparisonEvaluationMarkup(pointPrices(result.curve),pointPrices(buyHold),pointDates(result.curve),true);renderBacktestTrades();
}
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
function renderAll(){ if(!payload)return; const inst=currentInstrument(); $("instrumentMeta").textContent=`${inst.name} · ISIN ${inst.isin} · Yahoo ${inst.ticker} · Trading Tools: Tagesdaten + aktuellster Intraday-Wert · Whittaker: Simulation/Backtest direkt unter Trading Tools · Trading Analytics: 5-Minuten-Daten`; renderTools(); renderAnalytics(); history.replaceState(null,"",`?instrument=${encodeURIComponent(instrumentKey())}`); }
function ranges(containerId,options,get,set){ const root=$(containerId); root.innerHTML=""; for(const [label,value] of options){ const b=document.createElement("button"); b.className=`range-button ${get()===value?"active":""}`; b.textContent=label;b.onclick=()=>{set(value);ranges(containerId,options,get,set);renderAll();};root.appendChild(b); } }
function configureRanges(){ ranges("toolRanges",RANGE_OPTIONS,()=>toolRange,v=>toolRange=v);ranges("analyticsRanges",ANALYTICS_RANGE_OPTIONS,()=>analyticsRange,v=>analyticsRange=v); }
async function fetchData(manual=false){ $("reload").disabled=true;try{const response=await fetch(`data/dashboard.json?v=${Date.now()}`,{cache:"no-store"});if(!response.ok)throw Error(response.status);payload=await response.json();localStorage.setItem("msci-world-last-data",JSON.stringify(payload));$("notice").style.display="none";initializeInstrument();$("updated").textContent=`Stand ${new Date(payload.updated_at).toLocaleString("de-DE")} · automatische Aktualisierung stündlich`;if(manual)$("settingsMessage").textContent="Der neueste auf GitHub Pages veröffentlichte Datenstand wurde geladen.";renderAll();}catch(error){const cached=localStorage.getItem("msci-world-last-data");if(cached){payload=JSON.parse(cached);initializeInstrument();$("updated").textContent=`Gespeicherter Datenstand ${new Date(payload.updated_at).toLocaleString("de-DE")}`;$("notice").textContent="Offline: letzter gespeicherter Datenstand wird angezeigt.";$("notice").style.display="block";renderAll();}else{$("updated").textContent="Kein Datenstand verfügbar";$("notice").textContent=`Daten konnten nicht geladen werden (${error.message}).`;$('notice').style.display="block";}}finally{$("reload").disabled=false;}}
async function fetchGitHubVersion(){try{const response=await fetch(`data/build-info.json?v=${Date.now()}`,{cache:"no-store"});if(!response.ok)throw Error(response.status);const info=await response.json(),date=new Date(info.deployed_at),stamp=Number.isNaN(date.getTime())?info.deployed_at:date.toLocaleString("de-DE",{dateStyle:"medium",timeStyle:"medium"});$("githubVersion").textContent=`GitHub-Version: ${stamp}${info.commit?` · ${info.commit}`:""}`;}catch{$("githubVersion").textContent="GitHub-Version: nicht verfügbar";}}
function initializeInstrument(){ const old=instrumentKey(), requested=new URLSearchParams(location.search).get("instrument"), select=$("instrument");select.innerHTML="";for(const[key,inst]of Object.entries(payload.instruments)){const option=document.createElement("option");option.value=key;option.textContent=inst.name;select.appendChild(option);}select.value=payload.instruments[old]?old:payload.instruments[requested]?requested:Object.keys(payload.instruments)[0]; }

$("instrument").onchange=()=>{stopWhittakerSimulation(false);selectedTrade=null;wtSpreadInstrument=null;renderAll();}; $("reload").onclick=()=>{if(confirm("Veröffentlichten Kursdatenstand jetzt neu laden?"))fetchData(true);};
for(const id of PARAM_IDS) $(id).addEventListener("input",()=>{if(id==="showWhittaker"&&!$("showWhittaker").checked){stopWhittakerSimulation(false);whittakerSimulationMode=false;whittakerSimulationStartTimestamp=null;if($("whittakerAsOfDate"))$("whittakerAsOfDate").value="";}renderTools();});
$("whittakerAsOfDate").addEventListener("change",()=>{stopWhittakerSimulation(false);const points=whittakerSimulationDates(),value=$("whittakerAsOfDate").value;if(value&&points.length){const limit=Date.parse(`${value}T23:59:59.999Z`);let index=points.findLastIndex(point=>point[0]<=limit);if(index<0)index=+$("whittakerSimSlider").min||2;setWhittakerSimulationIndex(index,true);}else resetWhittakerSimulation();});
$("whittakerAsOfNow").onclick=()=>resetWhittakerSimulation();
$("whittakerSimPlay").onclick=startWhittakerSimulation;
$("whittakerSimPause").onclick=()=>stopWhittakerSimulation(true);
$("whittakerSimReset").onclick=resetWhittakerSimulation;
$("whittakerSimSlider").addEventListener("input",()=>{stopWhittakerSimulation(false);setWhittakerSimulationIndex(+$("whittakerSimSlider").value,true);});
for(const id of WT_BT_IDS){const control=$(id);if(control)control.addEventListener("input",()=>{clearTimeout(whittakerToolsBacktestTimer);whittakerToolsBacktestTimer=setTimeout(()=>{renderWhittakerSimulationGraph();renderWhittakerToolsBacktest();},50);});}
$("saveDefaults").onclick=()=>{ const values={};for(const id of PARAM_IDS)values[id]=$(id).type==="checkbox"?$(id).checked:$(id).value;localStorage.setItem("msci-world-defaults",JSON.stringify(values));$("settingsMessage").textContent="Parameter wurden als Standardwerte für diesen Browser gespeichert.";};
document.querySelectorAll(".tab").forEach(button=>button.onclick=()=>{activeTab=button.dataset.tab;document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b===button));$("toolsTab").classList.toggle("hidden",activeTab!=="tools");$("analyticsTab").classList.toggle("hidden",activeTab!=="analytics");setTimeout(()=>{if(activeTab==="tools"){Plotly.Plots.resize("toolsChart");const sim=plotlyGraph("whittakerSimulationChart"),wt=plotlyGraph("wtBacktestChart");if(sim)Plotly.Plots.resize(sim);if(wt)Plotly.Plots.resize(wt);}else Plotly.Plots.resize("analyticsChart");},0);});
$("addTrade").onclick=()=>{$("entryDate").value=new Date().toISOString().slice(0,10);$("modalTradeMessage").textContent="";$("tradeDialog").showModal();};$("cancelTrade").onclick=$("closeTrade").onclick=()=>$("tradeDialog").close();
$("tradeForm").onsubmit=event=>{event.preventDefault();const entry=nearestPrice($("entryDate").value),exit=$("exitDate").value?nearestPrice($("exitDate").value):null;if(exit&&exit[0]<entry[0]){$("modalTradeMessage").textContent="Das Exit-Datum darf nicht vor dem Entry-Datum liegen.";return;}const trades=loadTrades(),id=Math.max(0,...trades.map(t=>t.id))+1;trades.push({id,entryDate:new Date(entry[0]).toISOString(),exitDate:exit?new Date(exit[0]).toISOString():null,entryPrice:$("entryPrice").value?+$("entryPrice").value:entry[1],exitPrice:$("exitPrice").value?+$("exitPrice").value:exit?exit[1]:null,fees:+$("fees").value||0,notes:$("notes").value});saveTrades(trades);$("tradeDialog").close();$("tradeForm").reset();$("tradeMessage").textContent=`Trade ${id} gespeichert.`;renderTools();renderAnalytics();};
$("deleteTrade").onclick=()=>{if(!selectedTrade)return;if(confirm(`Trade ${selectedTrade} wirklich löschen?`)){saveTrades(loadTrades().filter(t=>t.id!==selectedTrade));selectedTrade=null;renderTools();renderAnalytics();}};
configureRanges();fetchGitHubVersion();fetchData();
