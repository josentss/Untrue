import { downloadYoutubeAudio, cleanUpFile } from '../services/youtubeDownloader.js';
import fs from 'fs';

/**
 * Obtiene el MIME type según la exten
 * @param {string} ext - Extensión del archivo
 * @returns {string} MIME type
 */
function getMimetype(ext) {
    const mimeTypes = {
        m4a: 'audio/mp4',
        mp4: 'audio/mp4',
        mp3: 'audio/mpeg',
        webm: 'audio/webm',
        ogg: 'audio/ogg',
        aac: 'audio/aac',
        opus: 'audio/opus'
    };
    return mimeTypes[ext?.toLowerCase()] || 'audio/mpeg';
}

/**
 * Formatea duración en segundos a formato legible
 * @param {number} seconds - Segundos
 * @returns {string} Duración formateada
 */
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return 'N/A';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0
        ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
        : `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Valida que ffmpeg esté instalado
 * @returns {Promise<boolean>}
 */
async function checkFFmpegAvailable() {
    const { exec } = await import('child_process');
    return new Promise((resolve) => {
        exec('ffmpeg -version', (error) => {
            resolve(!error);
        });
    });
}

/**
 * Comando para descargar audio de YouTube
 * Uso: #yta [URL o búsqueda]
 * @param {object} sock - Instancia de Baileys
 * @param {object} m - Mensaje
 * @param {array} args - Argumentos
 * @param {string} format - Formato de audio (mp3, m4a, opus, vorbis)
 */
export async function youtubeAudioCommand(sock, m, args, format = 'mp3') {
    const jid = m.key.remoteJid;
    let filePath = null;

    if (!args?.length) {
        await sock.sendMessage(jid, {
            text: '🎵 *Descargador de Audio de YouTube*\n\n' +
                  'Uso:\n' +
                  '  #yta <URL>\n' +
                  '  #yta <búsqueda>\n\n' +
                  '  #yta <búsqueda> (MP3)\n\n' +
                  'Ejemplos:\n' +
                  '  #yta bad bunny tití\n' +
                  '  #yta https://www.youtube.com/watch?v=...'
        }, { quoted: m });
        return;
    }

    try {

        const statusMsg = await sock.sendMessage(jid, {
            text: `⏳ Descargando audio (${format.toUpperCase()})...\n\n_Buscando y procesando..._`
        }, { quoted: m });

        const result = await downloadYoutubeAudio(args, format);

        if (!result?.filePath || !fs.existsSync(result.filePath)) {
            throw new Error('El archivo no se guardó correctamente');
        }

        filePath = result.filePath;
        const stats = fs.statSync(filePath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        const info = result.videoInfo || {};
        const ext = filePath.split('.').pop().toLowerCase();

        if (stats.size > 100 * 1024 * 1024) {
            throw new Error(`El audio es muy grande (${sizeMB}MB). Máximo 100MB`);
        }

        const caption =
            `*🎵 ${info.title || 'Audio'}*\n\n` +
            `👤 Autor: ${info.author || 'Desconocido'}\n` +
            `⏱️ Duración: ${info.durationFormatted || 'N/A'}\n` +
            `📦 Tamaño: ${sizeMB} MB\n` +
            `🎚️ Formato: ${format.toUpperCase()}`;

        console.log(`✅ Enviando audio: ${info.title}`);

        await sock.sendMessage(jid, {
            audio: { url: filePath },
            mimetype: getMimetype(ext),
            fileName: `${(info.title || 'audio').substring(0, 40)}.${ext}`,
            ptt: false
        }, { quoted: m });

        await sock.sendMessage(jid, {
            text: caption
        }, { quoted: m });

    } catch (error) {
        console.error('❌ Error en comando yta:', error.message);

        let errorMsg = '❌ Error descargando audio\n\n';

        if (error.message.includes('No se encontraron resultados')) {
            errorMsg += 'No encontré resultados para esa búsqueda.\n\n' +
                       'Intenta con:\n' +
                       '  • Otro título\n' +
                       '  • Una URL válida\n' +
                       '  • Menos palabras clave';
        } else if (error.message.includes('muy grande')) {
            errorMsg += error.message + '\n\n' +
                       'Intenta con canciones más cortas';
        } else if (error.message.includes('inválida')) {
            errorMsg += 'URL de YouTube no válida.\n\n' +
                       'Intenta con:\n' +
                       '  • youtube.com/watch?v=...\n' +
                       '  • youtu.be/...';
        } else if (error.message.includes('FFmpeg')) {
            errorMsg += 'Servidor no configurado correctamente.\n' +
                       'Reporta esto al administrador';
        } else {
            errorMsg += 'El proveedor no pudo completar la solicitud.';
        }

        await sock.sendMessage(jid, {
            text: errorMsg
        }, { quoted: m });

    } finally {

        if (filePath) {
            await cleanUpFile(filePath);
        }
    }
}

/**
 * Comando para descargar audio en formato MP3
 * @param {object} sock - Instancia de Baileys
 * @param {object} m - Mensaje
 * @param {array} args - Argumentos
 */
export async function youtubeAudioMP3Command(sock, m, args) {
    await youtubeAudioCommand(sock, m, args, 'mp3');
}

/**
 * Comando para descargar audio en formato M4A
 * @param {object} sock - Instancia de Baileys
 * @param {object} m - Mensaje
 * @param {array} args - Argumentos
 */
export async function youtubeAudioM4ACommand(sock, m, args) {
    await youtubeAudioCommand(sock, m, args, 'm4a');
}

/**
 * Comando para descargar audio en formato OPUS
 * @param {object} sock - Instancia de Baileys
 * @param {object} m - Mensaje
 * @param {array} args - Argumentos
 */
export async function youtubeAudioOpusCommand(sock, m, args) {
    await youtubeAudioCommand(sock, m, args, 'opus');
}

export default youtubeAudioCommand;
