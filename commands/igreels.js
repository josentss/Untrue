import { socialCommand } from './socialDownload.js';
export const igreelsCommand=(sock,m,args)=>socialCommand(sock,m,args,{"platform":"instagram","kind":"video","command":"reel","allowPosition":false});
