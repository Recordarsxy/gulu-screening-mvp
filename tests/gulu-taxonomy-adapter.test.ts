import {describe,expect,it} from 'vitest';
import {JSDOM} from 'jsdom';
import {scanTaxonomyField} from '../extension/gulu-adapter-module.js';

describe('Gulu taxonomy adapter',()=>{
  it('reads a complete tree without checking or confirming any option',async()=>{
    const dom=new JSDOM('<body><ul><li><a class="search-label">行业</a><input class="comtree comtree-offscreen"><div class="comtree"><a class="comtree-title"><span>请选择</span></a><ul role="tree"><li><div><input type="checkbox"><span class="jqtree-title" aria-level="1">Technology 科技</span></div><ul><li><div><input type="checkbox"><span class="jqtree-title" aria-level="2">Gaming 游戏</span></div></li></ul></li></ul><button class="fn-confirm">确认</button></div></li></ul></body>');
    Object.defineProperty(dom.window.HTMLElement.prototype,'getClientRects',{value(){return [{width:1,height:1}]}});
    Object.assign(globalThis,{getComputedStyle:dom.window.getComputedStyle.bind(dom.window),Event:dom.window.Event,KeyboardEvent:dom.window.KeyboardEvent});
    let confirmed=false;
    dom.window.document.querySelector('.fn-confirm')?.addEventListener('click',()=>{confirmed=true});

    await expect(scanTaxonomyField('industries',{doc:dom.window.document})).resolves.toEqual([
      {label:'Technology 科技',parent:null,depth:1},
      {label:'Gaming 游戏',parent:'Technology 科技',depth:2},
    ]);
    expect([...dom.window.document.querySelectorAll('input[type=checkbox]')].some(node=>(node as HTMLInputElement).checked)).toBe(false);
    expect(confirmed).toBe(false);
  });
  it('keeps the shallowest canonical node when a leaf repeats its parent label',async()=>{
    const dom=new JSDOM('<body><ul><li><a class="search-label">所在城市</a><div class="comtree"><a class="comtree-title">请选择</a><ul><li><div class="jqtree-element"><span class="jqtree-title" aria-level="1">China</span></div><ul><li><div class="jqtree-element"><span class="jqtree-title" aria-level="2">Shanghai - 上海</span></div><ul><li><div class="jqtree-element"><span class="jqtree-title" aria-level="3">Shanghai - 上海</span></div></li></ul></li></ul></li></ul></div></li></ul></body>');
    Object.assign(globalThis,{Event:dom.window.Event});
    await expect(scanTaxonomyField('cities',{doc:dom.window.document})).resolves.toEqual([
      {label:'China',parent:null,depth:1},
      {label:'Shanghai - 上海',parent:'China',depth:2},
    ]);
  });
  it('waits for asynchronously loaded tree nodes to stabilize',async()=>{
    const dom=new JSDOM('<body><ul><li><a class="search-label">职能</a><div class="comtree"><a class="comtree-title">请选择</a><ul class="jqtree-tree"></ul></div></li></ul></body>');
    Object.assign(globalThis,{Event:dom.window.Event});
    setTimeout(()=>{const row=dom.window.document.createElement('li');row.innerHTML='<div class="jqtree-element"><span class="jqtree-title" aria-level="1">Sales 销售</span></div>';dom.window.document.querySelector('.jqtree-tree')?.append(row)},650);
    await expect(scanTaxonomyField('functions',{doc:dom.window.document})).resolves.toEqual([{label:'Sales 销售',parent:null,depth:1}]);
  });
  it('clicks a lazy folder once and waits beyond the ordinary quiet window for its children',async()=>{
    const dom=new JSDOM('<body><ul><li><a class="search-label">行业</a><div class="comtree"><a class="comtree-title">请选择</a><ul><li class="jqtree-folder"><div class="jqtree-element"><button class="jqtree-toggler"></button><span class="jqtree-title" aria-level="1">Technology 科技</span></div><ul></ul></li></ul></div></li></ul></body>');
    Object.assign(globalThis,{Event:dom.window.Event});
    let clicks=0;
    dom.window.document.querySelector('.jqtree-toggler')?.addEventListener('click',()=>{clicks+=1;setTimeout(()=>{const row=dom.window.document.createElement('li');row.innerHTML='<div class="jqtree-element"><span class="jqtree-title" aria-level="2">Gaming 游戏</span></div>';dom.window.document.querySelector('.jqtree-folder > ul')?.append(row)},900)});
    await expect(scanTaxonomyField('industries',{doc:dom.window.document})).resolves.toEqual([{label:'Technology 科技',parent:null,depth:1},{label:'Gaming 游戏',parent:'Technology 科技',depth:2}]);
    expect(clicks).toBe(1);
  });
  it('waits for the filter widget to mount after its search label opens',async()=>{
    const dom=new JSDOM('<body><ul><li id="city"><a class="search-label">所在城市</a></li></ul></body>');
    Object.assign(globalThis,{Event:dom.window.Event});
    dom.window.document.querySelector('.search-label')?.addEventListener('click',()=>setTimeout(()=>{const widget=dom.window.document.createElement('div');widget.className='comtree';widget.innerHTML='<a class="comtree-title">请选择</a><span class="jqtree-title" aria-level="1">China</span>';dom.window.document.querySelector('#city')?.append(widget)},500));
    await expect(scanTaxonomyField('cities',{doc:dom.window.document})).resolves.toEqual([{label:'China',parent:null,depth:1}]);
  });
});
