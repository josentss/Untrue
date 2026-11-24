import { downloadYoutubeVideo, cleanUpFile, getYoutubeInfo } from '../services/youtubeDownloader.js';
import fs from 'fs';

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
 * Comando para descargar videos de YouTube
 * Uso: #ytv [URL o búsqueda]
 * @param {object} sock - Instancia de Baileys
 * @param {object} m - Mensaje
 * @param {array} args - Argumentos
 */
export async function youtubeCommand(sock, m, args) {
    const jid = m.key.remoteJid;
    let filePath = null;

    if (!args?.length) {
        await sock.sendMessage(jid, {
            text: '📥 *Descargador de Videos de YouTube*\n\n' +
                  'Uso:\n' +
                  '  #ytv <URL>\n' +
                  '  #ytv <búsqueda>\n\n' +
                  'Ejemplos:\n' +
                  '  #ytv https://www.youtube.com/watch?v=...\n' +
                  '  #ytv bad bunny tití'
        }, { quoted: m });
        return;
    }

    try {
        const statusMsg = await sock.sendMessage(jid, {
            text: '⏳ Descargando video...\n\n_Buscando y procesando..._'
        }, { quoted: m });

        const result = await downloadYoutubeVideo(args);

        if (!result?.filePath || !fs.existsSync(result.filePath)) {
            throw new Error('El archivo no se guardó correctamente');
        }

        filePath = result.filePath;
        const stats = fs.statSync(filePath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        const info = result.videoInfo || {};

        if (stats.size > 200 * 1024 * 1024) {
            throw new Error(`El video es muy grande (${sizeMB}MB). Máximo 200MB`);
        }

        const caption =
            `*🎬 ${info.title || 'Video'}*\n\n` +
            `👤 Autor: ${info.author || 'Desconocido'}\n` +
            `⏱️ Duración: ${info.durationFormatted || 'N/A'}\n` +
            `📦 Tamaño: ${sizeMB} MB`;

        console.log(`✅ Enviando video: ${info.title}`);

        await sock.sendMessage(jid, {
            video: { url: filePath },
            caption,
            mimetype: 'video/mp4',
            fileName: `${(info.title || 'video').substring(0, 40)}.mp4`
        }, { quoted: m });

    } catch (error) {
        console.error('❌ Error en comando ytv:', error.message);

        let errorMsg = '❌ Error descargando video\n\n';

        if (error.message.includes('No se encontraron resultados')) {
            errorMsg += 'No encontré resultados para esa búsqueda.\n\n' +
                       'Intenta con:\n' +
                       '  • Otro título\n' +
                       '  • Una URL válida\n' +
                       '  • Menos palabras clave';
        } else if (error.message.includes('muy grande')) {
            errorMsg += 'El proveedor no pudo completar la solicitud.';
        } else if (error.message.includes('inválida')) {
            errorMsg += 'URL de YouTube no válida.\n\n' +
                       'Intenta con:\n' +
                       '  • youtube.com/watch?v=...\n' +
                       '  • youtu.be/...';
        } else {
            errorMsg += error.message;
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
 * Comando para obtener información de un video sin descarga
 * Uso: #ytinfo [URL o búsqueda]
 * @param {object} sock - Instancia de Baileys
 * @param {object} m - Mensaje
 * @param {array} args - Argumentos
 */
export async function youtubeInfoCommand(sock, m, args) {
    const jid = m.key.remoteJid;

    if (!args?.length) {
        await sock.sendMessage(jid, {
            text: '📊 Obtener información de video\n\n' +
                  'Uso: #ytinfo <URL o búsqueda>'
        }, { quoted: m });
        return;
    }

    try {
        const statusMsg = await sock.sendMessage(jid, {
            text: '⏳ Obteniendo información...'
        }, { quoted: m });

        const info = await getYoutubeInfo(args);

        const message =
            `*📊 Información del Video*\n\n` +
            `*Título:* ${info.title}\n` +
            `*Autor:* ${info.author}\n` +
            `*Duración:* ${info.durationFormatted}\n` +
            `*URL:* ${info.url}\n\n` +
            `_Descripción:_\n${(info.description || 'N/A').substring(0, 200)}...`;

        await sock.sendMessage(jid, {
            text: message
        }, { quoted: m });

    } catch (error) {
        console.error('Error en ytinfo:', error.message);
        await sock.sendMessage(jid, {
            text: `❌ Error: ${error.message}`
        }, { quoted: m });
    }
}

export default youtubeCommand;
