const button=document.getElementById('copy');
button.addEventListener('click',async()=>{
 if(button.disabled)return;
 button.disabled=true;const status=document.getElementById('status');
 let result;
 try{
  const role=document.body.dataset.role;
  status.textContent='正在生成短期凭据；没有提交评测或审核。';
  const r=await fetch('/token/'+role,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
  if(!r.ok){
   status.textContent=r.status===403
    ?'生成凭据失败（HTTP 403）。请用 http://127.0.0.1:8776 打开本页，不要从文件或其他域名打开。没有提交任务。'
    :`生成凭据失败（HTTP ${r.status}）。请确认既有本地Docker环境正在运行；不要重建环境或开云节点。没有提交任务。`;
   return;
  }
  result=await r.json();
  if(typeof result.token!=='string'||!result.token||result.role!==role||result.workspace!=='presentation-rehearsal-1792392871535'){
   status.textContent='生成凭据的返回内容无效。没有复制、没有提交任务；请保留此提示反馈。';
   result=undefined;
   return;
  }
 }catch{
  status.textContent='生成凭据未完成（连接、超时或响应错误）。请确认8776入口服务正在运行，再由你手动重试此按钮；没有提交任务。';
  button.disabled=false;return;
 }finally{if(!result)button.disabled=false;}
 try{
  if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
  await navigator.clipboard.writeText(result.token);
  status.textContent=`已复制15分钟短期凭据，角色 ${result.role}。复制成功不等于网站已连接：现在打开5193，粘贴到 Access token，再点 Refresh workspace（刷新工作空间）。${result.role==='viewer'?'只查看History/Compare；新建评测需要提交者入口。':'只使用Static replay；提交操作由你自己点击。'}`;
 }catch{
  status.textContent='凭据已生成但未复制：浏览器阻止了剪贴板操作。请允许本页复制后，再由你点击一次生成并复制。未连接5193，也没有提交任务；不要发送或截图凭据。';
 }finally{result=undefined;button.disabled=false;}
});
