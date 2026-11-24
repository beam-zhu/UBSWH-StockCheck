import fs from 'node:fs';import ts from 'typescript';
const read=p=>fs.readFileSync(p,'utf8');
const compile=p=>ts.transpileModule(read(p).replace(/^import[^\n]*\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2020}}).outputText.replace(/^export\s+/gm,'');
const core=compile('source/lib/checker.ts'),reports=compile('source/lib/reports.ts'),i18n=compile('source/lib/i18n.ts');
// Apps Script's save-time parser rejects BigInt literal tokens (1000000n).
// Transform syntax only; keep arbitrary precision via BigInt("1000000").
function gasCompatible(source){return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2019,module:ts.ModuleKind.None},transformers:{before:[context=>root=>{const visit=node=>ts.isBigIntLiteral(node)?ts.factory.createCallExpression(ts.factory.createIdentifier('BigInt'),undefined,[ts.factory.createStringLiteral(node.text.replace(/n$/,''))]):ts.visitEachChild(node,visit,context);return ts.visitNode(root,visit);}]}}).outputText;}
fs.writeFileSync('apps-script/Cin7.gs',gasCompatible(read('source/server/Cin7.js')));

fs.writeFileSync('apps-script/Shared.gs','// Generated for Apps Script: BigInt constructor syntax preserves exact quantities.\n'+gasCompatible(core+'\n'+reports+'\n'+i18n));
const transport='<script src="config.js"></script><script>'+read('source/transport.js')+'</script>';
function html(source,client,css,admin=false){let s=read(source).replaceAll('content="#28664c"','content="#252522"').replace('/* INLINE_CSS */',()=>css).replace('/* INLINE_JS */',()=>client.replace(/<\/script/gi,'<\\/script'));s=s.replace('<head>','<head><base href="./">').replace(/<script type="module">/,transport+(admin?read('source/login.html'):'')+'<script type="module">');s=s.replaceAll('urbansales.','ubswh.google-test.').replaceAll('href="/cin7"','href="cin7.html"').replaceAll('href="/"','href="manager.html"').replaceAll('https://warehouse-bin-check.urbansales-6102.chatgpt.site/','index.html');s=s.replace('</body>','<aside style="position:fixed;bottom:0;right:0;background:#fff4ce;color:#573d00;padding:4px 9px;z-index:30;font-size:12px">GOOGLE TEST · 独立测试版</aside></body>');if(/warehouse-.*\.chatgpt\.site/.test(s))throw Error('Legacy production endpoint in new app');if(s.includes('/* INLINE_'))throw Error('Missing inline asset');return s;}
const scanner=['language.js','uploads.js','cin7.js','location-history.js','client.js'].map(n=>read('source/scanner/'+n)).join('\n');
fs.writeFileSync('public/index.html',html('source/scanner/index.html',core+'\n'+reports+'\n'+i18n+'\n'+scanner,read('source/scanner/styles.css')+'\n'+read('source/scanner/theme.css')));
let manager=read('source/manager/client.js');const a=manager.indexOf('function csvLink('),b=manager.indexOf('\nfunction render()',a);manager=manager.slice(0,a)+`async function csvLink(id,location){try{const r=await fetch('/api/reports/'+id+'/csv?lang='+lang);if(!r.ok)throw Error('Export failed');const blob=await r.blob(),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='report_'+location+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch{$('error').textContent=t('导出失败，请重新登录后重试。','Export failed. Sign in again and retry.');$('error').hidden=false;}}`+manager.slice(b);
const css=read('source/manager/styles.css')+'\n'+read('source/manager/theme.css');if(!css.includes('.pagination-controls{')||/new Response\(/.test(css))throw Error('Invalid manager CSS');
fs.writeFileSync('public/manager.html',html('source/manager/index.html',i18n+'\n'+manager,css,true));
let settings=read('source/manager/cin7.js').replaceAll('已加密保存。Key 已从输入框清除，尚未调用 Cin7。','已保存到 Google 服务端配置。Key 已从输入框清除，尚未调用 Cin7。').replaceAll('Saved with encryption.','Saved in Google server-side configuration.');
fs.writeFileSync('public/cin7.html',html('source/manager/cin7.html',settings,css,true).replaceAll('Key 会加密保存在服务器端','Key 仅保存在 Google 项目的服务端配置中').replaceAll('Your key is encrypted on the server','Your key is stored in Google project server-side configuration'));
fs.writeFileSync('public/.nojekyll','');console.log('Built standalone GitHub Pages frontend and Apps Script backend');

// Management login and data stay on Google hosting, not GitHub Pages.
for(const [name,gas]of [['manager','Manager'],['cin7','Cin7']]){
 let page=read('public/'+name+'.html').replace('<script src="config.js"></script>','<script>window.STOCKCHECK_CONFIG={apiUrl:"",environment:"google-test"};</script>').replace('<base href="./">','<base target="_top">').replaceAll('href="manager.html"','href="__MANAGER_URL__"').replaceAll('href="cin7.html"','href="__SETTINGS_URL__"').replaceAll('href="index.html"','href="__SCANNER_URL__"');
 fs.writeFileSync('apps-script/'+gas+'.html',page);
 const launcher=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google 测试管理入口</title><body style="font:16px/1.6 sans-serif;padding:30px"><h1>Google 测试管理入口</h1><p>管理登录在 Google 后台页面进行。旧系统不受影响。</p><a id="open" target="_top">打开管理页面 / Open console</a><p id="message"></p><script src="config.js"></script><script>const url=window.STOCKCHECK_CONFIG?.apiUrl;if(/^https:\\/\\/script\\.google\\.com\\/macros\\/s\\/[A-Za-z0-9_-]+\\/exec$/.test(url||'')){document.getElementById('open').href=url+'?page=${name}';}else document.getElementById('message').textContent='尚未配置新 Google 后台地址。';</script></body></html>`;
 fs.writeFileSync('public/'+name+'.html',launcher);
}
