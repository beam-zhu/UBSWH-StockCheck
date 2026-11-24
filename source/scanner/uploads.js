const uploadProfileKey='urbansales.report.profile',uploadQueueKey='urbansales.report.queue';
let reportProfile=null,reportQueue=[],uploadBusy=false,lastUploadError='',uploadQueueError=false;
function newDeviceId(){const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return 'd_'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
function currentReportKey(){if(!session||session.phase!=='finished'||session.recheckRequired||!reportProfile?.operator)return '';return canonicalJSON({startedAt:session.startedAt,checkedAt:session.checkedAt,round:session.round,scanned:session.scanned,...(session.baselineOverrides?{baselineOverrides:session.baselineOverrides}:{}),profile:reportProfile});}
function saveUploadQueue(queue){if(uploadQueueError)return false;try{localStorage.setItem(uploadQueueKey,JSON.stringify(queue));reportQueue=queue;return true;}catch{lastUploadError='本机待上传报告保存失败，请先导出报告并检查存储空间。';updateUploadStatus();return false;}}
function updateUploadStatus(){
 const panel=document.getElementById('cloud-report');if(!panel)return;panel.hidden=!session;if(!session)return;
 const key=currentReportKey(),entry=key?reportQueue.find(e=>e.taskKey===key):null,pendingCount=reportQueue.filter(e=>e.status==='queued').length;
 $('upload-report').disabled=session.phase!=='finished'||session.recheckRequired||uploadBusy||!!storageError||uploadQueueError;
 $('upload-profile-button').textContent=reportProfile?.operator?reportProfile.operator+' / '+reportProfile.deviceName:'设置操作者 / 扫描器名称';
 $('upload-queue-note').textContent=pendingCount?'本机有 '+pendingCount+' 份报告待上传，网络恢复后将自动重试。':'';
 $('upload-queue-note').hidden=!pendingCount;$('upload-retry').hidden=!pendingCount;$('upload-retry').disabled=uploadBusy;
 if(session.recheckRequired){$('upload-status').textContent='首次核对有差异，尚未上传。请复核差异后再次完成核对。';$('upload-status').className='upload-status upload-error';$('upload-report').textContent='等待再次核对';}
 else if(uploadBusy){$('upload-status').textContent='正在上传报告…';$('upload-status').className='upload-status';}
 else if(entry?.status==='sent'){$('upload-status').textContent='报告已上传 · '+date(entry.receivedAt);$('upload-status').className='upload-status uploaded';$('upload-report').textContent='✓ 已上传，再次检查';}
 else if(entry||lastUploadError){$('upload-status').textContent=lastUploadError||'报告已保存在本机，等待上传。';$('upload-status').className='upload-status upload-error';$('upload-report').textContent='↑ 上传 / 重试';}
 else{$('upload-status').textContent=session.phase==='finished'?'完成的报告可以上传到 PC 管理端。':'完成本轮核对后将上传报告，已有扫描记录仍保留在本机。';$('upload-status').className='upload-status';$('upload-report').textContent='↑ 上传报告';}
 const summary=$('report-summary-status');summary.textContent=session.recheckRequired?'等待复核':entry?.status==='sent'?'已上传':entry?'待上传':session.phase==='scanning'?'本机保存':'等待上传';summary.className=entry?.status==='sent'?'uploaded':session.recheckRequired||lastUploadError?'upload-error':'';
}
function showReportProfile(){clearTimeout(scanTimer);profileOpen=true;$('report-profile-modal').hidden=false;$('report-operator').value=reportProfile?.operator||'';$('report-device').value=reportProfile?.deviceName||'';$('report-profile-error').hidden=true;document.body.style.overflow='hidden';$('report-operator').focus();}
function closeReportProfile(){profileOpen=false;$('report-profile-modal').hidden=true;document.body.style.overflow=pending||helpOpen||invalidOpen?'hidden':'';focusScanner();}
async function saveReportProfile(){const operator=$('report-operator').value.trim(),deviceName=$('report-device').value.trim();if(!operator||!deviceName){$('report-profile-error').textContent='请填写操作者和扫描器名称。';$('report-profile-error').hidden=false;return;}
 const profile={operator,deviceName,deviceId:reportProfile?.deviceId||newDeviceId()};if(operator.length>80||deviceName.length>80){$('report-profile-error').textContent='名称不能超过 80 个字符。';$('report-profile-error').hidden=false;return;}
 try{localStorage.setItem(uploadProfileKey,JSON.stringify(profile));reportProfile=profile;}catch{$('report-profile-error').textContent='设置保存失败，请检查设备存储空间。';$('report-profile-error').hidden=false;return;}
 closeReportProfile();updateUploadStatus();if(session?.phase==='finished')await uploadCurrentReport();
}
async function uploadCurrentReport(){if(!session||session.phase!=='finished'||session.recheckRequired||uploadBusy||uploadQueueError)return;if(!reportProfile?.operator||!reportProfile?.deviceName){showReportProfile();return;}
 try{const payload=makeReport(session,reportProfile),taskKey=currentReportKey(),id=await reportId(payload);let entry=reportQueue.find(e=>e.id===id);
  if(!entry){const queued=reportQueue.filter(e=>e.status==='queued');if(queued.length>=100)throw Error('待上传报告已达 100 份，请先恢复网络完成上传。');const sent=reportQueue.filter(e=>e.status==='sent').slice(-50);entry={id,payload,taskKey,status:'queued'};if(!saveUploadQueue([...sent,...queued,entry]))return;}
  lastUploadError='';updateUploadStatus();if(entry.status==='sent')return;await flushReports();
 }catch(e){lastUploadError=e.message||'报告上传失败，请稍后重试。';updateUploadStatus();}
}
async function flushReports(){if(uploadBusy||!reportQueue.some(e=>e.status==='queued'))return;uploadBusy=true;updateUploadStatus();try{
 const configAbort=new AbortController(),configTimer=setTimeout(()=>configAbort.abort(),30000);let config,setup;try{config=await fetch('/api/upload-config',{cache:'no-store',signal:configAbort.signal});setup=await config.json();}finally{clearTimeout(configTimer);}if(!config.ok||!setup.enabled)throw Error('云端报告服务尚未就绪，请稍后重试。');
 for(const entry of [...reportQueue].filter(e=>e.status==='queued')){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);let response,receipt;try{response=await fetch('/api/upload-report',{method:'POST',headers:{'Content-Type':'application/json','X-Scanner-Upload':'1'},body:JSON.stringify({id:entry.id,payload:entry.payload}),signal:controller.signal});receipt=await response.json();}finally{clearTimeout(timer);}
  if(!response.ok||!receipt.ok||receipt.id!==entry.id)throw Error(receipt.error||'报告上传失败，请稍后重试。');
  const next=reportQueue.map(e=>e.id===entry.id?{...e,status:'sent',receivedAt:receipt.receivedAt}:e);if(!saveUploadQueue(next))throw Error('上传回执未能保存在本机，稍后重试不会重复生成报告。');lastUploadError='';
 }
 }catch(e){lastUploadError=e.name==='AbortError'?'上传超时，报告仍保留在本机，稍后将重试。':e.message||'报告上传失败，请检查网络。';}finally{uploadBusy=false;updateUploadStatus();}}
function initializeUploads(){try{const saved=localStorage.getItem(uploadProfileKey);if(saved)reportProfile=JSON.parse(saved);if(!reportProfile?.deviceId){const deviceId=newDeviceId();reportProfile={operator:'',deviceId,deviceName:'DT50-'+deviceId.slice(2,8)};localStorage.setItem(uploadProfileKey,JSON.stringify(reportProfile));}const queue=localStorage.getItem(uploadQueueKey);reportQueue=queue?JSON.parse(queue):[];if(!Array.isArray(reportQueue))throw Error('Invalid queue');}catch{lastUploadError='未能恢复上传设置或待上传报告，请保留浏览器数据。';uploadQueueError=true;reportQueue=[];}
 $('upload-report').onclick=uploadCurrentReport;$('upload-retry').onclick=flushReports;$('upload-profile-button').onclick=showReportProfile;$('save-report-profile').onclick=saveReportProfile;$('cancel-report-profile').onclick=closeReportProfile;
 window.addEventListener('online',()=>void flushReports());setInterval(()=>void flushReports(),60000);updateUploadStatus();if(reportQueue.some(e=>e.status==='queued'))void flushReports();}
