import { ffmpeg as ffmpegPath } from '../core/config.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'util';
import axios from 'axios';
import Tesseract from 'tesseract.js';
import { downloadContentFromMessage } from 'baileys';

const execPromise = promisify(exec);

function getFfmpegPath() {
    return ffmpegPath;
}

export async function totextCommand(sock, m) {
    let tempFilePath;

    try {
        const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (!quoted) {
            await sock.sendMessage(m.key.remoteJid, {
                text: 'Responde a una imagen o audio con #tot'
            }, { quoted: m });
            return;
        }

        let mediaType = '';
        let mediaBuffer = null;

        if (quoted.imageMessage) {
            mediaType = 'image';
            mediaBuffer = await downloadMedia(quoted.imageMessage, 'image');
        } else if (quoted.audioMessage) {
            mediaType = 'audio';
            mediaBuffer = await downloadMedia(quoted.audioMessage, 'audio');
        } else if (quoted.videoMessage) {
            mediaType = 'audio';
            mediaBuffer = await extractAudioFromVideo(quoted.videoMessage);
        } else {
            await sock.sendMessage(m.key.remoteJid, {
                text: 'Solo imagen o audio.'
            }, { quoted: m });
            return;
        }

        if (!mediaBuffer?.length) throw new Error('No se pudo descargar el medio');

        await sock.sendMessage(m.key.remoteJid, {
            text: mediaType === 'image' ? 'Extrayendo texto...' : 'Transcribiendo audio...'
        }, { quoted: m });

        const ext = mediaType === 'image' ? 'jpg' : 'mp3';
        tempFilePath = join(tmpdir(), `totext-${Date.now()}.${ext}`);
        writeFileSync(tempFilePath, mediaBuffer);

        let text = '';

        if (mediaType === 'image') {
            text = await processImage(tempFilePath);
        } else {
            const optimized = await optimizeAudio(tempFilePath);
            text = await transcribeAudio(optimized);
            if (optimized !== tempFilePath && existsSync(optimized)) {
                unlinkSync(optimized);
            }
        }

        text = cleanText(text);

        if (!text?.trim()) {
            await sock.sendMessage(m.key.remoteJid, {
                text: mediaType === 'image'
                    ? 'No se detectó texto en la imagen.'
                    : 'No se pudo transcribir el audio.'
            }, { quoted: m });
            return;
        }

        await sock.sendMessage(m.key.remoteJid, {
            text: `*Texto extraído*\n\n${text}`
        }, { quoted: m });

    } catch (error) {
        console.error('Error in totext:', error.message);
        await sock.sendMessage(m.key.remoteJid, {
            text: `Error: ${error.message}`
        }, { quoted: m });
    } finally {
        if (tempFilePath && existsSync(tempFilePath)) {
            try { unlinkSync(tempFilePath); } catch {}
        }
    }
}

async function downloadMedia(message, type) {
    const stream = await downloadContentFromMessage(message, type);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function extractAudioFromVideo(videoMessage) {
    const videoBuffer = await downloadMedia(videoMessage, 'video');
    const tempVideo = join(tmpdir(), `vid-${Date.now()}.mp4`);
    const tempAudio = join(tmpdir(), `aud-${Date.now()}.mp3`);

    writeFileSync(tempVideo, videoBuffer);
    const ffmpeg = getFfmpegPath();
    await execPromise(`"${ffmpeg}" -i "${tempVideo}" -vn -acodec libmp3lame -ab 128k -y "${tempAudio}"`);

    const audio = readFileSync(tempAudio);
    try {
        unlinkSync(tempVideo);
        unlinkSync(tempAudio);
    } catch {}
    return audio;
}

async function optimizeAudio(audioPath) {
    try {
        const out = join(tmpdir(), `opt-${Date.now()}.mp3`);
        const ffmpeg = getFfmpegPath();
        await execPromise(`"${ffmpeg}" -i "${audioPath}" -ac 1 -ar 16000 -b:a 64k -y "${out}"`);
        return out;
    } catch {
        return audioPath;
    }
}

async function processImage(imagePath) {
    const ocrText = await processWithOCRSpace(imagePath);
    if (ocrText && ocrText.trim().length > 10) return ocrText;

    const { data: { text } } = await Tesseract.recognize(imagePath, 'spa+eng');
    return text || '';
}

async function processWithOCRSpace(imagePath) {
    try {
        const buffer = readFileSync(imagePath);
        const API_KEY = process.env.OCR_SPACE_KEY;

        const response = await axios.post(
            'https://api.ocr.space/parse/image',
            {
                base64Image: `data:image/jpeg;base64,${buffer.toString('base64')}`,
                apikey: API_KEY,
                language: 'spa',
                OCREngine: 2,
                scale: true
            },
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
        );

        return response.data?.ParsedResults?.[0]?.ParsedText || null;
    } catch {
        return null;
    }
}

async function transcribeAudio(audioPath) {
    const API_KEY = process.env.ASSEMBLYAI_KEY;
    const buffer = readFileSync(audioPath);

    const upload = await axios.post(
        'https://api.assemblyai.com/v2/upload',
        buffer,
        {
            headers: {
                Authorization: API_KEY,
                'Content-Type': 'application/octet-stream'
            },
            timeout: 30000
        }
    );

    const { data } = await axios.post(
        'https://api.assemblyai.com/v2/transcript',
        {
            audio_url: upload.data.upload_url,
            language_code: 'es',
            punctuate: true,
            format_text: true
        },
        {
            headers: {
                Authorization: API_KEY,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        }
    );

    const id = data.id;

    for (let i = 0; i < 45; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const status = await axios.get(
            `https://api.assemblyai.com/v2/transcript/${id}`,
            { headers: { Authorization: API_KEY }, timeout: 10000 }
        );

        if (status.data.status === 'completed') return status.data.text;
        if (status.data.status === 'error') throw new Error(status.data.error || 'Error de transcripción');
    }

    throw new Error('Tiempo de espera agotado');
}

function cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
}
