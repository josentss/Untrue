import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaInput,durationText,publicError} from '../core/downloadPolicy.js';
import {downloadArgs,commonArgs} from '../services/musicDownloader.js';
test('canonical YouTube links and bounded searches',()=>{
    const expected='https://www.youtube.com/watch?v=abcdefghijk';
    for(const q of ['https://youtu.be/abcdefghijk?t=20','https://www.youtube.com/watch?v=abcdefghijk&list=PL123','https://youtube.com/shorts/abcdefghijk','youtube.com/watch?v=abcdefghijk','https://music.youtube.com/watch?v=abcdefghijk'])assert.equal(mediaInput('youtube',q),expected);
    assert.equal(mediaInput('youtube','artist song'),'ytsearch1:artist song');
    for(const q of ['https://youtube.com.evil.test/watch?v=abcdefghijk','https://user@youtube.com/watch?v=abcdefghijk','https://youtube.com/playlist?list=PL123','file:///etc/passwd','--exec whoami','https://youtube.com:123/watch?v=abcdefghijk','https://youtube.com/redirect?q=https://evil.test'])assert.throws(()=>mediaInput('youtube',q));
});
test('SoundCloud single-track inputs and no playlist or foreign URL',()=>{
    assert.equal(mediaInput('soundcloud','https://soundcloud.com/artist/song?si=123'),'https://soundcloud.com/artist/song');
    assert.equal(mediaInput('soundcloud','https://on.soundcloud.com/AbC123'),'https://on.soundcloud.com/AbC123');
    assert.equal(mediaInput('soundcloud','artist song'),'scsearch1:artist song');
    for(const q of ['https://soundcloud.com/artist/sets/album','https://soundcloud.com/artist/likes','https://other.test/track','ftp://soundcloud.com/a/b'])assert.throws(()=>mediaInput('soundcloud',q));
});
test('download command flags and classified errors',()=>{
    const args=downloadArgs('ytsearch1:test','/tmp/job','video',12345);
    assert.equal(args.at(-2),'--');assert.equal(args.at(-1),'ytsearch1:test');assert.ok(args.includes('12345'));assert.ok(args.includes('--no-remote-components'));assert.ok(args.includes('--no-plugin-dirs'));assert.ok(commonArgs().some(a=>a.startsWith('node:')));
    assert.equal(durationText(3661),'1:01:01');
    assert.equal(publicError({diagnostic:'Sign in to confirm you are not a bot'}).code,'restricted');
    assert.equal(publicError({diagnostic:'HTTP Error 429'}).code,'remote_limit');
    assert.equal(publicError(new Error('Tiempo de procesamiento agotado')).code,'timeout');
});

import { run } from '../core/process.js';
test('scoped diagnostics and cancellation do not change existing process defaults',async()=>{
    const code='console.error("synthetic diagnostic");process.exit(2)';
    await assert.rejects(run(process.execPath,['-e',code]),e=>!e.diagnostic);
    await assert.rejects(run(process.execPath,['-e',code],{diagnostics:true}),e=>e.diagnostic.includes('synthetic diagnostic'));
    const abort=new AbortController();
    const pending=run(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:abort.signal,processGroup:true});
    abort.abort(Error('test cancellation'));
    await assert.rejects(pending,/test cancellation/);
});
