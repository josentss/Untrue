import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

export const authDir = resolve(process.env.AUTH_DIR || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'sessions') : './sessions'));
export const tempDir = resolve(process.env.TEMP_DIR || join(tmpdir(), 'untrue'));
export function binary(name, env) {
    return process.env[env] || (existsSync(resolve('bin', name)) ? resolve('bin', name) : name);
}
export const ffmpeg = binary('ffmpeg', 'FFMPEG_PATH');
export const ffprobe = binary('ffprobe', 'FFPROBE_PATH');
export const ytDlp = binary('yt-dlp', 'YTDLP_PATH');
export const galleryPython = process.env.GALLERY_PYTHON || 'python3';
export function positiveInt(value, fallback, max) {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 && n <= max ? n : fallback;
}
export const maxJobs = positiveInt(process.env.MAX_MEDIA_JOBS, 2, 16);
export const maxInputBytes = positiveInt(process.env.MAX_MEDIA_MB, 100, 500) * 1024 * 1024;
