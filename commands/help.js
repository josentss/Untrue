import { readFileSync, existsSync } from 'fs';

const BANNER_IMAGE_PATH = './assets/untrue_banner.jpg';

export async function helpCommand(sock, m) {
    const helpText = `
*UntrueBot | Menú*

*Descargas*
• #tt [link] — TikTok
• #tta [link] — Audio de TikTok
• #ytv [link/búsqueda] — Video de YouTube
• #yta [link/búsqueda] — Audio de YouTube
• #ytinfo [link/búsqueda] — Información de YouTube
• #reel [link] — Reel de Instagram
• #post [link] — Post/carrusel de Instagram
• #fb [link] — Facebook
• #tw [link] — Twitter/X
• #pin [link] — Pinterest
• #sc [link/búsqueda] — SoundCloud

*Utilidades*
• #bcv — Referencias USD/EUR en Bs
• #usdt — Precio USDT
• #qr [texto] — Generar QR
• #traducir [destino] [origen opcional] — Traducir texto

*Convertidores*
• #s — Crear sticker cuadrado (máx. 15 s)
• #sm — Sticker a imagen o video
• #toa — Extraer audio de video/audio
• #tot — OCR local o transcripción de audio/video (10 min)
• #toi [página] — PDF, Word o Excel a imagen (hasta 20 páginas)

*Info*
• #ping — Latencia
• #stats — Estadísticas
• #menu — Este menú
    `.trim();

    try {
        if (existsSync(BANNER_IMAGE_PATH)) {
            const imageBuffer = readFileSync(BANNER_IMAGE_PATH);
            await sock.sendMessage(m.key.remoteJid, {
                image: imageBuffer,
                caption: helpText
            }, { quoted: m });
        } else {
            await sock.sendMessage(m.key.remoteJid, {
                text: helpText
            }, { quoted: m });
        }
    } catch (error) {
        console.error('Error sending help:', error.message);
        await sock.sendMessage(m.key.remoteJid, {
            text: 'Error al mostrar el menú.'
        }, { quoted: m });
    }
}
