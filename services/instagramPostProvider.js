import {DownloadError} from '../core/downloadPolicy.js';
import {apiDirectItems,rateError,retryAfterMs} from '../core/instagramPostPolicy.js';
import {readBounded} from './socialHttp.js';

export function postFetcher(fetcher=fetch){
    return async(url,opts)=>{
        const response=await fetcher(url,opts);
        if(response.status!==429)return response;
        const retry=retryAfterMs(response.headers.get('retry-after'));
        await response.body?.cancel();
        throw rateError(retry,'instagram-post');
    };
}
// Only enabled when the operator selects this provider AND sets a key.
// Local guard is per process, not a billing guarantee across redeploys.
let month='',attempts=0;
export async function apiDirectPost(input,{fetcher=fetch,key,timeout=12000}){
    if(!key)throw new DownloadError('configuration','Falta configurar la API key de Instagram.');
    const current=new Date().toISOString().slice(0,7);
    if(current!==month){month=current;attempts=0;}
    if(attempts>=40)throw new DownloadError('quota','Se alcanzó el límite preventivo de consultas de API Direct.');
    attempts++;
    const url=new URL('https://apidirect.io/v1/instagram/post');
    url.searchParams.set('code',new URL(input.url).pathname.split('/')[2]);
    // Never follow redirects with the credential, nor reuse headers for media.
    const res=await fetcher(url.href,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(timeout),headers:{Accept:'application/json','X-API-Key':key}});
    if(!res.ok){
        await res.body?.cancel();
        if(res.status===429)throw rateError(retryAfterMs(res.headers.get('retry-after')),'apidirect');
        if([401,403,402].includes(res.status))throw new DownloadError('configuration','API Direct no autorizó la consulta. Revisa la clave y la cuota.');
        if(res.status===404)throw new DownloadError('not_found','El proveedor no encontró la publicación.');
        throw new DownloadError('unavailable','API Direct no está disponible temporalmente.');
    }
    return apiDirectItems(JSON.parse(await readBounded(res,2*1024*1024)),input.url);
}
