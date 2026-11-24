import { isOwner, senderIdentity } from '../core/identity.js';
class StatsManager {
    constructor() {
        this.startTime = new Date();
        this.totalCommands = 0;
        this.uniqueUsers = new Set();
    }

    recordCommand(commandName, userId) {
        this.totalCommands++;
        this.uniqueUsers.add(userId);
    }

    getStats() {
        const uptime = Date.now() - this.startTime;
        const hours = Math.floor(uptime / (1000 * 60 * 60));
        const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
        const memoryMB = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);

        return {
            uptime: hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`,
            totalCommands: this.totalCommands,
            uniqueUsers: this.uniqueUsers.size,
            memoryUsage: `${memoryMB} MB`
        };
    }

    resetStats() {
        this.totalCommands = 0;
        this.uniqueUsers.clear();
        this.startTime = new Date();
    }
}

const statsManager = new StatsManager();
const CREATOR_ID = process.env.BOT_OWNER_JID;


export async function statsCommand(sock, m, args) {
    const remoteJid = m.key.remoteJid;
    const participant = m.key.participant;

    try {
        if (!isOwner(m.key, CREATOR_ID)) {
            await sock.sendMessage(remoteJid, {
                text: 'Este comando solo está disponible para el creador.'
            }, { quoted: m });
            return;
        }

        const stats = statsManager.getStats();
        let text = `*Estadísticas*\n\n`;
        text += `Uptime: ${stats.uptime}\n`;
        text += `Memoria: ${stats.memoryUsage}\n`;
        text += `Usuarios: ${stats.uniqueUsers}\n`;
        text += `Comandos: ${stats.totalCommands}`;

        if (args[0] === 'reset') {
            statsManager.resetStats();
            text += '\n\nEstadísticas reiniciadas.';
        }

        await sock.sendMessage(remoteJid, { text }, { quoted: m });

        const userToRecord = senderIdentity(m.key) || participant || remoteJid;
        statsManager.recordCommand('stats', userToRecord);

    } catch (error) {
        console.error('Error in stats:', error.message);
        await sock.sendMessage(remoteJid, {
            text: 'Error al obtener estadísticas.'
        }, { quoted: m });
    }
}

export function recordCommandUsage(commandName, userId) {
    statsManager.recordCommand(commandName, userId);
}

export function getStats() {
    return statsManager.getStats();
}
