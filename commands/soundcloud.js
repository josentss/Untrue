import { musicCommand } from './musicDownload.js';
export const scCommand=(sock,m,args)=>musicCommand(sock,m,args,{platform:'soundcloud',kind:'audio',command:'sc'});
