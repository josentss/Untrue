import { socialCommand } from './socialDownload.js';
export const pinterestCommand=(sock,m,args)=>socialCommand(sock,m,args,{"platform":"pinterest","kind":"post","command":"pin","allowPosition":false});
