import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>JSON.parse(readFileSync(new URL('../'+name,import.meta.url),'utf8'));
test('manifest and lockfile agree; retained required dependencies resolve',()=>{
    const manifest=read('package.json'),lock=read('package-lock.json'),pk=lock.packages,root=pk[''];
    assert.equal(manifest.version,lock.version);assert.equal(manifest.version,root.version);
    assert.deepEqual(manifest.dependencies,root.dependencies);
    assert.deepEqual(manifest.devDependencies,root.devDependencies);
    const reached=new Set(),queue=Object.keys({...root.dependencies,...root.devDependencies}).map(name=>['',name,false]);
    function resolve(from,name){
        let p=from;
        while(true){const path=(p?p+'/':'')+'node_modules/'+name;if(pk[path])return path;if(!p)return;const i=p.lastIndexOf('/node_modules/');p=i<0?'':p.slice(0,i);}
    }
    while(queue.length){
        const [from,name,optional]=queue.pop(),path=resolve(from,name);
        if(!path){assert.ok(optional,'Missing '+name+' from '+from);continue;}
        if(reached.has(path))continue;
        reached.add(path);
        const entry=pk[path];
        for(const n of Object.keys(entry.dependencies||{}))queue.push([path,n,Object.hasOwn(entry.optionalDependencies||{},n)]);
        for(const n of Object.keys(entry.optionalDependencies||{}))queue.push([path,n,true]);
        for(const n of Object.keys(entry.peerDependencies||{}))queue.push([path,n,Boolean(entry.peerDependenciesMeta?.[n]?.optional)]);
    }
    assert.equal(reached.size,Object.keys(pk).length-1,'Unreachable lock entries');
});
