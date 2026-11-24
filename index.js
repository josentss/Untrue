import './core/signalPreload.js';
import 'dotenv/config';
import express from 'express';
import { connectToWhatsApp, connectionStatus, stopBot } from './bot.js';

import { initializeSoundStickers } from './core/soundStickerCodec.js';
initializeSoundStickers();

const app = express();
app.disable('x-powered-by');
const port = Number(process.env.PORT || 3000);
app.get('/', (_req, res) => res.json({ status: 'online', whatsapp: connectionStatus(), uptime: Math.floor(process.uptime()) }));
// Liveness deliberately succeeds while an operator scans the initial QR.
app.get('/health', (_req, res) => res.json({ status: 'alive', whatsapp: connectionStatus() }));
app.get('/ready', (_req, res) => res.status(connectionStatus() === 'connected' ? 200 : 503).json({ whatsapp: connectionStatus() }));
app.get('/ping', (_req, res) => res.json({ pong: Date.now() }));
const server = app.listen(port, '0.0.0.0', () => { console.log('Untrue HTTP en puerto ' + port); void connectToWhatsApp(); });
let shuttingDown = false;
async function shutdown(code = 0) {
    if (shuttingDown) return; shuttingDown = true;
    const timer = setTimeout(() => process.exit(1), 10000); timer.unref();
    server.close();
    try { await stopBot(); } finally { process.exit(code); }
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
process.once('uncaughtException', () => { console.error('Error fatal no controlado'); void shutdown(1); });
process.once('unhandledRejection', () => { console.error('Promesa rechazada sin controlar'); void shutdown(1); });
