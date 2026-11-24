import {UtilityError} from '../core/utilityPolicy.js';
import {readBounded} from './socialHttp.js';
export async function utilityJson(url,{fetcher=fetch,timeout=10000,method='GET',headers={},body,signal}={}){
    const response=await fetcher(url,{method,headers,body,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout),...(body&&typeof body.pipe==='function'?{duplex:'half'}:{})});
    if(!response.ok){await response.body?.cancel();throw new UtilityError(response.status===429?'El servicio ha limitado las solicitudes. Intenta más tarde.':'El servicio externo no está disponible.');}
    if(method==='DELETE'){await response.body?.cancel();return null;}
    return JSON.parse(await readBounded(response,2*1024*1024));
}
