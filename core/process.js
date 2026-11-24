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
export function run(file, args, { timeout = 90000, maxOutput = 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(file, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '', reason, killTimer;
        function stop(error) {
            if (reason) return;
            reason = error;
            child.kill('SIGTERM');
            killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
        }
        const timer = setTimeout(() => stop(new Error('Tiempo de procesamiento agotado')), timeout);
        function collect(type, data) {
            if (reason) return;
            if (type === 'stdout') stdout += data;
            else stderr += data;
            if (stdout.length + stderr.length > maxOutput) stop(new Error('Salida del proceso demasiado grande'));
        }
        child.stdout.on('data', d => collect('stdout', d));
        child.stderr.on('data', d => collect('stderr', d));
        child.once('error', e => { clearTimeout(timer); clearTimeout(killTimer); reject(e); });
        child.once('close', code => {
            clearTimeout(timer); clearTimeout(killTimer);
            if (reason) reject(reason);
            else if (code !== 0) reject(new Error('Proceso fallido (' + code + ')'));
            else resolve({ stdout, stderr });
        });
    });
}
