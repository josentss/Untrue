import { unwrap } from './messages.js';

export class MediaError extends Error {}
export function selectMedia(message) {
    const content = unwrap(message?.message);
    if (!content) throw new MediaError('No se permite procesar contenido de visualización única.');
    const context = content.extendedTextMessage?.contextInfo || content.imageMessage?.contextInfo || content.videoMessage?.contextInfo || content.documentMessage?.contextInfo;
    const hasQuote = Boolean(context?.quotedMessage);
    const target = hasQuote ? unwrap(context.quotedMessage) : content;
    if (!target) throw new MediaError('No se permite procesar contenido de visualización única.');
    // Do not treat a wrapped Lottie/sonorous sticker as WebP.
    if (target.lottieStickerMessage || target.stickerMessage?.isLottie) throw new MediaError('Los stickers Lottie todavía no se pueden convertir.');
    if (target.audioStickerMessage) throw new MediaError('Este formato de sticker con sonido todavía no es compatible.');
    for (const type of ['sticker','image','video','audio','document']) {
        const media = target[type+'Message'];
        if (!media) continue;
        const mime = String(media.mimetype || '').split(';')[0].toLowerCase();
        const kind = type === 'document' ? (mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':'document') : type;
        return {type,kind,media,...(type==='sticker'&&media.audioMessage?{audio:media.audioMessage}:{})};
    }
    throw new MediaError('Responde a una imagen, video o sticker compatible.');
}
export function modeOf(args, allowed) {
    const mode = (args || []).join(' ').trim().toLowerCase();
    if (mode && !allowed.includes(mode)) throw new MediaError('Opción desconocida. Consulta #menu.');
    return mode;
}
export function soundUnavailable() {
    return new MediaError('Baileys aún no permite crear o recuperar stickers con sonido de forma fiable. Usa #toa para extraer audio de un video.');
}
