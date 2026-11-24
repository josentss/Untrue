import { socialCommand } from './socialDownload.js';
export const igpostsCommand=(sock,m,args)=>socialCommand(sock,m,args,{"platform":"instagram","kind":"post","command":"post","allowPosition":true});
