/* Standalone full-canvas WebP frames; no compositing of previous regions. */
#include <webp/encode.h>
#include <webp/mux.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#define EDGE 512
#define FRAME (EDGE*EDGE*4u)
#define CAP (500u*1024u-1024u)
static int integer(const char *s,int lo,int hi){char *e;long n=strtol(s,&e,10);return *s&&!*e&&n>=lo&&n<=hi?(int)n:-1;}
static int encode(const uint8_t *rgba,int quality,WebPMemoryWriter *out){
    WebPConfig cfg; WebPPicture pic;
    if(!WebPConfigPreset(&cfg,WEBP_PRESET_PICTURE,(float)quality)||!WebPPictureInit(&pic))return 0;
    cfg.method=4;cfg.use_sharp_yuv=1;cfg.alpha_quality=100;cfg.thread_level=0;
    pic.width=EDGE;pic.height=EDGE;pic.use_argb=1;pic.writer=WebPMemoryWrite;pic.custom_ptr=out;
    int ok=WebPValidateConfig(&cfg)&&WebPPictureImportRGBA(&pic,rgba,EDGE*4)&&WebPEncode(&cfg,&pic);
    WebPPictureFree(&pic);return ok;
}
static int push(WebPMux *mux,const WebPMemoryWriter *w,int delay,size_t *used){
    if(delay<10)return 0;
    if(w->size>CAP||*used>CAP-w->size||CAP-*used-w->size<24)return 3;
    WebPMuxFrameInfo f={0};f.bitstream.bytes=w->mem;f.bitstream.size=w->size;f.duration=delay;
    f.id=WEBP_CHUNK_ANMF;f.dispose_method=WEBP_MUX_DISPOSE_NONE;f.blend_method=WEBP_MUX_NO_BLEND;
    if(WebPMuxPushFrame(mux,&f,1)!=WEBP_MUX_OK)return 0;
    *used+=w->size+24;return 1;
}
int main(int argc,char **argv){
    if(argc!=5)return 2;
    int fps=integer(argv[1],1,30),q=integer(argv[2],45,100),duration=integer(argv[3],20,15000);
    if(fps<0||q<0||duration<0)return 2;
    WebPMux *mux=WebPMuxNew();uint8_t *frame=malloc(FRAME),*prev=malloc(FRAME);
    WebPMemoryWriter pending;WebPMemoryWriterInit(&pending);WebPData result;WebPDataInit(&result);
    WebPMuxAnimParams params={0,0};size_t used=64;int n=0,last=0,frames=0,rc=1;
    if(!mux||!frame||!prev||WebPMuxSetCanvasSize(mux,EDGE,EDGE)!=WEBP_MUX_OK||WebPMuxSetAnimationParams(mux,&params)!=WEBP_MUX_OK)goto done;
    for(;;){
        size_t got=fread(frame,1,FRAME,stdin);if(!got){if(ferror(stdin))goto done;break;}
        if(got!=FRAME||n>=450)goto done;
        int ts=(n*1000+fps/2)/fps;n++;
        if(ts>=duration)continue;
        if(pending.mem&&memcmp(prev,frame,FRAME)==0)continue;
        if(pending.mem){int p=push(mux,&pending,ts-last,&used);if(p!=1){rc=p==3?3:1;goto done;}frames++;WebPMemoryWriterClear(&pending);WebPMemoryWriterInit(&pending);}
        if(!encode(frame,q,&pending))goto done;
        if(pending.size>CAP-used){rc=3;goto done;}
        memcpy(prev,frame,FRAME);last=ts;
    }
    if(!pending.mem||abs(n*1000-duration*fps)>1500)goto done;
    int tail=duration-last;
    if(!frames){int p=push(mux,&pending,tail/2,&used);if(p!=1){rc=p==3?3:1;goto done;}tail-=tail/2;}
    int p=push(mux,&pending,tail,&used);if(p!=1){rc=p==3?3:1;goto done;}
    if(WebPMuxAssemble(mux,&result)!=WEBP_MUX_OK)goto done;
    if(result.size>CAP){rc=3;goto done;}
    FILE *file=fopen(argv[4],"wb");if(!file)goto done;
    size_t written=fwrite(result.bytes,1,result.size,file);int closed=fclose(file);
    if(written==result.size&&!closed)rc=0;
    else remove(argv[4]);
done:
    WebPDataClear(&result);WebPMemoryWriterClear(&pending);WebPMuxDelete(mux);free(frame);free(prev);return rc;
}
