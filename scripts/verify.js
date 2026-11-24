import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const skip = new Set(['node_modules', '.git', 'sessions', 'temp', 'data', 'database']);
let count = 0;
async function check(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
        if (skip.has(item.name)) continue;
        const path = join(dir, item.name);
        if (item.isDirectory()) await check(path);
        else if (item.name.endsWith('.js')) {
            const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
            if (result.status !== 0) process.exit(result.status || 1);
            count++;
        }
    }
}
await check('.');
console.log(count + ' archivos JavaScript verificados');
