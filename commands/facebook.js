import { inputUrl } from '../core/urls.js';
import { sendLocalDownload } from '../services/localDownloader.js';
export async function facebookCommand(sock,m,args) {
    try {
        const input = inputUrl(m,args,["facebook.com","fb.watch","fb.me"]);
        await sendLocalDownload(sock,m,input,{audio:false});
    } catch {
        await sock.sendMessage(m.key.remoteJid,{text:'No se pudo descargar. Comprueba el enlace público e inténtalo nuevamente.'},{quoted:m});
    }
}
