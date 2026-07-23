/** @vitest-environment jsdom */
import React,{act,useState} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,describe,expect,it,vi} from "vitest";
import {JobChangesPanel,RuleList} from "../src/client/App.js";

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const roots:Array<ReturnType<typeof createRoot>>=[];
afterEach(()=>{roots.splice(0).forEach(root=>act(()=>root.unmount()));document.body.innerHTML=""});

function renderRuleList(onCommit=(_value:string[])=>{}){
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);roots.push(root);
  function Harness(){const [value,setValue]=useState(["深圳"]);return <RuleList title="硬条件" value={value} onChange={next=>{setValue(next);onCommit(next)}}/>}
  act(()=>root.render(<Harness/>));
  return host.querySelector("textarea") as HTMLTextAreaElement;
}

function input(textarea:HTMLTextAreaElement,value:string){
  const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!;
  act(()=>{setter.call(textarea,value);textarea.dispatchEvent(new Event("input",{bubbles:true}))});
}

describe("rule editor",()=>{
  it("keeps a newly entered line break until the editor loses focus",()=>{
    const onCommit=vi.fn();const textarea=renderRuleList(onCommit);
    input(textarea,"深圳\n");
    expect(textarea.value).toBe("深圳\n");
    expect(onCommit).not.toHaveBeenCalled();
    act(()=>textarea.dispatchEvent(new FocusEvent("focusout",{bubbles:true})));
    expect(onCommit).toHaveBeenCalledWith(["深圳"]);
  });
  it("shows AI change analysis and an in-progress action label",()=>{
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host);roots.push(root);
    act(()=>root.render(<JobChangesPanel
      changes={[{
        id:"change-1",jobId:"job-1",text:"优先跨境供应链金融经验",createdAt:"2026-07-23 12:00:00",appliedRuleVersion:null,
        analysis:{
          summary:"新增跨境供应链金融经验",
          impacts:[{section:"constraints.soft",action:"add",values:["跨境供应链金融"],reason:"客户新增偏好"}],
          questions:["这是加分项还是硬条件？"],model:"deepseek-v4-pro",
        },
      }]}
      text="新变化"
      setText={()=>{}}
      onSave={()=>{}}
      onIntegrate={()=>{}}
      busyAction="analyze-change"
    />));
    expect(host.textContent).toContain("DeepSeek 正在分析…");
    expect(host.textContent).toContain("新增跨境供应链金融经验");
    expect(host.textContent).toContain("加分项");
    expect(host.textContent).toContain("跨境供应链金融");
  });
});
