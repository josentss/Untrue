import { makeWASocket, makeCacheableSignalKeyStore, DisconnectReason, BufferJSON, initAuthCreds, proto } from 'baileys';
import QRCode from 'qrcode-terminal';
import Pino from 'pino';
import NodeCache from 'node-cache';
import { openAuthStore } from './core/authStore.js';
import { createProtocolLogger } from './core/protocolLogger.js';
import { messageKeys } from './core/identity.js';
import { authDir, maxJobs } from './core/config.js';
import { normalizedMessage, commandOf, RecentKeys } from './core/messages.js';
import { JobQueue } from './core/queue.js';
import { eventAge, historyPolicy } from './core/messageTiming.js';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const logger = Pino({ level: process.env.LOG_LEVEL || 'info', redact: ['key.remoteJid', 'key.participant', 'msgAttrs.from', 'msgAttrs.participant', 'qr'] });
const protocolLogger = createProtocolLogger(logger, {level:process.env.BAILEYS_LOG_LEVEL || 'warn'});
const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
const summaryTimer = setInterval(() => { protocolLogger.flush(); const maxMs = Math.round(lag.max / 1e6); if (maxMs > 500) logger.warn({maxMs,p99Ms:Math.round(lag.percentile(99)/1e6)}, 'Demora del event loop'); lag.reset(); }, 60000); summaryTimer.unref();
const seen = new RecentKeys();
const retryCache = new NodeCache({ stdTTL: 600, maxKeys: 10000, useClones: false, checkperiod: 60 });
const sentCache = new NodeCache({ stdTTL: 600, maxKeys: 1000, useClones: false, checkperiod: 60 });
const jobs = new JobQueue(maxJobs);
const lightweight = new Set(['ping', 'menu', 'help', 'info', 'stats', 'bcv', 'usdt']);
let socket, timer, connecting = false, stopping = false, attempts = 0, status = 'starting';
let pendingCredentials = Promise.resolve();
let generation = 0;
let currentAuth;
let authFailed = false;
export const connectionStatus = () => status;
function retry(immediate = false) {
    if (stopping || timer) return;
    const delay = immediate ? 1000 : Math.min(60000, 2000 * 2 ** Math.min(attempts++, 5)) + Math.floor(Math.random() * 500);
    timer = setTimeout(() => { timer = undefined; void connectToWhatsApp(); }, delay);
}
function cacheMessage(message) {
    if (!message?.message) return;
    for (const key of messageKeys(message.key)) {
        if (sentCache.getStats().keys >= 1000 && !sentCache.has(key)) break;
        sentCache.set(key, message.message);
    }
}
export async function connectToWhatsApp() {
    if (stopping || connecting || socket || authFailed) return;
    connecting = true;
    status = 'connecting';
    const epoch = ++generation;
    try {
        await pendingCredentials;
        await currentAuth?.flush();
        const auth = await openAuthStore(authDir, {codec:BufferJSON, initCreds:initAuthCreds, decodeAppStateKey:v=>proto.Message.AppStateSyncKeyData.fromObject(v)});
        currentAuth = auth;
        const { state, saveCreds } = auth;
        if (stopping || epoch !== generation) return;
        const sock = makeWASocket({
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, protocolLogger) },
            logger:protocolLogger, markOnlineOnConnect: false, syncFullHistory: false,
            shouldSyncHistoryMessage: historyPolicy(state.creds, proto.HistorySync.HistorySyncType),
            connectTimeoutMs: 30000, defaultQueryTimeoutMs: 20000, maxMsgRetryCount: 3, msgRetryCounterCache: retryCache,
            getMessage: async key => messageKeys(key).map(k=>sentCache.get(k)).find(Boolean)
        });
        socket = sock;
        const originalSend = sock.sendMessage.bind(sock);
        sock.sendMessage = async (...args) => { const result = await originalSend(...args); cacheMessage(result); return result; };
        sock.ev.on('creds.update', () => {
            pendingCredentials = pendingCredentials.then(() => saveCreds()).catch(() => {
                authFailed = true; status = 'requires_attention'; logger.error('No se pudieron guardar las credenciales; conexión detenida');
                if (socket === sock) { socket = undefined; sock.end(undefined); }
            });
        });
        sock.ev.on('connection.update', update => {
            if (epoch !== generation || stopping || authFailed || socket !== sock) return;
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
        sock.ev.on('messages.upsert', ({ messages, type, requestId }) => {
            if (epoch !== generation || stopping || socket !== sock) return;
            for (const raw of messages || []) {
                if (raw.key?.fromMe) cacheMessage(raw);
                if (type !== 'notify' || requestId || status !== 'connected') continue;
                const m = normalizedMessage(raw);
                const command = commandOf(m);
                if (!command) continue;
                const keys = messageKeys(m.key);
                if (!keys.length || keys.map(k=>seen.seen(k)).some(Boolean)) continue;
                const receivedAt = Date.now();
                const incomingAgeMs = eventAge(raw.messageTimestamp, receivedAt);
                logger.info({command:command.name, incomingAgeMs}, 'Comando recibido');
                const execute = async () => {
                    if (socket !== sock || status !== 'connected') return;
                    const started = Date.now();
                    const { handleCommand } = await import('./commands/commandHandler.js');
                    await handleCommand(sock, m, command.name, command.args);
                    logger.info({ command: command.name, ms: Date.now() - started, queueMs:started-receivedAt, incomingAgeMs, ...(incomingAgeMs === null ? {} : {estimatedTotalMs:incomingAgeMs+Date.now()-receivedAt}) }, 'Comando procesado');
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
        if (error?.code === 'AUTH_CORRUPT') { authFailed = true; status = 'requires_attention'; logger.error('Credenciales inválidas; se conservan intactas'); return; }
        status = 'disconnected'; logger.error({ type: error?.name }, 'Error iniciando WhatsApp'); retry();
    } finally { connecting = false; }
}
export async function stopBot() {
    stopping = true; generation++; status = 'stopping'; clearTimeout(timer);
    const current = socket; socket = undefined;
    current?.end(undefined);
    await pendingCredentials;
    await currentAuth?.flush();
    clearInterval(summaryTimer); lag.disable(); protocolLogger.flush();
    sentCache.close(); retryCache.close();
}
