import { musicCommand } from './musicDownload.js';
export const youtubeAudioCommand=(sock,m,args)=>musicCommand(sock,m,args,{platform:'youtube',kind:'audio',command:'yta'});
export default youtubeAudioCommand;
