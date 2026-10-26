// Real WKWebView + Go/DuckDB. Test configuration supplies two real fixture roots.
// The bridge drop below simulates an already-delivered event, not a Finder gesture.
const checks=[];
const assert=(ok,text)=>{if(!ok)throw new Error(text);checks.push(text);};
const $=id=>document.getElementById(id);
const wait=async()=>{for(let i=0;i<200;i++){if($('busy').hidden)return;await new Promise(r=>setTimeout(r,30));}throw new Error('multi-file operation stayed busy');};
const click=async node=>{if(!node)throw new Error('missing control');node.click();await wait();};
const groups=()=>[...document.querySelectorAll('.workspace-group')];
const opened=()=>[...document.querySelectorAll('.opened-file')];
const group=name=>groups().find(g=>g.querySelector('[data-control="folder-name"]').textContent===name);
const sales=group('Sales').dataset.root,inventory=group('Inventory').dataset.root;
const first=sales+'/orders.parquet',second=inventory+'/orders.parquet';
const external=sales.slice(0,sales.lastIndexOf('/'))+'/external.parquet';
const row=path=>opened().find(r=>r.dataset.path===path);
const tree=path=>[...document.querySelectorAll('.tree-file')].find(b=>b.dataset.fullPath===path);
const drop=async path=>{window.__mygo.receive({t:'event',n:'mygo:file-drop',p:{paths:[path],x:0,y:0}});await wait();};
const rows=()=>document.querySelectorAll('#grid tbody tr').length;
const selected=path=>row(path)?.classList.contains('selected');
assert(groups().length===2,'two independent workspace roots restored');
if(workspacePhase==='multi-restore'){
  assert(opened().length===2 && row(first) && row(second),'last file per workspace restored; outside files stay session-only');
  assert(selected(first),'last used workspace restored as active');
  assert($('sql').value==='SELECT city, count(*) AS orders FROM data GROUP BY city' && rows()===4,'saved query restored with real results');
  await click(group('Inventory').querySelector('[data-control="folder-close"]'));
  assert(groups().length===1 && opened().length===1 && !row(second) && $('open-files-panel').hidden,'closing a workspace closes its files without moving them outside');
  assert(selected(first) && rows()===4,'closing another workspace retains current preview');
  await click(group('Sales').querySelector('[data-control="folder-close"]'));
  assert(groups().length===0 && opened().length===0 && !$('welcome').hidden && $('export').disabled,'closing last workspace clears all its files and returns to welcome');
  let released=false;try{await mygo.call('Workbench.Query',{sql:'SELECT * FROM data',offset:0,limit:100,sort:'',desc:false,filterColumn:'',filterValue:''});}catch{released=true;}
  assert(released,'closing the active workspace releases its last file engine');
}else{
  assert($('welcome').hidden && !$('sql-panel').hidden && opened().length===0,'workspace query editor opens without loading file data');
  await click(tree(first));assert(rows()===100,'first workspace file opens a bounded page');
  $('sql').value='SELECT city, count(*) AS orders FROM data GROUP BY city';$('sql').dispatchEvent(new Event('input'));await click($('run'));
  assert(rows()===4,'first file aggregation runs through real DuckDB');
  $('sql').value='SELECT city FROM data';$('sql').dispatchEvent(new Event('input'));
  await click(tree(second));
  assert(opened().length===2 && row(first) && row(second) && $('open-files-panel').hidden,'workspace files appear only in their trees; external list hidden');
  assert(rows()===100 && $('sql').value==='SELECT * FROM data','second file has an independent query');
  await click(row(first).querySelector('.activate-file'));
  assert($('sql').value==='SELECT city FROM data' && rows()===4,'switch restores draft separately from last successful results');
  document.querySelector('#grid tbody td:nth-child(2)').click();assert(!document.querySelector('dialog'),'cell click remains in the table');
  await drop(external);
  assert(opened().length===3 && groups().length===2,'outside file does not replace files or workspace roots');
  assert(document.querySelector('.external-files .opened-file').dataset.path===external,'outside file listed separately under Other files');
  await drop(external);assert(opened().length===3,'opening an existing file does not duplicate it');
  await click(row(first).querySelector('.activate-file'));
  $('sql').value='SELECT * FROM data';await click($('run'));await click($('next'));
  assert($('page-label').textContent==='Page 2','first file can navigate to another page');
  await click(row(second).querySelector('.activate-file'));await click(row(first).querySelector('.activate-file'));
  assert($('page-label').textContent==='Page 2' && rows()===100,'switching files retains pagination');
  await click(row(second).querySelector('.close-file'));
  assert(opened().length===2 && selected(first) && $('page-label').textContent==='Page 2','right-side x closes inactive file without disturbing preview');
  await click(row(external).querySelector('.activate-file'));await click(row(external).querySelector('.close-file'));
  assert(opened().length===1 && selected(first),'closing active file selects a remaining file');
  await click(row(first).querySelector('.close-file'));
  assert(opened().length===0 && $('welcome').hidden && !$('sql-panel').hidden && $('export').disabled,'closing last file retains workspace editor and disables export');
  let closed=false;try{await mygo.call('Workbench.Query',{sql:'SELECT * FROM data',offset:0,limit:100,sort:'',desc:false,filterColumn:'',filterValue:''});}catch{closed=true;}
  assert(closed,'last-file close releases the engine session');
  assert(groups().length===2,'closing files keeps both workspace trees available');
  await click(tree(second));await click(tree(first));await drop(external);
  assert(opened().length===3 && rows()===100,'files can reopen after engine close');
  await click(row(first).querySelector('.activate-file'));
  $('sql').value='SELECT city, count(*) AS orders FROM data GROUP BY city';$('sql').dispatchEvent(new Event('input'));await click($('run'));
  assert(rows()===4,'new query succeeds after several file switches');
  assert(document.querySelectorAll('#open-files .opened-file').length===1 && row(first).closest('.workspace-group') && row(second).closest('.workspace-group'),'workspace files are not duplicated in Open files');
  assert(document.querySelectorAll('.close-file').length===3,'each open file has its own close control');
  assert(!$('notification').classList.contains('error') || $('notification').hidden,'no multi-file error');
  assert(!$('sql-panel').hidden && !$('data-panel').hidden,'combined Explore Data remains available');
}
return {checks,viewport:{width:innerWidth,height:innerHeight}};
