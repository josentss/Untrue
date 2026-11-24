import axios from 'axios';
import { platformUrl } from '../core/urls.js';

class BK9InstagramService {
    constructor() {
        this.apis = [
            'https://api.bk9.dev/download/instagram',
            'https://api.bk9.dev/download/instagram2'
        ];
    }

    cleanUrl(url) {
        return url.split('?')[0];
    }

    async downloadPost(rawUrl) {
        const cleanUrl = this.cleanUrl(rawUrl);

        for (const apiUrl of this.apis) {
            try {
                const response = await axios.get(apiUrl, {
                    params: { url: cleanUrl },
                    timeout: 20000
                });

                if (response.data && response.data.status) {
                    let results = response.data.BK9;

                    const uniqueUrls = new Set();
                    const filteredResults = [];

                    results.forEach(item => {
                        if (!uniqueUrls.has(item.url)) {
                            uniqueUrls.add(item.url);
                            filteredResults.push({
                                url: item.url,
                                type: (item.type === 'video' || item.url.includes('.mp4')) ? 'video' : 'image'
                            });
                        }
                    });

                    if (filteredResults.length > 0) return filteredResults;
                }
            } catch (error) {
                continue;
            }
        }
        throw new Error('FAILED');
    }

    async getBuffer(url) {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 15000, maxContentLength: 25 * 1024 * 1024
        });
        return Buffer.from(res.data);
    }
}

const bk9 = new BK9InstagramService();

export async function igpostsCommand(sock, m, args) {
    const jid = m.key.remoteJid;
    try {
        let pos = null;
        let url = null;

        if (args.length >= 2 && !isNaN(args[0])) {
            pos = parseInt(args[0]);
            url = args[1];
        } else {
            url = args[0] || (m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation);
        }

        url = platformUrl(url, ['instagram.com']);
        if (url.includes('/reel/')) throw Error('Usa #reel');

        const mediaItems = await bk9.downloadPost(url);

        let itemsToSend = mediaItems;
        if (pos !== null) {
            const index = pos - 1;
            if (mediaItems[index]) {
                itemsToSend = [mediaItems[index]];
            } else {
                throw new Error('POSITION_NOT_FOUND');
            }
        }

        for (let i = 0; i < itemsToSend.length; i++) {
            const item = itemsToSend[i];
            try {
                const buffer = await bk9.getBuffer(item.url);

                let caption = "";
                if (pos !== null) {
                    caption = `Post descargado!`;
                } else {
                    caption = itemsToSend.length > 1
                        ? `Carrusel descargado! (${i + 1}/${itemsToSend.length})`
                        : `Post descargado!`;
                }

                await sock.sendMessage(jid, {
                    [item.type]: buffer,
                    caption: caption
                }, { quoted: m });

                if (itemsToSend.length > 1) await new Promise(r => setTimeout(r, 1500));

            } catch (err) {
                // ignorar el error individual para no interrumpir el flujo del carrusel
            }
        }

    } catch (e) {
        let errorMsg = "Error: No se pudo descargar el contenido.";
        if (e.message === 'POSITION_NOT_FOUND') {
            errorMsg = "Error: La posición solicitada no existe en este carrusel.";
        }

        await sock.sendMessage(jid, { text: errorMsg }, { quoted: m });
    }
}
