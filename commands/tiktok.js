import { socialCommand } from './socialDownload.js';
export const tiktokCommand=(sock,m,args)=>socialCommand(sock,m,args,{"platform":"tiktok","kind":"video","command":"tt","allowPosition":false});
