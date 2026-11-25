import { withCommandFeedback } from '../core/commandFeedback.js';
import { senderIdentity } from '../core/identity.js';
import { pingCommand } from "./ping.js";
import { statsCommand } from "./stats.js";
import { tiktokCommand } from "./tiktok.js";
import { tiktokAudioCommand } from "./tiktokAudio.js";
import { igreelsCommand } from "./igreels.js";
import { igpostsCommand } from "./igposts.js";
import { facebookCommand } from "./facebook.js";
import { twitterCommand } from "./twitter.js";
import { scCommand } from "./soundcloud.js";
import { pinterestCommand } from "./pinterest.js";
import { helpCommand } from "./help.js";
import { mediaToStickerCommand } from "./mediaToSticker.js";
import { youtubeCommand, youtubeInfoCommand } from "./youtube.js";
import { youtubeAudioCommand } from "./youtubeAudio.js";
import { stickerToMediaCommand } from "./stickerToMedia.js";
import { bcvCommand } from "./bcv.js";
import { usdtCommand } from "./usdt.js";
import { qrGeneratorCommand } from "./qrGenerator.js";
import { toAudioCommand } from "./toAudio.js";
import { totextCommand } from "./totext.js";
import { toimgCommand } from "./toimg.js";
import { traducirCommand } from "./traducir.js";
import { recordCommandUsage } from "./stats.js";

const commands = Object.assign(Object.create(null), {
    ping: pingCommand,
    help: helpCommand,
    menu: helpCommand,
    info: helpCommand,
    stats: statsCommand,

    tt: tiktokCommand,
    ttaud: tiktokAudioCommand,
    tta: tiktokAudioCommand,
    reel: igreelsCommand,
    r: igreelsCommand,
    post: igpostsCommand,
    p: igpostsCommand,
    fb: facebookCommand,
    tw: twitterCommand,
    pin: pinterestCommand,
    ytvid: youtubeCommand,
    ytaud: youtubeAudioCommand,
    ytv: youtubeCommand,
    ytinfo: youtubeInfoCommand,
    yta: youtubeAudioCommand,
    music: youtubeAudioCommand,
    sc: scCommand,
    soundcloud: scCommand,

    bcv: bcvCommand,
    usdt: usdtCommand,
    qr: qrGeneratorCommand,
    traducir: traducirCommand,
    trans: traducirCommand,

    s: mediaToStickerCommand,
    sticker: mediaToStickerCommand,
    smedia: stickerToMediaCommand,
    sm: stickerToMediaCommand,
    toaud: toAudioCommand,
    toa: toAudioCommand,
    totext: totextCommand,
    tot: totextCommand,
    toimg: toimgCommand,
    toi: toimgCommand,
});

async function handleInvalidCommand(sock, m, invalidCommandName) {
    await sock.sendMessage(m.key.remoteJid, {
        text: `Comando #${invalidCommandName} no existe.\nUsa #menu para ver la lista.`
    }, { quoted: m });
}

export async function handleCommand(sock, m, commandName, args) {
    const userId = m.key.remoteJid;
    const excluded = ['ping', 'stats', 'help', 'menu', 'info'];

    if (commands[commandName] && !excluded.includes(commandName)) {
        recordCommandUsage(commandName, senderIdentity(m.key) || m.key.participant || userId);
    }

    if (commands[commandName]) {
        try {
            const execute=()=>commands[commandName](sock,m,args);
            if(excluded.includes(commandName))await execute();
            else await withCommandFeedback(sock,m,execute);
        } catch (error) {
            console.error(`Error in ${commandName}:`, error.message);
            await sock.sendMessage(m.key.remoteJid, {
                text: `Error al ejecutar #${commandName}`
            }, { quoted: m });
        }
    } else {
        await handleInvalidCommand(sock, m, commandName);
    }
}
