export type Inventory = { data: Record<string, Record<string,string>>; labels: Record<string,string>; issues: Record<string,string[]>; notes: string[]; fetchedAt: string; version: string; quantityBasis: string };
export type StockReference = { bySku: Record<string,Record<string,string>>; issues: Record<string,string[]>; fetchedAt: string; version: string; quantityBasis: string };
export type BaselineOverride = {source:'cin7';quantity:string;googleQuantity:string;googlePresent:boolean;warehouse:string;bin:string;fetchedAt:string;adoptedAt:string;physicalQuantity:string;zeroConfirmed:boolean};
export type Session = { completionCount?:number;recheckRequired?:boolean;originalExpected?:Record<string,string>;baselineOverrides?:Record<string,BaselineOverride>; location: string; expected: Record<string,string>; labels: Record<string,string>; scanned: Record<string,string>; round: number; phase: 'scanning'|'finished'; startedAt: string; checkedAt?: string; reference?: StockReference; snapshot: { fetchedAt: string; version: string; quantityBasis: string } };
export type Result = { sku: string; label: string; expected: string; actual: string; diff: string; status: '漏扫'|'多出'|'数量不符'|'一致' };
const SCALE = 1000000n;
export function units(raw: string): bigint {
  const str=String(raw).trim();
  if(!/^\d{1,18}(?:\.\d{1,6})?$/.test(str)) throw Error('请输入有效数量，最多 6 位小数');
  const [a,b='']=str.split('.');return BigInt(a)*SCALE+BigInt(b.padEnd(6,'0'));
}
export function format(n: bigint): string { const neg=n<0n;if(neg)n=-n;const whole=n/SCALE,part=(n%SCALE).toString().padStart(6,'0').replace(/0+$/,'');return (neg?'-':'')+whole+(part?'.'+part:''); }
export function parseCSV(text: string): string[][] {
  text=text.replace(/^\uFEFF/,'');const rows:string[][]=[];let row:string[]=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(quoted){quoted=false;}else if(!field){quoted=true;}else throw Error('CSV 引号格式异常');}
  else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';}else field+=c;}
  if(quoted)throw Error('CSV 引号未结束');if(field||row.length){row.push(field);rows.push(row);}return rows;
}
export function isReplacementSku(sku:string):boolean{return typeof sku==='string'&&sku===sku.trim()&&sku.length<=256&&!/[\u0000-\u001f\u007f]/.test(sku)&&/replacement/i.test(sku);}
export function isInventorySku(sku:string):boolean{return /^[0-9]{1,18}$/.test(sku)||isReplacementSku(sku);}
export function parseReport(text: string): Omit<Inventory,'fetchedAt'|'version'> {
  const rows=parseCSV(text);const h=rows.slice(0,40).findIndex(r=>r[1]?.trim().toLowerCase()==='bin'&&r[2]?.trim().toLowerCase()==='sku');
  if(h<0||rows[h][6]?.trim().toLowerCase()!=='available')throw Error('库存列结构已变化，请检查 B 列 Bin、C 列 SKU 和 G 列 Available');
  const data:Inventory['data']={},labels:Inventory['labels']={},issues:Inventory['issues']={},owners:Record<string,string>={};let missing=0,zero=0;
  const issue=(loc:string,txt:string)=>{(issues[loc]??=[]).push(txt);};
  for(let i=h+1;i<rows.length;i++){const r=rows[i];if(r.every(v=>!v.trim()))continue;if(r.length<7)throw Error(`第 ${i+1} 行字段不足`);const loc=r[1].trim().toUpperCase();if(!loc){missing++;continue;}
    const label=r[2].trim(),match=label.match(/^.+~([0-9]+)$/);if(!match&&!isReplacementSku(label)){issue(loc,`第 ${i+1} 行商品没有有效的 ~数字 后缀（${label}）`);continue;}
    const sku=match?match[1]:label;if(labels[sku]&&labels[sku]!==label)throw Error(`数字 SKU ${sku} 对应多个完整 SKU，需核实源数据`);labels[sku]=label;
    const owner=r[0].trim();if(owners[loc]&&owners[loc]!==owner)issue(loc,'相同库位号属于多个仓库');owners[loc]=owner;
    let n;try{n=units(r[6]);}catch{issue(loc,`SKU ${sku} 的 G 列数量无效或为负数（${r[6]}）`);continue;}
    if(!n){zero++;continue;}data[loc]??={};data[loc][sku]=format(units(data[loc][sku]??'0')+n);
  }
  if(!Object.keys(data).length)throw Error('没有可核对的正数量库存');
  return {data,labels,issues,quantityBasis:'G · Available',notes:[`${missing} 行未指定库位`,`${zero} 行零数量`,`${Object.keys(issues).length} 个库位有数据异常`]};
}
export function startSession(inv:Inventory,location:string):Session {
  const loc=location.trim().toUpperCase();if(!loc)throw Error('请先输入库位');if(inv.issues[loc])throw Error(`${loc} 源数据异常：${inv.issues[loc].join('；')}`);if(!inv.data[loc])throw Error(`找不到 ${loc} 的正数量库存，请检查库位`);
  return attachStockReference({location:loc,expected:{...inv.data[loc]},labels:{...inv.labels},scanned:{},round:1,completionCount:0,recheckRequired:false,phase:'scanning',startedAt:new Date().toISOString(),snapshot:{fetchedAt:inv.fetchedAt,version:inv.version,quantityBasis:inv.quantityBasis}},inv);
}
export function attachStockReference(s:Session,inv:Inventory):Session {
  const bySku:StockReference['bySku']={};
  for(const [loc,items] of Object.entries(inv.data))for(const [sku,count] of Object.entries(items)){if(units(count)<=0n)continue;bySku[sku]??={};bySku[sku][loc]=count;}
  const issues=Object.fromEntries(Object.entries(inv.issues).map(([loc,errors])=>[loc,[...errors]]));
  return {...s,reference:{bySku,issues,fetchedAt:inv.fetchedAt,version:inv.version,quantityBasis:inv.quantityBasis}};
}
export function otherLocationHint(s:Session,sku:string):string {
  if(!s.reference)return '其他库位数据暂不可用，请刷新库存后查看。';
  const items=s.reference.bySku[sku]??{};
  const pairs=Object.entries(items).filter(([loc,count])=>loc!==s.location&&units(count)>0n).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}));
  if(!pairs.length)return '其他库位未查到该 SKU 的正可用数量（G 列）。';
  return '其他库位（G 列可用数量）：'+pairs.map(([loc,count])=>loc+'：'+count+(s.reference!.issues[loc]?'（源数据异常，仅供参考）':'')).join('；');
}
export function scanCheck(s:Session,raw:string) { if(s.phase!=='scanning')throw Error('请先点击「继续补扫」');const sku=raw.trim();if(!/^[0-9]{4,5}$/.test(sku))throw Error('请扫描正确的 SKU 条码：只接受 4 位或 5 位纯数字，工厂长条码不计数');return sku; }
export function recordQuantity(s:Session,raw:string,quantity:string):Session {
  if(s.phase!=='scanning')throw Error('当前核对已完成，请先继续补扫');
  let sku=raw.trim();if(!/^[0-9]{4,5}$/.test(sku)&&!isReplacementSku(sku))throw Error('手动输入只接受 4 / 5 位数字 SKU 或包含 Replacement 的 SKU');
  if(isReplacementSku(sku)){const known=Object.keys(s.labels).filter(k=>k.toLowerCase()===sku.toLowerCase());if(known.length===1)sku=known[0];}
  const amount=units(quantity);
  if(amount===0n){if(!(sku in s.expected))throw Error('零数量仅用于当前库位应有的 SKU；误扫的多出商品请删除记录');return {...s,scanned:{...s.scanned,[sku]:'0'}};}
  const total=format(units(s.scanned[sku]??'0')+amount);
  // Keep the accumulated value within the same bounds accepted by restore().
  units(total);
  return {...s,scanned:{...s.scanned,[sku]:total}};
}
export function recordItem(s:Session,raw:string):Session {return recordQuantity(s,scanCheck(s,raw),'1');}
export function availableLocations(inv:Inventory):string[]{return Object.keys(inv.data).filter(loc=>!inv.issues[loc]).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));}
export function locationSuggestions(locations:string[],raw:string,limit=20):string[]{const prefix=raw.trim().toUpperCase();return locations.filter(loc=>loc.startsWith(prefix)).slice(0,limit);}
export function saveCount(s:Session,sku:string,count:string,kind:'scan'|'edit',accept:boolean):Session {
  if(s.phase!=='scanning')throw Error('当前核对已完成，请先继续补扫');if(!isInventorySku(sku))throw Error('条码格式错误');
  if(kind==='scan'&&sku in s.scanned)throw Error('重复条码，未增加数量');if(kind==='edit'&&!(sku in s.scanned))throw Error('该商品尚未记录');
  if(!(sku in s.expected)&&!accept)throw Error('请勾选确认：该商品实物确实位于当前库位');const n=units(count);if(n===0n&&!(sku in s.expected))throw Error('零数量仅用于当前库位应有的 SKU；误扫的多出商品请删除记录');
  return {...s,scanned:{...s.scanned,[sku]:format(n)}};
}
export function results(s:Session):Result[]{return [...new Set([...Object.keys(s.expected),...Object.keys(s.scanned)])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(sku=>{const e=units(s.expected[sku]??'0'),a=units(s.scanned[sku]??'0');return {sku,label:s.labels[sku]??'未知 SKU',expected:format(e),actual:sku in s.scanned?format(a):'',diff:format(a-e),status:!(sku in s.scanned)?'漏扫':!(sku in s.expected)?'多出':e===a?'一致':'数量不符'};});}
// First completion with differences stays editable and cannot create a cloud report.
// A persisted completion count keeps the mandatory second check intact after reload.
export function completeRound(s:Session,now=new Date().toISOString()):Session {
 if(s.phase!=='scanning')throw Error('当前核对已完成，请先继续补扫');
 const completionCount=(s.completionCount??0)+1;
 const recheckRequired=completionCount===1&&results(s).some(r=>r.status!=='一致');
 return {...s,completionCount,recheckRequired,phase:recheckRequired?'scanning':'finished',round:s.round+(recheckRequired?1:0),checkedAt:recheckRequired?undefined:now};
}
export function normalizeBaselineOverride(raw:any):BaselineOverride {
 const string=(value:any,max=256)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f]/.test(value))throw Error('Cin7 基准记录格式异常');return value.trim();};
 if(!raw||raw.source!=='cin7'||typeof raw.googlePresent!=='boolean'||typeof raw.zeroConfirmed!=='boolean')throw Error('Cin7 基准记录格式异常');
 const quantity=format(units(string(raw.quantity,32))),googleQuantity=format(units(string(raw.googleQuantity,32))),physicalQuantity=format(units(string(raw.physicalQuantity,32)));
 if(quantity!==physicalQuantity||(quantity==='0'&&!raw.zeroConfirmed))throw Error('Cin7 基准需与确认的实点数量一致');
 const fetchedAt=string(raw.fetchedAt,64),adoptedAt=string(raw.adoptedAt,64);if(!Number.isFinite(Date.parse(fetchedAt))||!Number.isFinite(Date.parse(adoptedAt)))throw Error('Cin7 基准时间无效');
 return {source:'cin7',quantity,googleQuantity,googlePresent:raw.googlePresent,warehouse:string(raw.warehouse),bin:string(raw.bin),fetchedAt:new Date(fetchedAt).toISOString(),adoptedAt:new Date(adoptedAt).toISOString(),physicalQuantity,zeroConfirmed:raw.zeroConfirmed};
}
export function cin7BaselineCandidate(s:Session,sku:string,result:any,confirmZero=false,now=Date.now()):BaselineOverride {
 if(!/^[0-9]{4,5}$/.test(sku)||!result?.ok||result.numericSku!==sku||!Array.isArray(result.groups))throw Error('Cin7 查询结果无法用于当前 SKU');
 const full=s.labels[sku]&&s.labels[sku].endsWith('~'+sku)?s.labels[sku]:sku;if(result.sku!==full)throw Error('Cin7 查询结果无法用于当前 SKU');
 const age=now-Date.parse(result.fetchedAt);if(!Number.isFinite(age)||age>300000||age< -60000)throw Error('Cin7 查询已超过 5 分钟，请重新查询后采用');
 const matches=result.groups.filter((r:any)=>(String(r.bin||r.location||'')).trim().toUpperCase()===s.location.toUpperCase());if(matches.length!==1||!matches[0].location)throw Error('Cin7 当前库位不唯一或没有返回，不能采用基准');
 const row=matches[0];if(row.available===null||row.available===undefined)throw Error('Cin7 当前库位可用数量缺失，不能采用基准');
 let quantity;try{quantity=format(units(String(row.available)));}catch{throw Error('Cin7 可用数量必须为非负有效数量');}
 let actual=s.scanned[sku];if(actual===undefined){if(quantity==='0'&&confirmZero)actual='0';else throw Error('请先记录实点数量；实物为 0 时请明确勾选确认');}
 if(format(units(actual))!==quantity)throw Error('实点数量与 Cin7 可用数量不一致，不能采用基准');
 const original=s.originalExpected||s.expected;return normalizeBaselineOverride({source:'cin7',quantity,googleQuantity:original[sku]??'0',googlePresent:Object.prototype.hasOwnProperty.call(original,sku),warehouse:row.location,bin:row.bin||row.location,fetchedAt:result.fetchedAt,adoptedAt:new Date(now).toISOString(),physicalQuantity:actual,zeroConfirmed:quantity==='0'});
}
export function adoptCin7Baseline(s:Session,sku:string,result:any,confirmZero=false,now=Date.now()):Session {
 const baseline=cin7BaselineCandidate(s,sku,result,confirmZero,now);
 return {...s,originalExpected:s.originalExpected||{...s.expected},expected:{...s.expected,[sku]:baseline.quantity},baselineOverrides:{...s.baselineOverrides,[sku]:baseline},scanned:s.scanned[sku]===undefined?{...s.scanned,[sku]:'0'}:{...s.scanned},...(s.phase==='finished'?{checkedAt:baseline.adoptedAt}:{})};
}
export const baselineCSVHeaders=['核对基准来源','原 Google 基准数量','原 Google 读取时间','原 Google 版本','采用的 Cin7 数量','Cin7 仓库','Cin7 库位','Cin7 读取时间','采用时间','采用时实点数量','已确认实物为零'];
export function baselineCSVValues(b:BaselineOverride|undefined,googleQuantity:string,snapshot:Session['snapshot']):unknown[]{return [b?'Cin7':'Google',b?.googleQuantity??googleQuantity,snapshot.fetchedAt,snapshot.version,b?.quantity??'',b?.warehouse??'',b?.bin??'',b?.fetchedAt??'',b?.adoptedAt??'',b?.physicalQuantity??'',b?.zeroConfirmed?'yes':''];}
export function restore(raw:string):Session|null{const s=JSON.parse(raw);if(s===null)return null;if(!s||typeof s.location!=='string'||!s.expected||!s.scanned||!s.labels||!s.snapshot?.version||!['scanning','finished'].includes(s.phase)||!Number.isInteger(s.round)||s.round<1)throw Error('已保存的任务格式异常，请保留原记录');if(s.completionCount!==undefined&&(!Number.isSafeInteger(s.completionCount)||s.completionCount<0))throw Error('复核记录格式异常');if(s.recheckRequired!==undefined&&typeof s.recheckRequired!=='boolean')throw Error('复核记录格式异常');if(s.recheckRequired&&(s.completionCount!==1||s.phase!=='scanning'))throw Error('复核记录格式异常');for(const map of [s.expected,s.scanned,...(s.originalExpected?[s.originalExpected]:[])]){for(const [sku,n]of Object.entries(map)){if(!isInventorySku(sku)||typeof n!=='string')throw Error('保存记录格式异常');units(n);}}if(s.baselineOverrides){if(!s.originalExpected||typeof s.baselineOverrides!=='object'||Array.isArray(s.baselineOverrides))throw Error('Cin7 基准记录格式异常');for(const [sku,value]of Object.entries(s.baselineOverrides)){const b=normalizeBaselineOverride(value);if(!/^[0-9]{4,5}$/.test(sku)||s.expected[sku]===undefined||format(units(s.expected[sku]))!==b.quantity||format(units(s.originalExpected[sku]??'0'))!==b.googleQuantity||Object.prototype.hasOwnProperty.call(s.originalExpected,sku)!==b.googlePresent||b.bin.toUpperCase()!==s.location.toUpperCase())throw Error('Cin7 基准记录格式异常');s.baselineOverrides[sku]=b;}}return s;}
export function exportCSV(s:Session):string {
  const cell=(x:unknown)=>{let v=String(x??'');if(/^[=+@\t\r]/.test(v)||(/^\-/.test(v)&&!/^\-\d+(\.\d+)?$/.test(v)))v="'"+v;return '"'+v.replaceAll('"','""')+'"';};
  const rows:unknown[][]=[['库位','数字SKU','完整SKU','基准数量','实点数量','差异','结果','轮次','数量口径','基准读取时间','版本','状态','备注（其他库位）','备注参考读取时间','备注参考版本',...baselineCSVHeaders]];
  for(const r of results(s))rows.push([s.location,r.sku,r.label,r.expected,r.actual,r.diff,r.status,s.round,s.baselineOverrides?.[r.sku]?'Cin7 · Available':s.snapshot.quantityBasis,s.baselineOverrides?.[r.sku]?.fetchedAt??s.snapshot.fetchedAt,s.baselineOverrides?.[r.sku]?'cin7@'+s.baselineOverrides[r.sku].fetchedAt:s.snapshot.version,s.phase,r.status==='一致'?'':otherLocationHint(s,r.sku),r.status==='一致'?'':s.reference?.fetchedAt??'',r.status==='一致'?'':s.reference?.version??'',...baselineCSVValues(s.baselineOverrides?.[r.sku],s.expected[r.sku]??'0',s.snapshot)]);return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
}
