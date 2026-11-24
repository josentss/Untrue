import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './config.js';

export async function withTemp(fn) {
    await mkdir(tempDir, { recursive: true, mode: 0o700 });
    const dir = await mkdtemp(join(tempDir, 'job-'));
    try { return await fn(dir); }
    finally { await rm(dir, { recursive: true, force: true }); }
}
export function run(file, args, { timeout = 90000, maxOutput = 1024 * 1024, signal, env, processGroup = false, diagnostics = false } = {}) {
    return new Promise((resolve, reject) => {
        const group=processGroup&&process.platform!=='win32';
        const child = spawn(file, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], ...(env?{env}:{}), detached:group });
        function kill(sig){try{if(group&&child.pid)process.kill(-child.pid,sig);else child.kill(sig);}catch(e){if(e.code!=='ESRCH')throw e;}}
        let stdout = '', stderr = '', reason, killTimer;
        function stop(error) {
            if (reason) return;
            reason = error;
            kill('SIGTERM');
            killTimer = setTimeout(() => kill('SIGKILL'), 3000);
        }
        const timer = setTimeout(() => stop(new Error('Tiempo de procesamiento agotado')), timeout);
        const abort=()=>stop(signal.reason instanceof Error?signal.reason:new Error('Proceso cancelado'));
        if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
        function cleanup(){clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);}
        function collect(type, data) {
            if (reason) return;
            if (type === 'stdout') stdout += data;
            else stderr += data;
            if (stdout.length + stderr.length > maxOutput) stop(new Error('Salida del proceso demasiado grande'));
        }
        child.stdout.on('data', d => collect('stdout', d));
        child.stderr.on('data', d => collect('stderr', d));
        child.once('error', e => { cleanup(); reject(e); });
        child.once('close', code => {
            cleanup();
            if (reason) reject(reason);
            else if (code !== 0) {const error=new Error('Proceso fallido (' + code + ')');if(diagnostics)error.diagnostic=stderr.slice(-8192);reject(error);}
            else resolve({ stdout, stderr });
        });
    });
}
