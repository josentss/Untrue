import { socialCommand } from './socialDownload.js';
export const facebookCommand=(sock,m,args)=>socialCommand(sock,m,args,{"platform":"facebook","kind":"video","command":"fb","allowPosition":false});
