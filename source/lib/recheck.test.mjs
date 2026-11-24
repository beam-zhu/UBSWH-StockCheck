import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startSession,recordQuantity,completeRound,restore,adoptCin7Baseline} from './checker.ts';
import {makeReport} from './reports.ts';
const inv={data:{A01:{'01719':'2'}},labels:{'01719':'CHAIR~01719'},issues:{},notes:[],version:'v1',fetchedAt:new Date().toISOString(),quantityBasis:'G · Available'};
const profile={operator:'Alex',deviceName:'DT50',deviceId:'d_'+'a'.repeat(32)};
const base=n=>n?recordQuantity(startSession(inv,'A01'),'01719',n):startSession(inv,'A01');
test('first differences require a persisted second check without losing counts or baseline',()=>{
 const old=base('1'),held=completeRound(old);assert.equal(held.phase,'scanning');assert.equal(held.recheckRequired,true);assert.equal(held.checkedAt,undefined);assert.equal(held.round,2);assert.deepEqual(held.scanned,old.scanned);assert.deepEqual(held.expected,old.expected);
 const restored=restore(JSON.stringify(held));assert.equal(restored.recheckRequired,true);assert.throws(()=>makeReport(restored,profile));assert.throws(()=>makeReport({...restored,phase:'finished',checkedAt:new Date().toISOString()},profile));
});
test('first matching check uploads immediately, second completion uploads whether fixed or still different',()=>{
 assert.equal(makeReport(completeRound(base('2')),profile).rows[0].status,'一致');
 for(const n of [null,'1']){let s=restore(JSON.stringify(completeRound(base('1'))));if(n)s=recordQuantity(s,'01719',n);s=completeRound(s);assert.equal(s.recheckRequired,false);assert.equal(s.completionCount,2);assert.equal(makeReport(s,profile).rows[0].status,n?'一致':'数量不符');}
 const missing=completeRound(completeRound(base()));assert.equal(makeReport(missing,profile).rows[0].status,'漏扫');
 assert.equal(completeRound(base('1')).completionCount,1);
});
test('Cin7 resolving a held difference still requires the second completion',()=>{
 let s=completeRound(base('1'));s=adoptCin7Baseline(s,'01719',{ok:true,numericSku:'01719',sku:'CHAIR~01719',fetchedAt:new Date().toISOString(),groups:[{location:'Main',bin:'A01',available:'1'}]});
 assert.equal(s.recheckRequired,true);assert.throws(()=>makeReport(s,profile));assert.equal(makeReport(completeRound(s),profile).rows[0].status,'一致');
});
test('legacy finished reports remain uploadable and new locations reset the gate',()=>{
 const legacy={...base('1'),phase:'finished',checkedAt:new Date().toISOString()};delete legacy.completionCount;delete legacy.recheckRequired;assert.equal(makeReport(restore(JSON.stringify(legacy)),profile).rows[0].actual,'1');
 assert.equal(startSession(inv,'A01').completionCount,0);
});
