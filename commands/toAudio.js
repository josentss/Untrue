import { ffmpeg as ffmpegPath } from '../core/config.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'util';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';

const execPromise = promisify(exec);

function getFfmpegPath() {
    return ffmpegPath;
}

export async function toAudioCommand(sock, m) {
    let tempVideoPath, tempAudioPath;

    try {
        const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (!quoted) {
            await sock.sendMessage(m.key.remoteJid, {
                text: 'Responde a un video con #toa'
            }, { quoted: m });
            return;
        }

        if (!quoted.videoMessage && !quoted.documentMessage) {
            await sock.sendMessage(m.key.remoteJid, {
                text: 'El mensaje no contiene un video válido.'
            }, { quoted: m });
            return;
        }

        await sock.sendMessage(m.key.remoteJid, {
            text: 'Extrayendo audio...'
        }, { quoted: m });

        let messageContent, downloadType;

        if (quoted.videoMessage) {
            downloadType = 'video';
            messageContent = quoted.videoMessage;
        } else {
            downloadType = 'document';
            messageContent = quoted.documentMessage;
        }

        const stream = await downloadContentFromMessage(messageContent, downloadType);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const videoBuffer = Buffer.concat(chunks);

        if (!videoBuffer.length) throw new Error('No se pudo descargar el video');

        tempVideoPath = join(tmpdir(), `video-${Date.now()}.mp4`);
        tempAudioPath = join(tmpdir(), `audio-${Date.now()}.mp3`);
        writeFileSync(tempVideoPath, videoBuffer);

        const ffmpeg = getFfmpegPath();
        const cmd = `"${ffmpeg}" -i "${tempVideoPath}" -vn -acodec libmp3lame -ab 128k -ar 44100 -y "${tempAudioPath}"`;

        try {
            await execPromise(cmd);
        } catch {
            const alt = `"${ffmpeg}" -i "${tempVideoPath}" -q:a 0 -map a "${tempAudioPath}"`;
            await execPromise(alt);
        }

        if (!existsSync(tempAudioPath)) throw new Error('No se generó el audio');

        const audioBuffer = readFileSync(tempAudioPath);

        await sock.sendMessage(m.key.remoteJid, {
            audio: audioBuffer,
            mimetype: 'audio/mpeg',
            ptt: false
        }, { quoted: m });

    } catch (error) {
        console.error('Error in toAudio:', error.message);
        await sock.sendMessage(m.key.remoteJid, {
            text: `Error: ${error.message}`
        }, { quoted: m });
    } finally {
        try {
            if (tempVideoPath && existsSync(tempVideoPath)) unlinkSync(tempVideoPath);
            if (tempAudioPath && existsSync(tempAudioPath)) unlinkSync(tempAudioPath);
        } catch {}
    }
}
