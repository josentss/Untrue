import { downloadContentFromMessage } from 'baileys';
import fs from 'fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { run } from '../core/process.js';
import { ffmpeg, maxInputBytes } from '../core/config.js';
import { randomUUID } from 'node:crypto';
import WebP from 'node-webpmux';

const { Image: WebpMuxImage } = WebP;


function getFfmpegPath() {
    return ffmpeg;
}

function cleanUp(...files) {
    for (const f of files) {
        if (f && fs.existsSync(f)) {
            try { fs.unlinkSync(f); } catch {}
        }
    }
}

function generateExifBuffer(exifData) {
    const jsonBuffer = Buffer.from(JSON.stringify(exifData), 'utf-8');
    const header = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
        0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00,
        0x00, 0x00
    ]);
    header.writeUInt32LE(jsonBuffer.length + 1, 14);
    return Buffer.concat([header, jsonBuffer, Buffer.from([0x00])]);
}

async function injectMetadata(inputPath, outputPath, m) {
    const userName = m.pushName || 'Usuario';
    const date = new Date().toLocaleDateString('es-ES');
    const footer = `@${userName} | ${date}`;

    const img = new WebpMuxImage();
    await img.load(inputPath);
    img.exif = generateExifBuffer({
        'sticker-pack-id': 'untrue-bot',
        'sticker-pack-name': 'UntrueBot',
        'sticker-pack-publisher': footer,
        'author': footer,
        'emojis': ['✨']
    });
    await img.save(outputPath);
}

async function convertVideo(input, output, { fps, duration, quality, resolution }) {
    const ffmpeg = getFfmpegPath();
    const filter = `scale=${resolution}:${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:${resolution}:(ow-iw)/2:(oh-ih)/2:color=black@0,fps=${fps}`;

    try {
        await run(ffmpeg, ['-y','-i',input,'-t',String(duration),'-vcodec','libwebp','-vf',filter,'-loop','0','-lossless','0','-compression_level','4','-q:v',String(quality),'-an',output], { timeout:60000 });
        if (!fs.existsSync(output)) return { success: false, size: 0 };
        return { success: true, size: fs.statSync(output).size / 1024 };
    } catch {
        return { success: false, size: 0 };
    }
}

export async function mediaToStickerCommand(sock, m) {
    const jid = m.key.remoteJid;
    const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage || m.message;

    if (!quoted) {
        await sock.sendMessage(jid, { text: 'Responde a una imagen o video.' }, { quoted: m });
        return;
    }

    try {
        if (quoted.imageMessage) {
            await processImage(sock, m, quoted.imageMessage);
        } else if (quoted.videoMessage) {
            await processVideo(sock, m, quoted.videoMessage);
        } else {
            await sock.sendMessage(jid, { text: 'Solo imágenes o videos.' }, { quoted: m });
        }
    } catch (error) {
        console.error('Error in sticker:', error.message);
        await sock.sendMessage(jid, { text: 'Error creando el sticker.' }, { quoted: m });
    }
}

async function processImage(sock, m, imageMessage) {
    const jid = m.key.remoteJid;
    const tempIn = join(tmpdir(), `img-${randomUUID()}.jpg`);
    const tempWebp = join(tmpdir(), `img-${randomUUID()}.webp`);
    const finalWebp = join(tmpdir(), `sticker-${randomUUID()}.webp`);

    try {
        const stream = await downloadContentFromMessage(imageMessage, 'image');
        const chunks = [];
        let bytes = 0;
        for await (const c of stream) { bytes += c.length; if (bytes > maxInputBytes) throw Error('Archivo demasiado grande'); chunks.push(c); }
        fs.writeFileSync(tempIn, Buffer.concat(chunks));

        await sharp(tempIn)
            .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .webp({ quality: 75 })
            .toFile(tempWebp);

        await injectMetadata(tempWebp, finalWebp, m);
        if (fs.statSync(finalWebp).size > 1024 * 1024) throw Error('Sticker demasiado grande');
        await sock.sendMessage(jid, { sticker: fs.readFileSync(finalWebp) }, { quoted: m });
    } finally {
        cleanUp(tempIn, tempWebp, finalWebp);
    }
}

async function processVideo(sock, m, videoMessage) {
    const jid = m.key.remoteJid;
    const duration = Number(videoMessage.seconds) || 15;

    if (duration > 15) {
        await sock.sendMessage(jid, { text: 'Máximo 15 segundos.' }, { quoted: m });
        return;
    }

    const tempIn = join(tmpdir(), `vid-${randomUUID()}.mp4`);
    const tempWebp = join(tmpdir(), `vid-${randomUUID()}.webp`);
    const finalWebp = join(tmpdir(), `sticker-${randomUUID()}.webp`);

    try {
        const stream = await downloadContentFromMessage(videoMessage, 'video');
        const chunks = [];
        let bytes = 0;
        for await (const c of stream) { bytes += c.length; if (bytes > maxInputBytes) throw Error('Archivo demasiado grande'); chunks.push(c); }
        fs.writeFileSync(tempIn, Buffer.concat(chunks));

        let fps = duration < 5 ? 20 : duration > 10 ? 12 : 15;
        let quality = 50;
        let resolution = 512;

        let result = await convertVideo(tempIn, tempWebp, { fps, duration, quality, resolution });

        if (result.success && result.size > 900) {
            quality = 30;
            fps = Math.max(10, fps - 5);
            result = await convertVideo(tempIn, tempWebp, { fps, duration, quality, resolution });
        }

        if (result.success && result.size > 900) {
            resolution = 384;
            quality = 20;
            fps = 10;
            result = await convertVideo(tempIn, tempWebp, { fps, duration, quality, resolution });
        }

        if (!result.success || result.size > 1050) {
            throw new Error('No se pudo comprimir el video bajo 1MB');
        }

        await injectMetadata(tempWebp, finalWebp, m);

        if (fs.statSync(finalWebp).size > 1024 * 1024) {
            await sock.sendMessage(jid, { text: 'Sticker demasiado pesado.' }, { quoted: m });
            return;
        }

        await sock.sendMessage(jid, { sticker: fs.readFileSync(finalWebp) }, { quoted: m });
    } finally {
        cleanUp(tempIn, tempWebp, finalWebp);
    }
}
