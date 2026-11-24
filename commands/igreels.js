import { inputUrl } from '../core/urls.js';
import { sendLocalDownload } from '../services/localDownloader.js';
export async function igreelsCommand(sock,m,args) {
    try {
        const input = inputUrl(m,args,["instagram.com"]);
        await sendLocalDownload(sock,m,input,{audio:false,cookies:process.env.INSTAGRAM_COOKIES_PATH});
    } catch {
        await sock.sendMessage(m.key.remoteJid,{text:'No se pudo descargar. Comprueba el enlace público e inténtalo nuevamente.'},{quoted:m});
    }
}
