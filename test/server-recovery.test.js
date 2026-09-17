import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('web service survives invalid PDFs, cancellation, and subsequent valid uploads', {timeout:20000}, async () => {
  const server=spawn(process.execPath,[fileURLToPath(new URL('../src/server.js',import.meta.url))],{
    env:{...process.env,CONTRACT_INTAKE_PORT:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true
  });
  try {
    const base=await new Promise((resolve,reject)=>{
      let output='';
      const timer=setTimeout(()=>reject(new Error('server did not start')),5000);
      server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
      server.once('error',reject);
    });
    const upload=async (name,content,jobId='')=>{
      const body=new FormData();body.append('documents',new Blob([content]),name);body.append('jobId',jobId);
      const response=await fetch(base+'/api/extract',{method:'POST',body});
      return response;
    };
    const bad=await upload('broken.pdf','%PDF-invalid data');
    const errors=(await bad.text()).split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(errors.at(-1).type,'error');
    assert.equal((await(await fetch(base+'/api/health')).json()).ok,true);
    // A queued parse can be cancelled immediately, and the next worker can start.
    const pending=await upload('large.txt','Unlabeled data\n'.repeat(200000),'cancel-test');
    const cancellation=await(await fetch(base+'/api/cancel/cancel-test',{method:'POST'})).json();
    assert.equal(cancellation.cancelled,true);
    const cancelled=(await pending.text()).split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(cancelled.at(-1).type,'cancelled');
    const good=await upload('inspection confirmation.txt','Inspection appointment scheduled for 09/18/2026 at 10:00 AM\nInspector: Ada Lewis');
    const result=(await good.text()).split('\n').filter(Boolean).map(JSON.parse).find(event=>event.type==='result');
    assert.ok(result,'valid upload after errors and cancellation must succeed');
    assert.match(result.email,/09\/18\/2026 at 10:00 AM/);
    assert.equal((await(await fetch(base+'/api/health')).json()).ok,true);
  } finally {server.kill();await once(server,'exit');}
});
