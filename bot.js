import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, DisconnectReason } from '@whiskeysockets/baileys';
import QRCode from 'qrcode-terminal';
import Pino from 'pino';
import NodeCache from 'node-cache';
import { mkdir } from 'node:fs/promises';
import { authDir, maxJobs } from './core/config.js';
import { normalizedMessage, commandOf, messageKey, RecentKeys } from './core/messages.js';
import { JobQueue } from './core/queue.js';

const logger = Pino({ level: process.env.LOG_LEVEL || 'info', redact: ['key.remoteJid', 'key.participant', 'msgAttrs.from', 'msgAttrs.participant', 'qr'] });
const seen = new RecentKeys();
const retryCache = new NodeCache({ stdTTL: 600, maxKeys: 10000, useClones: false, checkperiod: 60 });
const sentCache = new NodeCache({ stdTTL: 600, maxKeys: 1000, useClones: false, checkperiod: 60 });
const jobs = new JobQueue(maxJobs);
const lightweight = new Set(['ping', 'menu', 'help', 'info', 'stats', 'bcv', 'usdt']);
let socket, timer, connecting = false, stopping = false, attempts = 0, status = 'starting';
let pendingCredentials = Promise.resolve();
let generation = 0;
export const connectionStatus = () => status;
function retry(immediate = false) {
    if (stopping || timer) return;
    const delay = immediate ? 1000 : Math.min(60000, 2000 * 2 ** Math.min(attempts++, 5)) + Math.floor(Math.random() * 500);
    timer = setTimeout(() => { timer = undefined; void connectToWhatsApp(); }, delay);
}
function cacheMessage(message) {
    const key = messageKey(message?.key);
    if (!key || !message.message || sentCache.getStats().keys >= 1000) return;
    sentCache.set(key, message.message);
}
export async function connectToWhatsApp() {
    if (stopping || connecting || socket) return;
    connecting = true;
    status = 'connecting';
    const epoch = ++generation;
    try {
        await pendingCredentials;
        await mkdir(authDir, { recursive: true, mode: 0o700 });
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        if (stopping || epoch !== generation) return;
        const sock = makeWASocket({
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
            logger, markOnlineOnConnect: false, syncFullHistory: false,
            connectTimeoutMs: 30000, maxMsgRetryCount: 3, msgRetryCounterCache: retryCache,
            getMessage: async key => sentCache.get(messageKey(key) || '') || undefined
        });
        socket = sock;
        const originalSend = sock.sendMessage.bind(sock);
        sock.sendMessage = async (...args) => { const result = await originalSend(...args); cacheMessage(result); return result; };
        sock.ev.on('creds.update', () => {
            pendingCredentials = pendingCredentials.then(() => saveCreds()).catch(() => logger.error('No se pudieron guardar las credenciales'));
        });
        sock.ev.on('connection.update', update => {
            if (epoch !== generation || stopping) return;
            const { connection, qr, lastDisconnect } = update;
            if (qr) {
                status = 'awaiting_qr';
                logger.info('Escanea el QR desde Dispositivos vinculados');
                QRCode.generate(qr, { small: true });
            }
            if (connection === 'open') { attempts = 0; status = 'connected'; logger.info('WhatsApp conectado'); }
            if (connection === 'close') {
                socket = undefined;
                const code = lastDisconnect?.error?.output?.statusCode;
                if ([DisconnectReason.loggedOut, DisconnectReason.connectionReplaced, DisconnectReason.badSession, DisconnectReason.forbidden, DisconnectReason.multideviceMismatch].includes(code) && code !== undefined) {
                    status = 'requires_attention'; logger.warn({ code }, 'Sesión cerrada: revisar vinculación. No se borrará automáticamente.'); return;
                }
                status = 'disconnected'; logger.warn({ code }, 'WhatsApp desconectado');
                retry(code === DisconnectReason.restartRequired);
            }
        });
        sock.ev.on('messages.upsert', ({ messages, type }) => {
            if (epoch !== generation || stopping) return;
            for (const raw of messages || []) {
                if (raw.key?.fromMe) cacheMessage(raw);
                if (type !== 'notify' || status !== 'connected') continue;
                const m = normalizedMessage(raw);
                const command = commandOf(m);
                if (!command || seen.seen(messageKey(m.key))) continue;
                const execute = async () => {
                    if (socket !== sock || status !== 'connected') return;
                    const started = Date.now();
                    const { handleCommand } = await import('./commands/commandHandler.js');
                    await handleCommand(sock, m, command.name, command.args);
                    logger.info({ command: command.name, ms: Date.now() - started }, 'Comando procesado');
                };
                const task = lightweight.has(command.name) ? execute() : jobs.run(execute);
                task.catch(async error => {
                    logger.warn({ command: command.name, type: error?.name }, 'Comando fallido');
                    if (socket === sock && status === 'connected') {
                        await sock.sendMessage(m.key.remoteJid, { text: 'No se pudo procesar el comando. Intenta nuevamente.' }, { quoted: m }).catch(() => {});
                    }
                });
            }
        });
    } catch (error) {
        status = 'disconnected'; logger.error({ type: error?.name }, 'Error iniciando WhatsApp'); retry();
    } finally { connecting = false; }
}
export async function stopBot() {
    stopping = true; generation++; status = 'stopping'; clearTimeout(timer);
    const current = socket; socket = undefined;
    current?.end(undefined);
    await pendingCredentials;
    sentCache.close(); retryCache.close();
}
