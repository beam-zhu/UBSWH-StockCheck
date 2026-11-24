import { isInventorySku,units,format,results,otherLocationHint,normalizeBaselineOverride,baselineCSVHeaders,baselineCSVValues,type BaselineOverride,type Session } from './checker.ts';
export type ReportProfile={operator:string;deviceId:string;deviceName:string};
export type ReportRow={baseline?:BaselineOverride;sku:string;label:string;expected:string;actual:string;diff:string;status:string;note:string;referenceFetchedAt:string;referenceVersion:string};
export type ReportPayload={schemaVersion:1;location:string;operator:string;deviceId:string;deviceName:string;round:number;startedAt:string;checkedAt:string;snapshot:{fetchedAt:string;version:string;quantityBasis:string};rows:ReportRow[]};
function field(value:unknown,name:string,max:number,empty=false):string{if(typeof value!=='string'||value.length>max||/[\u0000-\u001f]/.test(value)||(!empty&&!value.trim()))throw Error(`Invalid ${name}`);return value.trim();}
function iso(value:unknown,name:string):string{const s=field(value,name,64);if(!Number.isFinite(Date.parse(s)))throw Error(`Invalid ${name}`);return new Date(s).toISOString();}
export function normalizeReport(raw:any):ReportPayload{
 if(!raw||raw.schemaVersion!==1)throw Error('Unsupported report version');
 const location=field(raw.location,'location',80).toUpperCase(),operator=field(raw.operator,'operator',80),deviceId=field(raw.deviceId,'device ID',64),deviceName=field(raw.deviceName,'device name',80);
 if(!/^d_[a-f0-9]{32}$/.test(deviceId))throw Error('Invalid device ID');if(!Number.isInteger(raw.round)||raw.round<1||raw.round>10000)throw Error('Invalid round');
 if(!Array.isArray(raw.rows)||raw.rows.length<1||raw.rows.length>2000)throw Error('Invalid report rows');
 const seen=new Set<string>();const rows:ReportRow[]=raw.rows.map((r:any)=>{
  const sku=field(r?.sku,'SKU',256);if(!isInventorySku(sku)||seen.has(sku))throw Error('Invalid or duplicate report SKU');seen.add(sku);
  const expected=format(units(field(r.expected,'expected quantity',32))),actual=r.actual===''?'':format(units(field(r.actual,'counted quantity',32)));
  const baseline=r.baseline===undefined?undefined:normalizeBaselineOverride(r.baseline);if(baseline&&baseline.bin.toUpperCase()!==location)throw Error('Baseline location does not match report');if(baseline&&baseline.quantity!==expected)throw Error('Baseline does not match expected quantity');const e=units(expected),a=units(actual||'0');if(!e&&!a&&!(baseline?.quantity==='0'&&baseline.zeroConfirmed&&actual==='0'))throw Error('Empty report row');
  const status=actual===''?'漏扫':baseline?(e===a?'一致':'数量不符'):e===0n?'多出':e===a?'一致':'数量不符';
  return {sku,label:field(r.label,'full SKU',256),expected,actual,diff:format(a-e),status,note:status==='一致'?'':field(r.note??'','note',12000,true),referenceFetchedAt:status==='一致'?'':field(r.referenceFetchedAt??'','reference time',64,true),referenceVersion:status==='一致'?'':field(r.referenceVersion??'','reference version',128,true),...(baseline?{baseline}:{})};
 }).sort((a:ReportRow,b:ReportRow)=>a.sku.localeCompare(b.sku,undefined,{numeric:true}));
 return {schemaVersion:1,location,operator,deviceId,deviceName,round:raw.round,startedAt:iso(raw.startedAt,'start time'),checkedAt:iso(raw.checkedAt,'check time'),snapshot:{fetchedAt:iso(raw.snapshot?.fetchedAt,'baseline time'),version:field(raw.snapshot?.version,'baseline version',128),quantityBasis:field(raw.snapshot?.quantityBasis,'quantity basis',80)},rows};
}
export function makeReport(s:Session,profile:ReportProfile):ReportPayload{
 if(s.recheckRequired)throw Error('首次核对有差异，请再次完成核对后上传。');
 if(s.phase!=='finished'||!s.checkedAt)throw Error('请先完成本轮核对，再上传报告。');
 return normalizeReport({schemaVersion:1,location:s.location,...profile,round:s.round,startedAt:s.startedAt,checkedAt:s.checkedAt,snapshot:s.snapshot,rows:results(s).map(r=>({...r,...(s.baselineOverrides?.[r.sku]?{baseline:s.baselineOverrides[r.sku]}:{}),note:r.status==='一致'?'':otherLocationHint(s,r.sku),referenceFetchedAt:s.reference?.fetchedAt??'',referenceVersion:s.reference?.version??''}))});
}
export function canonicalJSON(value:any):string{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonicalJSON).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJSON(value[k])).join(',')+'}';}
export async function reportId(p:ReportPayload):Promise<string>{const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJSON(p)));return 'r_'+[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function reportSummary(p:ReportPayload){return {missing:p.rows.filter(r=>r.status==='漏扫').length,extra:p.rows.filter(r=>r.status==='多出').length,mismatch:p.rows.filter(r=>r.status==='数量不符').length,matched:p.rows.filter(r=>r.status==='一致').length,expectedTotal:format(p.rows.reduce((n,r)=>n+units(r.expected),0n)),countedTotal:format(p.rows.reduce((n,r)=>n+units(r.actual||'0'),0n))};}
export function cloudReportCSV(p:ReportPayload,id:string,receivedAt:string):string{
 const rows:unknown[][]=[['库位','数字SKU','完整SKU','基准数量','实点数量','差异','结果','轮次','数量口径','基准读取时间','版本','状态','备注（其他库位）','备注参考读取时间','备注参考版本','报告编号','操作者','扫描器名称','设备编号','云端接收时间',...baselineCSVHeaders]];
 for(const r of p.rows)rows.push([p.location,r.sku,r.label,r.expected,r.actual,r.diff,r.status,p.round,r.baseline?'Cin7 · Available':p.snapshot.quantityBasis,r.baseline?.fetchedAt??p.snapshot.fetchedAt,r.baseline?'cin7@'+r.baseline.fetchedAt:p.snapshot.version,'finished',r.note,r.referenceFetchedAt,r.referenceVersion,id,p.operator,p.deviceName,p.deviceId,receivedAt,...baselineCSVValues(r.baseline,r.expected,p.snapshot)]);
 const cell=(v:unknown)=>{let s=String(v??'');if(/^[=+@\t\r]/.test(s)||(/^\-/.test(s)&&!/^\-\d+(\.\d+)?$/.test(s)))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
}
