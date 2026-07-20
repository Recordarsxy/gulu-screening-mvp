const status=document.querySelector('#status');const show=(text,kind='')=>{status.textContent=text;status.className=kind};
chrome.runtime.sendMessage({type:'status'},(result)=>show(result?.paired?'已连接本机网站':'尚未配对',result?.paired?'ok':''));
document.querySelector('#pair').addEventListener('click',()=>{const code=document.querySelector('#code').value.trim();if(!/^\d{6}$/.test(code)){show('请输入 6 位配对码','error');return;}chrome.runtime.sendMessage({type:'pair',code},(result)=>show(result?.ok?'连接成功':`连接失败：${result?.error??'未知错误'}`,result?.ok?'ok':'error'));});
document.querySelector('#poll').addEventListener('click',()=>chrome.runtime.sendMessage({type:'poll'},()=>show('已开始检查后台任务','ok')));
