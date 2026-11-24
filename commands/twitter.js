import { socialCommand } from './socialDownload.js';
export const twitterCommand=(sock,m,args)=>socialCommand(sock,m,args,{"platform":"twitter","kind":"post","command":"tw","allowPosition":false});
