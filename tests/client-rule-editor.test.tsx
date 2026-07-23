/** @vitest-environment jsdom */
import React,{act,useState} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,describe,expect,it,vi} from "vitest";
import {RuleList} from "../src/client/App.js";

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const roots:Array<ReturnType<typeof createRoot>>=[];
afterEach(()=>{roots.splice(0).forEach(root=>act(()=>root.unmount()));document.body.innerHTML=""});

function renderRuleList(onCommit=(value:string[])=>{}){
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
});
