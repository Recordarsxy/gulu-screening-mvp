import {describe,expect,it} from 'vitest';
import {JSDOM} from 'jsdom';

describe('Gulu main-world hierarchical filter fallback',()=>{
  it('commits a second-level node through the page tree event handler',async()=>{
    const {commitComtreeValueInMainWorld}=await import('../extension/gulu-main-world.js');
    const dom=new JSDOM('<body><ul><li><a class="search-label">行业</a><div><input name="value" value=""><div class="comtree"><a class="comtree-title"><span>请选择</span></a><div><input class="fn-search-input" value="游戏"><div class="jqtree-element"><input type="checkbox" value=""><span class="jqtree-title" aria-level="2">Gaming 游戏</span></div><button class="fn-confirm">确认</button></div></div><button class="add">添加</button></div></li></ul></body>');
    Object.defineProperty(dom.window.HTMLElement.prototype,'getClientRects',{value(){return[{width:1,height:1}]}});
    Object.assign(globalThis,{document:dom.window.document,getComputedStyle:dom.window.getComputedStyle.bind(dom.window)});
    const hidden=dom.window.document.querySelector('input[name=value]') as HTMLInputElement;
    dom.window.document.querySelector('.jqtree-title')?.addEventListener('click',()=>{hidden.value='2201';(dom.window.document.querySelector('.comtree-title span') as HTMLElement).textContent='Gaming 游戏';});
    let committed='';dom.window.document.querySelector('.add')?.addEventListener('click',()=>{committed=hidden.value});
    expect(commitComtreeValueInMainWorld('industries','游戏')).toMatchObject({accepted:true,value:'游戏'});
    expect(committed).toBe('2201');
  });
});
