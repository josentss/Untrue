// Best-effort feedback on the original command, never a separate chat message.
export async function reactToCommand(sock,m,text){
    if(!m?.key?.remoteJid||!m.key.id)return;
    try{await sock.sendMessage(m.key.remoteJid,{react:{text,key:m.key}});}
    catch{console.warn('Reacción de comando no disponible');}
}
export async function withCommandFeedback(sock,m,execute){
    await reactToCommand(sock,m,'⏳');
    let success=false;
    try{
        const result=await execute();
        success=result!==false;
        return result;
    }finally{await reactToCommand(sock,m,success?'✅':'❌');}
}
