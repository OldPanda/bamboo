const checks = [];
const assert = (ok, text) => { if (!ok) throw new Error(text); checks.push(text); };
const $ = id => document.getElementById(id);
const wait = async () => { for (let i=0;i<200;i++) { if ($('busy').hidden) return; await new Promise(r=>setTimeout(r,30)); } throw new Error('workspace stayed busy'); };
const click = async id => { $(id).click(); await wait(); };
assert(!$('folder-panel').hidden, 'workspace restored or opened');
assert(!document.querySelector('dialog'), 'no cell modal');
const phase = workspacePhase;
if (phase === 'restore') {
 assert($('folder-name').textContent === 'Research workspace', 'workspace name restored across process launches');
 assert($('breadcrumb').textContent === 'orders.parquet', 'active file restored across process launches');
 assert($('sql').value === 'SELECT city, count(*) AS orders FROM data GROUP BY city', 'SQL restored across process launches');
 assert(document.querySelectorAll('#grid tbody tr').length === 4, 'saved SQL executed against restored file');
} else {
 assert($('welcome').hidden === false, 'folder starts without loading all files');
 assert(document.querySelectorAll('.tree-file').length >= 3, 'Parquet files listed without scanning their data');
 const nested = [...document.querySelectorAll('.tree-folder')].find(b=>b.dataset.path==='nested');
 nested.click(); await wait();
 assert(nested.getAttribute('aria-expanded')==='true', 'directory expands on demand over real IPC');
 const nestedFile = [...document.querySelectorAll('.tree-file')].find(b=>b.dataset.path==='nested/orders-copy.parquet');
 nestedFile.click(); await wait();
 assert($('breadcrumb').textContent==='nested/orders-copy.parquet', 'nested Parquet opens within workspace');
 const file = [...document.querySelectorAll('.tree-file')].find(b=>b.dataset.path==='orders.parquet');
 file.click(); await wait();
 assert(document.querySelectorAll('#grid tbody tr').length===100, 'file click opens bounded first page');
 assert($('scope-name').textContent === $('folder-name').textContent, 'breadcrumb uses actual workspace name');
 await click('folder-rename'); $('folder-name-input').value = 'Research workspace'; $('folder-rename-form').requestSubmit(); await wait();
 assert($('scope-name').textContent==='Research workspace', 'inline workspace rename updates breadcrumb');
 $('sql').value='SELECT city, count(*) AS orders FROM data GROUP BY city'; $('sql').dispatchEvent(new Event('input')); await click('run');
 assert(document.querySelectorAll('#grid tbody tr').length===4, 'workspace SQL previews aggregation');
 const empty=[...document.querySelectorAll('.tree-file')].find(b=>b.dataset.path==='empty.parquet');empty.click();await wait();
 assert(document.querySelectorAll('#grid tbody tr').length===0, 'switch to empty Parquet');
 file.click(); await wait();
 assert($('sql').value.includes('GROUP BY city') && document.querySelectorAll('#grid tbody tr').length===4, 'file switch preserves query and results');
}
await click('tab-schema'); assert(!$('schema-panel').hidden, 'workspace schema available');
await click('tab-explore'); assert(!$('sql-panel').hidden && !$('data-panel').hidden, 'Explore Data retained');
assert(!$('notification').classList.contains('error') || $('notification').hidden, 'no workspace error');
return {checks, viewport:{width:innerWidth,height:innerHeight}};
