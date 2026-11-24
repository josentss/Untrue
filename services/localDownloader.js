import { join } from 'node:path';
import { stat, access } from 'node:fs/promises';
import { run, withTemp } from '../core/process.js';
import { ytDlp, ffmpeg, maxInputBytes } from '../core/config.js';
export async function sendLocalDownload(sock, m, input, { audio = false, cookies } = {}) {
    return withTemp(async dir => {
        const output = join(dir, audio ? 'media.mp3' : 'media.mp4');
        const args = ['--ignore-config','--no-playlist','--no-progress','--socket-timeout','15','--retries','1','--max-filesize',String(maxInputBytes),'--ffmpeg-location',ffmpeg === 'ffmpeg' ? '' : ffmpeg];
        if (ffmpeg === 'ffmpeg') args.splice(args.length-2,2);
        if (cookies) { await access(cookies); args.push('--cookies',cookies); }
        if (audio) args.push('-x','--audio-format','mp3','--audio-quality','128K');
        else args.push('-f','bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]','--merge-output-format','mp4');
        args.push('-o',output,'--',input);
        await run(ytDlp,args,{timeout:120000});
        const s = await stat(output);
        if (!s.size || s.size > maxInputBytes) throw Error('Archivo demasiado grande o vacío');
        await sock.sendMessage(m.key.remoteJid, audio ? { audio:{url:output},mimetype:'audio/mpeg',ptt:false } : {video:{url:output},mimetype:'video/mp4'}, {quoted:m});
    });
}
