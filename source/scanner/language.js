const languageStorageKey='urbansales.bincheck.language';
let uiLanguage='zh';try{uiLanguage=localStorage.getItem(languageStorageKey)==='en'?'en':'zh';}catch{}
const originalText=new WeakMap(),originalAttributes=new WeakMap();
let translationQueued=false;
function localize(message){return uiLanguage==='en'?toEnglish(String(message)):String(message);}
function applyTranslations(){
 document.documentElement.lang=uiLanguage==='en'?'en':'zh-CN';document.title=uiLanguage==='en'?'Stock check · Urbansales':'库位核对 · Urbansales';
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
 while((node=walker.nextNode())){const parent=node.parentElement;if(!parent||parent.closest('script,style,textarea,[data-language-control],[data-no-translate]'))continue;if(parent.closest('.sku-label,#pending-label')&&!['未知 SKU','未找到对应的完整 SKU'].includes(node.nodeValue.trim()))continue;
  const current=node.nodeValue;let record=originalText.get(node);if(!record||current!==record.last)record={source:current,last:current};const wanted=uiLanguage==='en'?toEnglish(record.source):record.source;if(wanted!==current)node.nodeValue=wanted;record.last=wanted;originalText.set(node,record);
 }
 for(const el of document.querySelectorAll('[placeholder],[aria-label],[title]')){if(el.hasAttribute('data-language-control'))continue;let records=originalAttributes.get(el)||{};for(const name of ['placeholder','aria-label','title']){if(!el.hasAttribute(name))continue;const current=el.getAttribute(name);let record=records[name];if(!record||current!==record.last)record={source:current,last:current};const wanted=uiLanguage==='en'?toEnglish(record.source):record.source;if(wanted!==current)el.setAttribute(name,wanted);record.last=wanted;records[name]=record;}originalAttributes.set(el,records);}
 const button=document.getElementById('language-toggle');const label=uiLanguage==='en'?'中文':'EN',aria=uiLanguage==='en'?'Switch to Chinese / 切换到中文':'Switch to English / 切换到英文',title=uiLanguage==='en'?'Switch to Chinese':'切换到英文';if(button.textContent!==label)button.textContent=label;if(button.getAttribute('aria-label')!==aria)button.setAttribute('aria-label',aria);if(button.title!==title)button.title=title;button.setAttribute('aria-pressed',uiLanguage==='en'?'true':'false');
}
function queueTranslations(){if(translationQueued)return;translationQueued=true;Promise.resolve().then(()=>{translationQueued=false;applyTranslations();});}
new MutationObserver(records=>{if(records.some(record=>{const element=record.target.nodeType===Node.ELEMENT_NODE?record.target:record.target.parentElement;return !element?.closest('[data-no-translate]');}))queueTranslations();}).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['placeholder','aria-label','title']});
document.getElementById('language-toggle').onclick=()=>{uiLanguage=uiLanguage==='zh'?'en':'zh';try{localStorage.setItem(languageStorageKey,uiLanguage);}catch{}applyTranslations();if(typeof render==='function')render();if(typeof focusScanner==='function')focusScanner();};
applyTranslations();
