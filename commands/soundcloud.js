import { platformUrl } from '../core/urls.js';
import { sendLocalDownload } from '../services/localDownloader.js';
export async function scCommand(sock,m,args) {
    try {
        const q = args.join(' ').trim();
        if (!q || q.length > 300) throw Error('Uso: #sc [enlace/búsqueda]');
        const input = /^https?:/i.test(q) ? platformUrl(q,["soundcloud.com"]) : 'scsearch1:' + q;
        await sendLocalDownload(sock,m,input,{audio:true});
    } catch {
        await sock.sendMessage(m.key.remoteJid,{text:'No se pudo descargar. Comprueba el enlace público e inténtalo nuevamente.'},{quoted:m});
    }
}
