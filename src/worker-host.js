import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let worker;
let busy = false;
export function processPacket(files, supplemental, onEvent, signal) {
  if (busy) return Promise.reject(new Error('Another transaction is still processing. Please wait or cancel it.'));
  busy = true;
  if (worker && !worker.connected) worker = null;
  worker ??= fork(fileURLToPath(new URL('./worker.js', import.meta.url)), [], {
    serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true
  });
  const current = worker;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      current.off('message', message); current.off('exit', exited); current.off('error', failed);
      signal?.removeEventListener('abort', cancelled); busy = false;
    };
    const failed = () => { cleanup(); current.kill(); worker = null; reject(new Error('The document reader stopped. The app is still running; please retry the packet.')); };
    const exited = () => failed();
    const cancelled = () => { cleanup(); current.kill(); worker = null; reject(Object.assign(new Error('Extraction cancelled.'), { code: 'CANCELLED' })); };
    const message = event => {
      if (event.type === 'result') { cleanup(); resolve(event); }
      else if (event.type === 'error') { cleanup(); reject(new Error(event.message)); }
      else onEvent(event);
    };
    const timeout = setTimeout(() => { cleanup(); current.kill(); worker = null; reject(new Error('Reading this packet took too long. Try fewer documents at a time.')); }, 180_000);
    current.on('message', message); current.once('exit', exited); current.once('error', failed);
    signal?.addEventListener('abort', cancelled, { once: true });
    current.send({ files, supplemental }, error => { if (error && busy) failed(); });
  });
}
export function stopReader() { worker?.kill(); worker = null; }
