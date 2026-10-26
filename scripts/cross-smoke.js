const checks=[];
const assert=(ok,text)=>{if(!ok)throw new Error(text);checks.push(text);};
const $=id=>document.getElementById(id);
const wait=async()=>{for(let i=0;i<300;i++){if($('busy').hidden)return;await new Promise(r=>setTimeout(r,30));}throw new Error('cross-file query timed out');};
const query=async sql=>{$('sql').value=sql;$('sql').dispatchEvent(new Event('input'));$('run').click();await wait();};
const join='SELECT a.order_id, a.city, b.amount FROM workspace."orders.parquet" a JOIN workspace."nested/orders-copy.parquet" b USING (order_id) ORDER BY a.order_id';
if(workspacePhase==='cross-restore'){
 assert($('sql').value===join,'cross-file SQL restored after relaunch');
 assert(document.querySelectorAll('#grid tbody tr').length===100,'restored JOIN executes with real workspace scope');
 assert(!$('workspace-tables').hidden,'workspace table helper restored');
}else{
 const file=[...document.querySelectorAll('.tree-file')].find(b=>b.dataset.path==='orders.parquet');file.click();await wait();
 assert(!$('workspace-tables').hidden,'workspace query helper visible');
 $('workspace-tables').open=true;
 const button=[...document.querySelectorAll('.table-reference')].find(b=>b.textContent==='workspace."orders.parquet"');
 $('sql').value='SELECT * FROM ';$('sql').setSelectionRange(14,14);button.click();
 assert($('sql').value==='SELECT * FROM workspace."orders.parquet"','table reference inserts at cursor without running');
 $('workspace-tables').open=false;
 await query(join);
 assert(document.querySelectorAll('#grid tbody tr').length===100,'JOIN unopened nested file returns bounded page');
 assert(document.querySelector('#grid tbody tr').textContent.includes('1001'),'JOIN values correct');
 $('next').click();await wait();assert($('result-summary').textContent.startsWith('101'),'JOIN pagination uses same workspace');
 await query('SELECT count(*) AS total FROM (SELECT * FROM workspace."orders.parquet" UNION ALL SELECT * FROM workspace."nested/orders-copy.parquet")');
 assert(document.querySelector('#grid tbody tr').textContent.includes('480'),'UNION ALL combines both files');
 await query('SELECT big_id FROM workspace."special.parquet"');
 assert(document.querySelector('#grid tbody tr').textContent.includes('9223372036854775807'),'cross-file integer remains exact');
 await query('SELECT * FROM workspace."../outside.parquet"');assert(!$('notification').hidden && $('notification').classList.contains('error'),'traversal rejected through IPC');
 await query('SELECT * FROM workspace."malformed.parquet"');assert(!$('notification').hidden && $('notification').classList.contains('error'),'malformed reference is reported');
 await query(join);
 assert(document.querySelectorAll('#grid tbody tr').length===100 && $('notification').hidden,'valid JOIN recovers after errors');
}
return {checks};
