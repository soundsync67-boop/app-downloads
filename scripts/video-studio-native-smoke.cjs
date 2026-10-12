const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const base=path.resolve(process.argv[2]),port=9349;
assert.equal(process.platform,'win32');
const ffmpeg=path.join(base,'resources/media-tools/ffmpeg.exe');
const sample=path.join(base,'test clip # кириллица.mp4');
const made=cp.spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=180x320:r=30:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-shortest',sample]);assert.equal(made.status,0,String(made.stderr));
const app=cp.spawn(path.join(base,'Video Studio.exe'),['--remote-debugging-port='+port],{stdio:'ignore'});
let seq=0;const sockets=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<300;i++){try{const v=await fn();if(v)return v;}catch{}await sleep(200);}throw Error('Timeout '+label);}
async function session(target){
  const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();sockets.push(ws);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
  return async expression=>{const id=++seq;const promise=new Promise(r=>pending.set(id,r));ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));const reply=await promise;if(reply.error||reply.result.exceptionDetails)throw Error(JSON.stringify(reply));return reply.result.result.value;};
}
(async()=>{try{
  const targets=await until(async()=>{const list=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());return list.some(t=>t.url.endsWith('/studio-index.html'))&&list.length>=5?list:null;},'packaged application startup');
  const shell=await session(targets.find(t=>t.url.endsWith('/studio-index.html')));
  const compiler=await session(targets.find(t=>t.url.endsWith('/triplemix/index.html')));
  const pages=[];for(const target of targets.filter(t=>/\/(triplemix|shorts|memes|logo-cleaner)\/index.html$/.test(t.url)))pages.push(await session(target));
  await until(()=>shell('!!window.StudioAppearanceUI'),'appearance ready');
  await shell("document.querySelector('[data-tab=settings]').click();window.StudioAppearanceUI.showSection('themes')");
  for(const theme of ['classic','top','editor','native','quiet','right']){
    await shell(`document.querySelector('[data-theme-choice=${theme}]').click()`);
    for(const page of pages)await until(()=>page(`document.body.dataset.theme==='${theme}'`),'theme '+theme);
    await shell('document.getElementById("sidebarToggle").click();document.getElementById("sidebarToggle").click()');
    assert(await shell('document.getElementById("settingsNavButton").getBoundingClientRect().width>0'));
  }
  const url=await compiler(`toFileUrl(${JSON.stringify(sample)})`);assert(url.startsWith('file:///'));assert(url.includes('%23'));assert(!url.includes('%5C'));
  const readable=await compiler(`(async()=>{const v=document.createElement('video');v.src=${JSON.stringify(url)};await new Promise((r,j)=>{v.onloadedmetadata=r;v.onerror=()=>j(Error('Video URI failed'));});return v.videoWidth;})()`);assert.equal(readable,180);
  await shell('window.studio.setRenderPause(0)');
  const output=path.join(base,'render-test.mp4');
  const result=await compiler(`window.triplemix.renderVideo({jobId:'native-windows-test',groups:[{files:[${JSON.stringify(sample)},${JSON.stringify(sample)},${JSON.stringify(sample)}]}],outputPath:${JSON.stringify(output)},quality:720,fps:30,bitrate:4,voiceEffect:'original',comfortAudio:false})`);
  assert(result.ok,JSON.stringify(result));assert(fs.statSync(output).size>1000);
  const probe=cp.spawnSync(path.join(base,'resources/media-tools/ffprobe.exe'),['-v','error','-show_entries','stream=codec_type','-of','json',output],{encoding:'utf8'});assert.equal(probe.status,0,probe.stderr);const streams=JSON.parse(probe.stdout).streams;assert(streams.some(s=>s.codec_type==='video'));assert(streams.some(s=>s.codec_type==='audio'));
  await until(()=>compiler('!!document.querySelector(".queue-thumbnail img")?.naturalWidth'),'Windows queue image');
  const queue=await shell('window.renderQueue.get()');assert.equal(queue.activeCount,0);assert(queue.jobs.some(j=>j.state==='done'));
  console.log(JSON.stringify({pass:true,platform:process.platform,themes:6,videoUrl:true,nativeRender:true,queueThumbnail:true}));
}finally{sockets.forEach(ws=>ws.close());cp.spawnSync('taskkill',['/PID',String(app.pid),'/T','/F'],{stdio:'ignore'});}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
