const checks=[];
const assert=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message)};
const $=id=>document.getElementById(id);
const wait=async()=>{for(let i=0;i<300;i++){if($('busy').hidden)return;await new Promise(r=>setTimeout(r,50))}throw new Error('R2 UI busy timeout')};
const click=async id=>{$(id).click();await wait()};
if(workspacePhase==='r2'){
 await click('open-data');assert($('source-dialog').open && !$('sources-local').hidden && document.querySelectorAll('.sidebar > .open-button').length===1,'one launcher opens local source choices');
 await click('source-cloud');await click('open-r2');await click('r2-back');assert($('source-dialog').open && !$('sources-cloud').hidden && !$('r2-dialog').open,'R2 back returns to cloud choices');
 await click('open-r2');assert($('r2-dialog').open,'native connection dialog opens');
 $('r2-name').value='R2 analytics';$('r2-endpoint').value='https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com';$('r2-bucket').value='fixture-bucket';$('r2-prefix').value='data';$('r2-access').value='fixture-access';$('r2-secret').value='fixture-secret';
 $('r2-form').requestSubmit();await wait();
 assert(!$('r2-dialog').open && document.querySelectorAll('.workspace-group').length===1,'R2 connection tested and workspace mounted');
 assert(!$('workspace').hidden && $('sql').value==='' && $('column-count').textContent==='—','R2 editor available without opening a file');
 assert($('r2-secret').value==='' && $('r2-access').value==='' && !document.body.textContent.includes('fixture-secret'),'credential fields cleared and not rendered');
 assert(document.querySelectorAll('.tree-file').length===4,'R2 Parquet directory listed');
 $('sql').value='SELECT a.order_id,b.city FROM workspace."orders.parquet" a JOIN workspace."nested/copy.parquet" b USING(order_id) ORDER BY order_id';$('sql').dispatchEvent(new Event('input',{bubbles:true}));await click('run');
 assert(document.querySelectorAll('#grid tbody tr').length===100 && document.querySelector('#grid tbody td:nth-child(2)').textContent==='1001','R2 cross-file join without opening documents');
 await click('next');assert(document.querySelector('#grid tbody td:nth-child(2)').textContent==='1101','R2 query pagination');
 document.querySelector('.tree-file[data-path="special.parquet"]').click();await wait();
 assert(document.querySelector('#grid tbody td:nth-child(2)').textContent==='9223372036854775807','R2 exact BIGINT');
 await click('tab-schema');assert(document.querySelectorAll('#schema-body tr').length===12,'R2 schema metadata');
 document.querySelector('.workspace-name').click();await wait();
 assert($('sql').value.includes('JOIN') && document.querySelector('#grid tbody td:nth-child(2)').textContent==='1101','workspace draft and query page survive file switch');
 document.querySelector('.tree-file[data-path="special.parquet"]').parentElement.querySelector('.close-file').click();await wait();
 assert(!$('workspace').hidden && $('open-files-panel').hidden,'closing R2 file retains workspace editor');
 $('sql').value='SELECT 1; DROP TABLE data';$('sql').dispatchEvent(new Event('input',{bubbles:true}));await click('run');assert(!$('notification').hidden && $('notification').textContent.includes('statement'),'R2 rejects multiple statements');
 $('sql').value='SELECT order_id FROM workspace."orders.parquet" ORDER BY order_id';$('sql').dispatchEvent(new Event('input',{bubbles:true}));await click('run');
 assert(document.querySelector('.local-badge').textContent==='R2 / read-only','remote source clearly labeled');
 const rowsReady=async count=>{for(let i=0;i<100;i++){if(document.querySelectorAll('.connection-item').length===count)return;await new Promise(r=>setTimeout(r,20))}throw Error('settings rows timeout')};
 const action=async name=>{document.querySelector('[data-action="'+name+'"]').click();await wait()};
 await click('settings');await rowsReady(1);assert($('settings-dialog').open && !$('connection-list').textContent.includes('fixture-secret'),'settings lists connection without credentials');
 await action('test');assert($('settings-message').textContent==='Connection successful.','settings tests saved credentials');
 await action('edit');assert($('r2-access').value==='' && $('r2-secret').value==='' && $('r2-bucket').readOnly,'editing never returns secrets and locks active location');
 $('r2-name').value='Edited analytics';$('r2-form').requestSubmit();await wait();await rowsReady(1);assert($('file-name').textContent==='Edited analytics' && $('sql').value.includes('workspace."orders.parquet"'),'rename preserves active workspace SQL');
 await click('settings-dismiss');document.querySelector('[data-control="folder-close"]').click();await wait();
 await click('settings');await rowsReady(1);assert($('welcome').hidden===false && $('connection-list').textContent.includes('Saved'),'closing workspace retains saved connection');
 await action('open');assert(!$('workspace').hidden && $('sql').value.includes('workspace."orders.parquet"'),'saved connection reopens without reentering keys');
 await click('settings');await rowsReady(1);await action('delete');await action('confirm-delete');await rowsReady(0);assert($('welcome').hidden===false && !document.querySelector('.workspace-group'),'explicit delete removes connection and closes workspace');
 await click('settings-add');$('r2-name').value='R2 analytics';$('r2-endpoint').value='https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com';$('r2-bucket').value='fixture-bucket';$('r2-prefix').value='data';$('r2-access').value='fixture-access';$('r2-secret').value='fixture-secret';$('r2-form').requestSubmit();await wait();await rowsReady(1);
 assert($('settings-dialog').open && $('welcome').hidden===false,'adding in Settings saves without opening workspace');
 await action('open');$('sql').value='SELECT order_id FROM workspace."orders.parquet" ORDER BY order_id';$('sql').dispatchEvent(new Event('input',{bubbles:true}));await click('run');
 await click('settings');await rowsReady(1);await click('settings-add');$('r2-name').value='Archive';$('r2-endpoint').value='https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com';$('r2-bucket').value='fixture-bucket';$('r2-prefix').value='data/nested';$('r2-access').value='fixture-access';$('r2-secret').value='fixture-secret';$('r2-form').requestSubmit();await wait();await rowsReady(2);
 assert(document.querySelectorAll('.workspace-group').length===1 && $('connection-list').textContent.includes('Archive'),'saved connections coexist with only selected workspace open');await click('settings-dismiss');

}else{
 assert(document.querySelectorAll('.workspace-group').length===1,'R2 connection restored from local metadata');
 await click('settings');for(let i=0;i<100 && document.querySelectorAll('.connection-item').length!==2;i++)await new Promise(r=>setTimeout(r,20));assert(document.querySelectorAll('.connection-item').length===2 && $('connection-list').textContent.includes('Archive'),'closed saved connection survives process restart without opening');await click('settings-dismiss');
 assert($('file-name').textContent==='R2 analytics' && $('sql').value.includes('workspace."orders.parquet"'),'R2 workspace editor and SQL restored');
 assert(document.querySelectorAll('#grid tbody tr').length===100,'R2 restored query executes');
 document.querySelector('.tree-file[data-path="orders.parquet"]').click();await wait();
 document.querySelector('[data-control="folder-close"]').click();await wait();
 assert($('welcome').hidden===false && $('open-files-panel').hidden && !document.querySelector('.workspace-group'),'R2 workspace close cascades its documents');
 // Leave a populated preview for the shared screenshot/layout harness.
 await click('open-r2');$('r2-endpoint').value='https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com';$('r2-bucket').value='fixture-bucket';$('r2-prefix').value='data';$('r2-access').value='fixture-access';$('r2-secret').value='fixture-secret';$('r2-form').requestSubmit();await wait();
 $('sql').value='SELECT * FROM workspace."orders.parquet"';$('sql').dispatchEvent(new Event('input',{bubbles:true}));await click('run');
}
return {checks};
