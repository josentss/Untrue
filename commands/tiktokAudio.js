import { socialCommand } from './socialDownload.js';
export const tiktokAudioCommand=(sock,m,args)=>socialCommand(sock,m,args,{"platform":"tiktok","kind":"audio","command":"tta","allowPosition":false});
