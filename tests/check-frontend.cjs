const fs=require('node:fs');
const vm=require('node:vm');
const babel=require('../node_modules/jiti/dist/babel.cjs');
const html=fs.readFileSync('frontend/carrozzeria-crm-app.html','utf8');
const code=html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1];
const result=babel({source:code,filename:'crm.jsx',jsx:true});
if(result.error)throw new Error(JSON.stringify(result.error));
new vm.Script(result.code);
console.log('Frontend JSX compilato e sintassi verificata');

(async()=>{
 const assert=require('node:assert/strict');
 const {calculate,emptyLedger}=await import('../src/lib/profit.js');
 const source=code.slice(code.indexOf('const profitMath ='),code.indexOf('const PROFIT_COSTS='));
 const context={};vm.runInNewContext(source+';this.calcola=profitMath.calculate;',context);
 const d=emptyLedger('2026-09-13');d.revenue.preventivo=485000;
 d.costs=[{id:'p',category:'ricambi',phase:'planned',date:d.date,description:'',quantity:1,unitCents:295000},{id:'a',category:'ricambi',phase:'actual',date:d.date,description:'',quantity:1,unitCents:342000}];
 assert.equal(JSON.stringify(context.calcola(d)),JSON.stringify(calculate(d)));
 console.log('Anteprima frontend e calcoli backend coincidono');
})().catch(e=>{console.error(e);process.exitCode=1;});
