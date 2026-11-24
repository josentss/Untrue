import axios from 'axios';
import fs from 'fs';
import path from 'path';

const API_KEY = process.env.EXCHANGERATE_API_KEY;
const BASE_URL = 'https://v6.exchangerate-api.com/v6';

export function getBCVPrice() {
    try {
        const filePath = path.resolve('./services/bcvTasas.json');
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const fechas = Object.keys(data);
        const ultima = data[fechas[fechas.length - 1]];
        return ultima.usdPrice.replace(' Bs', '').replace(',', '.').trim();
    } catch {
        return '0.0000';
    }
}

export const getBCVFromHistorial = getBCVPrice;

export async function bcvCommand(sock, m) {
    const jid = m.key.remoteJid;

    try {
        const [resUsd, resEur] = await Promise.all([
            axios.get(`${BASE_URL}/${API_KEY}/latest/USD`, { timeout: 10000 }),
            axios.get(`${BASE_URL}/${API_KEY}/latest/EUR`, { timeout: 10000 })
        ]);

        if (resUsd.data.result !== 'success' || resEur.data.result !== 'success') {
            throw new Error('API error');
        }

        const usd = resUsd.data.conversion_rates.VES;
        const eur = resEur.data.conversion_rates.VES;
        const fecha = new Date(resUsd.data.time_last_update_utc).toLocaleDateString('es-VE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });

        const text =
            `*Tasas de referencia (ExchangeRate-API)*\n\n` +
            `USD: ${usd.toFixed(4)} Bs\n` +
            `EUR: ${eur.toFixed(4)} Bs\n` +
            `Fecha: ${fecha}`;

        await sock.sendMessage(jid, { text }, { quoted: m });

    } catch (error) {
        console.error('Error in bcv:', error.message);
        const local = getBCVPrice();
        await sock.sendMessage(jid, {
            text: `No se pudo obtener la tasa.\nÚltimo valor: ${local} Bs`
        }, { quoted: m });
    }
}
