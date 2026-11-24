const locationHistoryKey='urbansales.bincheck.completed-locations';
let completedLocations=[],locationHistoryError=false,locationHistoryExpanded=false;
let locationHistoryFrame=null;
function mergeCompletedLocation(entries,location,checkedAt){
 if(typeof location!=='string'||!location.trim()||location.length>80||typeof checkedAt!=='string'||!Number.isFinite(Date.parse(checkedAt)))return entries;
 const normalized=location.trim().toUpperCase(),previous=entries.find(e=>e.location===normalized);
 if(previous&&Date.parse(previous.checkedAt)>=Date.parse(checkedAt))return entries;
 return [...entries.filter(e=>e.location!==normalized),{location:normalized,checkedAt}].sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt)||a.location.localeCompare(b.location));
}
function saveLocationHistory(entries){try{localStorage.setItem(locationHistoryKey,JSON.stringify(entries));completedLocations=entries;locationHistoryError=false;}catch{completedLocations=entries;locationHistoryError=true;}}
function rememberCompletedLocation(task){if(task?.phase!=='finished'||task.recheckRequired)return;saveLocationHistory(mergeCompletedLocation(completedLocations,task.location,task.checkedAt));}
function initializeLocationHistory(){
 $('location-history-toggle').onclick=()=>{locationHistoryExpanded=!locationHistoryExpanded;updateLocationHistoryExpansion();};
 window.addEventListener('resize',scheduleLocationHistoryExpansion);
 try{const raw=localStorage.getItem(locationHistoryKey),entries=raw?JSON.parse(raw):[];if(!Array.isArray(entries))throw Error('Invalid history');for(const entry of entries)completedLocations=mergeCompletedLocation(completedLocations,entry?.location,entry?.checkedAt);}catch{locationHistoryError=true;return;}
 // Recover available completed checks from this browser, never from other devices.
 for(const entry of reportQueue)completedLocations=mergeCompletedLocation(completedLocations,entry?.payload?.location,entry?.payload?.checkedAt);
 rememberCompletedLocation(session);
 saveLocationHistory(completedLocations);
}
function renderLocationHistory(){
 $('completed-locations-label').textContent='本机已核对 '+completedLocations.length+' 个库位';const list=$('completed-locations');list.textContent='';
 if(!completedLocations.length){list.append(text('span',localize('暂无已核对库位'),'completed-empty'));}else for(const entry of completedLocations){const item=text('span',entry.location,'completed-location');item.title=localize('最近完成核对：')+date(entry.checkedAt);list.append(item);}
 $('location-history-error').hidden=!locationHistoryError;
 scheduleLocationHistoryExpansion();
}

function scheduleLocationHistoryExpansion(){if(locationHistoryFrame!==null)cancelAnimationFrame(locationHistoryFrame);locationHistoryFrame=requestAnimationFrame(()=>{locationHistoryFrame=null;updateLocationHistoryExpansion();});}
function updateLocationHistoryExpansion(){
 const list=$('completed-locations'),button=$('location-history-toggle'),style=getComputedStyle(list);
 const collapsedHeight=2*parseFloat(style.lineHeight)+parseFloat(style.rowGap||'0');
 // Compare content height to two text rows even while expanded.
 const overflowing=list.scrollHeight>collapsedHeight+1;
 if(!overflowing)locationHistoryExpanded=false;
 list.classList.toggle('expanded',locationHistoryExpanded);
 button.hidden=!overflowing;
 button.setAttribute('aria-expanded',String(locationHistoryExpanded));
 $('location-history-toggle-label').textContent=locationHistoryExpanded?'收起':'展开';
}
