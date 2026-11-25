import QRCode from 'qrcode';
import {quotedText} from '../core/urls.js';
export async function qrGeneratorCommand(sock,m,args=[]){
    try{
        let text=args.join(' ').trim()||quotedText(m).trim();
        if(!text||Buffer.byteLength(text)>1000){await sock.sendMessage(m.key.remoteJid,{text:'Usa #qr texto/enlace o responde a un texto (máximo 1000 bytes).'},{quoted:m});return false;}
        if(/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:[/?#]\S*)?$/.test(text))text='https://'+text;
        const image=await QRCode.toBuffer(text,{width:640,margin:4,errorCorrectionLevel:'M'});
        await sock.sendMessage(m.key.remoteJid,{image,caption:'Código QR generado.'},{quoted:m});
    }catch{await sock.sendMessage(m.key.remoteJid,{text:'No se pudo generar el código QR.'},{quoted:m});return false;}
}
