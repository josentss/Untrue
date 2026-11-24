import protobuf from 'protobufjs/minimal.js';
import { proto } from 'baileys';

// Experimental, narrowly scoped to StickerMessage.audioMessage (wire field 26).
// Evidence: https://docs.baron0.com/WA_STICKERS/ (independent Android analysis).
// Do not guess the payload of the separate audioStickerMessage wrapper.
const Sticker=proto.Message.StickerMessage;
const Audio=proto.Message.AudioMessage;
const tag=26*8+2;
let installed=false;
export function soundCodecAvailable(){
    try {
        const original={stickerMessage:{audioMessage:{mimetype:'audio/ogg',seconds:1}}};
        return proto.Message.decode(proto.Message.encode(proto.Message.fromObject(original)).finish()).stickerMessage?.audioMessage?.seconds===1;
    } catch {return false;}
}
export function installSoundStickerCodec(){
    if(installed||soundCodecAvailable()) return true;
    const methods=['encode','decode','fromObject','toObject'];
    const previous=Object.fromEntries(methods.map(name=>[name,Sticker[name]]));
    if(methods.some(name=>typeof previous[name]!=='function')) return false;
    try {
        Sticker.encode=function(message,writer){
            const result=previous.encode.call(this,message,writer);
            if(message.audioMessage!=null) Audio.encode(message.audioMessage,result.uint32(tag).fork()).ldelim();
            return result;
        };
        Sticker.decode=function(input,length){
            const reader=input instanceof Uint8Array?protobuf.Reader.create(input):input;
            const start=reader.pos;
            const result=previous.decode.call(this,reader,length);
            const end=reader.pos;
            // Inspect only this StickerMessage's already-consumed bytes.
            const scan=protobuf.Reader.create(reader.buf.subarray(start,end));
            while(scan.pos<scan.len){
                const key=scan.uint32();
                if(key===tag){
                    const size=scan.uint32();
                    if(size>scan.len-scan.pos) throw Error('Invalid sticker audio length');
                    result.audioMessage=Audio.decode(scan,size);
                } else scan.skipType(key&7);
            }
            return result;
        };
        Sticker.fromObject=function(object){
            const result=previous.fromObject.call(this,object);
            if(object.audioMessage!=null) result.audioMessage=Audio.fromObject(object.audioMessage);
            return result;
        };
        Sticker.toObject=function(message,options){
            const result=previous.toObject.call(this,message,options);
            if(message.audioMessage!=null) result.audioMessage=Audio.toObject(message.audioMessage,options);
            return result;
        };
        if(!soundCodecAvailable()) throw Error('Codec check failed');
        installed=true;
        return true;
    }catch{
        for(const name of methods) Sticker[name]=previous[name];
        return false;
    }
}
let active=false;
export function initializeSoundStickers(){
    if(process.env.EXPERIMENTAL_SOUND_STICKERS!=='true') return false;
    active=installSoundStickerCodec();
    console.log(active?'Stickers con audio: codec experimental habilitado (solo chats privados para envío)':'Stickers con audio: codec incompatible; prueba desactivada');
    return active;
}
export const soundStickersEnabled=()=>active;
