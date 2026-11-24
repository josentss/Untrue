import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs, {
    unlinkSync,
    rmSync,
    createWriteStream,
    writeFileSync,
    existsSync,
    mkdirSync,
    statSync
} from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'util';
import axios from 'axios';
import Tiktok from '@tobyg74/tiktok-api-dl';

const execPromise = promisify(exec);
import { ffmpeg as ffmpegCommand } from '../core/config.js';
const COBALT_API = (process.env.COBALT_API_URL || '').replace(/\/$/, '');

function getDefaultVideoInfo() {
    return {
        title: 'TikTok',
        author: 'Desconocido',
        uploadDate: 'Desconocida',
        description: '',
        isCarousel: false
    };
}

export function cleanUpFile(filePath) {
    try {
        if (!filePath) return;
        if (String(filePath).includes('tiktok-carousel')) {
            rmSync(filePath, { recursive: true, force: true });
        } else if (existsSync(filePath)) {
            unlinkSync(filePath);
        }
    } catch (e) {
        console.warn(`Error limpiando: ${e.message}`);
    }
}

function firstUrl(value) {
    if (!value) return null;
    if (typeof value === 'string' && value.startsWith('http')) return value;
    if (Array.isArray(value)) {
        for (const item of value) {
            const u = firstUrl(item);
            if (u) return u;
        }
    }
    if (typeof value === 'object') {
        if (typeof value.url === 'string') return value.url;
        if (typeof value.src === 'string') return value.src;
    }
    return null;
}

function pickVideoUrl(result) {
    const r = result?.result || result || {};
    const candidates = [
        r.videoHD,
        r.videoSD,
        r.videoWatermark,
        r.video?.downloadAddr,
        r.video?.playAddr,
        r.video?.play,
        r.play,
        r.video,
        r.download?.url,
        r.direct
    ];
    for (const c of candidates) {
        const u = firstUrl(c);
        if (u) return u;
    }
    return null;
}

function pickMusicUrl(result) {
    const r = result?.result || result || {};
    const candidates = [r.music?.playUrl, r.music, r.music_url, r.sound];
    for (const c of candidates) {
        const u = firstUrl(c);
        if (u) return u;
    }
    return null;
}

function pickImages(result) {
    const r = result?.result || result || {};
    const images = r.images || r.image || [];
    if (!Array.isArray(images)) return [];
    return images.map(firstUrl).filter(Boolean);
}

function buildInfo(result) {
    const r = result?.result || result || {};

    const author =
        r.author?.nickname ||
        r.author?.username ||
        r.author?.unique_id ||
        r.author?.uniqueId ||
        (typeof r.author === 'string' ? r.author : null) ||
        r.nickname ||
        'Desconocido';

    const title =
        r.desc ||
        r.description ||
        r.title ||
        r.caption ||
        'TikTok';

    const images = pickImages(result);
    const videoUrl = pickVideoUrl(result);

    return {
        title: String(title).trim() || 'TikTok',
        author: String(author).trim() || 'Desconocido',
        uploadDate: 'Desconocida',
        description: String(title).trim() || '',
        isCarousel: images.length > 0 && !videoUrl
    };
}

async function fetchTiktokLib(url) {
    const versions = ['v3', 'v1', 'v2'];
    let lastError;

    for (const version of versions) {
        try {
            const result = await Tiktok.Downloader(url, { version });
            if (result?.status === 'success' || result?.status === true || result?.result) {
                const videoUrl = pickVideoUrl(result);
                const images = pickImages(result);
                if (videoUrl || images.length) {
                    console.log(`TikTok lib OK (${version}): video=${!!videoUrl} images=${images.length}`);
                    return result;
                }
            }
            lastError = new Error(result?.message || `Sin media (${version})`);
        } catch (e) {
            lastError = e;
            console.error(`TikTok ${version}:`, e.message);
        }
    }

    throw lastError || new Error('No se pudo obtener el contenido de TikTok');
}

async function fetchViaCobalt(url, mode = 'auto') {
    if (!COBALT_API) return null;

    try {
        const res = await fetch(`${COBALT_API}/`, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url,
                downloadMode: mode,
                tiktokFullAudio: mode === 'audio'
            })
        });

        const data = await res.json();
        if (data.status === 'error') {
            console.error('Cobalt TikTok error:', data.error?.code);
            return null;
        }

        if (data.status === 'tunnel' || data.status === 'redirect') {
            return { type: 'file', url: data.url, filename: data.filename };
        }

        if (data.status === 'picker' && data.picker?.length) {
            return {
                type: 'picker',
                items: data.picker,
                audio: data.audio
            };
        }

        return null;
    } catch (e) {
        console.error('Cobalt TikTok fail:', e.message);
        return null;
    }
}

async function downloadUrlToFile(fileUrl, destPath) {
    const res = await axios.get(fileUrl, {
        responseType: 'arraybuffer',
        timeout: 90000,
        maxRedirects: 5,
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Referer: 'https://www.tiktok.com/',
            Accept: '*/*'
        }
    });

    const buf = Buffer.from(res.data);
    if (buf.length < 500) {
        throw new Error(`Archivo muy pequeño (${buf.length} B)`);
    }

    writeFileSync(destPath, buf);
    return destPath;
}

export async function getTiktokVideoInfo(url) {
    try {
        const result = await fetchTiktokLib(url);
        return buildInfo(result);
    } catch {
        return getDefaultVideoInfo();
    }
}

export async function downloadTiktokVideo(url) {
    const tempFilePath = join(tmpdir(), `tiktok-video-${Date.now()}.mp4`);

    try {
        let videoInfo = getDefaultVideoInfo();

        try {
            const metaResult = await fetchTiktokLib(url);
            videoInfo = buildInfo(metaResult);
        } catch (e) {
            console.warn('Metadata TikTok:', e.message);
        }

        const cobalt = await fetchViaCobalt(url, 'auto');
        if (cobalt?.type === 'file' && cobalt.url) {
            await downloadUrlToFile(cobalt.url, tempFilePath);
            return { filePath: tempFilePath, videoInfo };
        }

        if (cobalt?.type === 'picker') {
            const video = cobalt.items.find(i => i.type === 'video') || cobalt.items[0];
            if (video?.url) {
                await downloadUrlToFile(video.url, tempFilePath);
                return { filePath: tempFilePath, videoInfo };
            }
        }

        const result = await fetchTiktokLib(url);
        videoInfo = buildInfo(result);
        const videoUrl = pickVideoUrl(result);

        if (!videoUrl) {
            console.error('Result keys:', JSON.stringify(Object.keys(result?.result || {})));
            throw new Error('No se encontró URL de video');
        }

        await downloadUrlToFile(videoUrl, tempFilePath);

        if (!existsSync(tempFilePath) || statSync(tempFilePath).size < 1000) {
            throw new Error('Video descargado inválido');
        }

        return { filePath: tempFilePath, videoInfo };
    } catch (error) {
        console.error('Error video TikTok:', error.message);
        cleanUpFile(tempFilePath);
        return null;
    }
}

export async function downloadTiktokAudio(url) {
    const tempVideoPath = join(tmpdir(), `tiktok-va-${Date.now()}.mp4`);
    const tempAudioPath = join(tmpdir(), `tiktok-audio-${Date.now()}.mp3`);

    try {
        let videoInfo = getDefaultVideoInfo();

        try {
            const metaResult = await fetchTiktokLib(url);
            videoInfo = buildInfo(metaResult);
        } catch (e) {
            console.warn('Metadata TikTok audio:', e.message);
        }

        const cobalt = await fetchViaCobalt(url, 'audio');
        if (cobalt?.type === 'file' && cobalt.url) {
            await downloadUrlToFile(cobalt.url, tempAudioPath);
            return {
                filePath: tempAudioPath,
                videoInfo,
                mimetype: 'audio/mpeg'
            };
        }

        const result = await fetchTiktokLib(url);
        videoInfo = buildInfo(result);
        const musicUrl = pickMusicUrl(result);

        if (musicUrl) {
            await downloadUrlToFile(musicUrl, tempAudioPath);
            return { filePath: tempAudioPath, videoInfo, mimetype: 'audio/mpeg' };
        }

        const videoUrl = pickVideoUrl(result);
        if (!videoUrl) throw new Error('No hay audio ni video');

        await downloadUrlToFile(videoUrl, tempVideoPath);
        await execPromise(
            `"${ffmpegCommand}" -i "${tempVideoPath}" -vn -acodec libmp3lame -ab 128k -y "${tempAudioPath}"`
        );
        cleanUpFile(tempVideoPath);

        return { filePath: tempAudioPath, videoInfo, mimetype: 'audio/mpeg' };
    } catch (error) {
        console.error('Error audio TikTok:', error.message);
        cleanUpFile(tempVideoPath);
        cleanUpFile(tempAudioPath);
        return null;
    }
}

export async function downloadTiktokImages(url) {
    const tempDir = join(tmpdir(), `tiktok-carousel-${Date.now()}`);

    try {
        mkdirSync(tempDir, { recursive: true });

        let videoInfo = getDefaultVideoInfo();

        try {
            const metaResult = await fetchTiktokLib(url);
            videoInfo = buildInfo(metaResult);
            videoInfo.isCarousel = true;
        } catch (e) {
            console.warn('Metadata carrusel:', e.message);
        }

        const cobalt = await fetchViaCobalt(url, 'auto');
        if (cobalt?.type === 'picker') {
            const photos = cobalt.items.filter(i => i.type === 'photo' || i.type === 'gif');
            if (photos.length) {
                for (let i = 0; i < photos.length; i++) {
                    await downloadUrlToFile(photos[i].url, join(tempDir, `${i + 1}.jpeg`));
                }
                return {
                    filePaths: tempDir,
                    videoInfo: { ...videoInfo, isCarousel: true }
                };
            }
        }

        const result = await fetchTiktokLib(url);
        videoInfo = buildInfo(result);
        const imageUrls = pickImages(result);

        if (!imageUrls.length) {
            throw new Error('No hay imágenes en este post');
        }

        videoInfo.isCarousel = true;

        for (let i = 0; i < imageUrls.length; i++) {
            const filePath = join(tempDir, `${i + 1}.jpeg`);
            const res = await axios.get(imageUrls[i], {
                responseType: 'stream',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    Referer: 'https://www.tiktok.com/'
                }
            });
            await new Promise((resolve, reject) => {
                const writer = createWriteStream(filePath);
                res.data.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
        }

        return { filePaths: tempDir, videoInfo };
    } catch (error) {
        console.error('Error carrusel TikTok:', error.message);
        cleanUpFile(tempDir);
        return null;
    }
}
