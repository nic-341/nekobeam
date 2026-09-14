'use strict';
// Replace these PNGs to customize the artwork. Missing images use pixel-art fallbacks.
const SPRITES={cat:'assets/cat.png',mouse:'assets/mouse.png',taiyaki:'assets/taiyaki.png',tower:'assets/tower.png',background:'assets/hills-background.png'};
const art={};for(const [k,src] of Object.entries(SPRITES)){const im=new Image();im.onload=()=>art[k]=im;im.src=src;}
const canvas=document.querySelector('#canvas'),ctx=canvas.getContext('2d');
const ui={overlay:document.querySelector('#overlay'),title:document.querySelector('h1'),msg:document.querySelector('#message'),start:document.querySelector('#start'),life:document.querySelector('#life'),fish:document.querySelector('#fish'),bar:document.querySelector('#progress i')};
const WORLD=12000,GROUND=440,SECTION=1200,SECTION_COUNT=10,keys={left:false,right:false,jump:false,beam:false},dash={left:false,right:false},lastTap={left:-1000,right:-1000};
// Ground spans and raised ledges are local to each section. The first 300px
// remain safe for respawning; every required jump fits ordinary walking speed.
const COURSE_PATTERNS=[
 {ground:[[0,960],[1080,120]],ledges:[[390,55,120],[650,105,160],[895,65,140]]},
 {ground:[[0,1200]],ledges:[[370,35,100],[470,70,100],[570,105,110],[840,45,150]]},
 {ground:[[0,620],[700,200],[990,210]],ledges:[[360,45,120],[735,35,95]]},
 {ground:[[0,1200]],ledges:[[360,60,180],[590,110,170],[820,60,180]]},
 {ground:[[0,840],[940,260]],ledges:[[390,45,170],[650,75,140],[970,30,100]]}
];
const COURSE_ORDER=[0,1,2,3,4,2,1,3,0,4];
let state='ready',player,camera=0,platforms=[],mice=[],fish=[],shots=[],particles=[],collected=0,elapsed=0,checkpoint=80,last=0,acc=0,jumpQueued=false,sound=false,audio;
function tone(f,d=.08){if(!sound)return;try{audio??=new(window.AudioContext||window.webkitAudioContext)();audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.type='square';o.frequency.value=f;g.gain.setValueAtTime(.035,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+d);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+d);}catch{}}
function reset(){player={x:80,y:GROUND-38,w:38,h:38,vx:0,vy:0,dir:1,hp:3,inv:0,grounded:false,coyote:0,cool:0};camera=0;collected=0;elapsed=0;checkpoint=80;shots=[];particles=[];platforms=[];mice=[];fish=[];
 for(let s=0;s<SECTION_COUNT;s++){
  const x=s*SECTION,pattern=COURSE_PATTERNS[COURSE_ORDER[s]];
  for(const [offset,width] of pattern.ground)platforms.push({x:x+offset,y:GROUND,w:width,h:180});
  for(const [offset,height,width] of pattern.ledges)platforms.push({x:x+offset,y:GROUND-height,w:width,h:height<=75?height:20});
  for(const offset of [260,435,605,775,1070]){const surfaces=platforms.filter(p=>p.x<=x+offset&&p.x+p.w>x+offset);const top=surfaces.length?Math.min(...surfaces.map(p=>p.y)):GROUND;fish.push({x:x+offset,y:top-34,taken:false});}
  if(s>0)mice.push({x:x+220,y:GROUND-25,w:34,h:25,v:36+(s%3)*8,min:x+100,max:x+310,alive:true});
  if(s===0)mice.push({x:x+560,y:GROUND-25,w:34,h:25,v:-42,min:x+525,max:x+850,alive:true});
  else {const ledge=pattern.ledges[pattern.ledges.length-1];mice.push({x:x+ledge[0]+30,y:GROUND-ledge[1]-25,w:34,h:25,v:s%2?34:-34,min:x+ledge[0]+5,max:x+ledge[0]+ledge[2]-39,alive:true});}
 }
 // A clear landing and runway in front of the goal tower.
 platforms.push({x:WORLD-300,y:GROUND,w:300,h:180});clearKeys();updateHUD();}
function clearKeys(){for(const k in keys)keys[k]=false;dash.left=dash.right=false;jumpQueued=false;document.querySelectorAll('.active').forEach(e=>e.classList.remove('active'));}
function updateHUD(){ui.life.textContent='♥ '.repeat(player.hp)+'♡ '.repeat(3-player.hp);ui.fish.textContent=String(collected).padStart(2,'0');ui.bar.style.width=Math.min(100,player.x/(WORLD-200)*100)+'%';}
function show(title,msg,label){ui.title.innerHTML=title;ui.msg.textContent=msg;ui.start.innerHTML=label+' <span>→</span>';ui.overlay.style.display='flex';}
function start(){if(state==='paused'){state='playing';ui.overlay.style.display='none';return;}reset();state='playing';ui.overlay.style.display='none';tone(660);}
function pause(){if(state==='playing'){state='paused';clearKeys();show('ひとやすみ。','猫もあなたも、ちょっと休憩。','冒険をつづける');}else if(state==='paused')start();}
function hit(fall=false){if(!fall&&player.inv>0)return;player.hp--;tone(130,.2);burst(player.x+18,player.y+15,'#f3978c',12);if(player.hp<=0){state='over';clearKeys();show('また、<br><em>歩き出そう。</em>','ライフがなくなりました。たい焼き '+collected+' 個を集めました。','もういちど遊ぶ');}else{player.inv=2;player.vy=-210;if(fall){player.x=checkpoint;player.y=GROUND-100;player.vy=0;shots=[];}}updateHUD();}
function rect(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function burst(x,y,color,n){for(let i=0;i<n;i++)particles.push({x,y,vx:Math.cos(i*2.4)*70,vy:Math.sin(i*2.4)*90-40,t:.5,color});}
function step(dt){if(state!=='playing')return;elapsed+=dt;player.inv=Math.max(0,player.inv-dt);player.cool-=dt;player.coyote=player.grounded?.11:Math.max(0,player.coyote-dt);
 const direction=Number(keys.right)-Number(keys.left);const running=direction>0?dash.right:dash.left;player.vx=direction*(running?265:190);if(direction)player.dir=direction;
 if(jumpQueued&&player.coyote>0){player.vy=-465;player.grounded=false;player.coyote=0;tone(430);}jumpQueued=false;
 player.vy=Math.min(700,player.vy+1250*dt);player.x=Math.max(0,Math.min(WORLD-40,player.x+player.vx*dt));
 for(const p of platforms)if(rect(player,p)){if(player.vx>0)player.x=p.x-player.w;else if(player.vx<0)player.x=p.x+p.w;}
 const oldY=player.y;player.y+=player.vy*dt;player.grounded=false;for(const p of platforms)if(rect(player,p)){if(player.vy>=0&&oldY+player.h<=p.y+1){player.y=p.y-player.h;player.vy=0;player.grounded=true;}else if(player.vy<0&&oldY>=p.y+p.h-1){player.y=p.y+p.h;player.vy=0;}}
 if(player.grounded&&player.x%SECTION<300)checkpoint=Math.floor(player.x/SECTION)*SECTION+80;
 if(player.y>700){hit(true);if(state!=='playing')return;}
 if(keys.beam&&player.cool<=0){shots.push({x:player.x+(player.dir===1?32:-22),y:player.y+12,w:28,h:5,v:player.dir*650,t:1.1});player.cool=.24;tone(880,.04);}
 for(const b of shots){b.x+=b.v*dt;b.t-=dt;for(const m of mice)if(m.alive&&b.t>0&&rect(b,m)){m.alive=false;b.t=0;burst(m.x+15,m.y+10,'#f8ca73',10);tone(220,.08);}}shots=shots.filter(b=>b.t>0);
 for(const m of mice){if(!m.alive)continue;m.x+=m.v*dt;if(m.x<m.min){m.x=m.min;m.v=Math.abs(m.v);}if(m.x>m.max){m.x=m.max;m.v=-Math.abs(m.v);}if(rect(player,m)){hit();if(state!=='playing')return;}}
 for(const f of fish)if(!f.taken&&rect(player,{x:f.x-12,y:f.y-10,w:24,h:20})){f.taken=true;collected++;burst(f.x,f.y,'#ffdf8d',8);tone(1100,.08);}
 particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=160*dt;p.t-=dt;});particles=particles.filter(p=>p.t>0);
 camera=Math.max(0,Math.min(WORLD-viewW(),player.x-viewW()*.33));
 if(rect(player,{x:WORLD-200,y:GROUND-145,w:110,h:145})){state='clear';clearKeys();tone(1320,.3);show('おかえり、<br><em>小さな冒険家。</em>','ステージクリア！ たい焼き '+collected+' / '+fish.length+' 個 · '+Math.floor(elapsed/60)+'分'+Math.floor(elapsed%60)+'秒','もういちど冒険する');}updateHUD();}
const catPixels=['  gg      gg  ',' gwwg    gwwg ',' gwwwggggwwwg ','gwwwwwwwwwwwwg','gwwggwwwwggwwg','gwwkkwwwwkkwwg','gwwwwwnnwwwwwg',' gwwwwwwwwwwg ','  gwwggggwwg  ','  gwwwwwwwwg  ','gggwwwwwwwwg  ','gwwwwwwwwwwg  ',' gggwwggwwgg  ','   gww  wwg   '],mousePixels=['  gg    gg    ',' gppg  gppg   ','  gggggggg    ',' gggggggggg   ','ggggkgggkggg  ','gggggggggggn  ',' gggggggggg   ','  gggggggg  gg','  gg    ggggg '],fishPixels=['     aa       ','   aaooaa   aa','  aooooooaaaao',' aooaoaooooooo',' aooookooooooo','  aooooooaaaao','   aaooaa   aa','     aa       '];
function pixel(rows,x,y,scale,palette,flip=false){ctx.save();ctx.translate(Math.round(x),Math.round(y));if(flip){ctx.translate(rows[0].length*scale,0);ctx.scale(-1,1);}rows.forEach((r,yy)=>[...r].forEach((c,xx)=>{if(palette[c]){ctx.fillStyle=palette[c];ctx.fillRect(xx*scale,yy*scale,scale,scale);}}));ctx.restore();}
function sprite(name,x,y,w,h,flip=false){if(!art[name])return false;ctx.save();ctx.translate(Math.round(x),Math.round(y));if(flip){ctx.translate(w,0);ctx.scale(-1,1);}ctx.drawImage(art[name],0,0,w,h);ctx.restore();return true;}
function viewW(){return canvas.width/canvas.height*540;}

// Deterministic stone and grass tiles; visuals never change collision geometry.
function noise(n){return Math.abs(Math.sin(n*127.1+311.7)*43758.5453)%1;}
function terrain(p){ctx.save();ctx.beginPath();ctx.rect(p.x,p.y,p.w,p.h);ctx.clip();ctx.fillStyle='#283c4c';ctx.fillRect(p.x,p.y,p.w,p.h);
 const colors=['#647777','#7b8580','#87928a','#536b70','#8d9185'];
 for(let row=0;row<p.h/25;row++){for(let col=-1;col<p.w/34+1;col++){const x=p.x+col*34+(row%2)*17,y=p.y+row*25+5,n=row*97+col*3+p.x;ctx.fillStyle=colors[Math.floor(noise(n)*5)];ctx.fillRect(x+2,y+2,30,21);ctx.fillStyle='#b3b4a0';ctx.fillRect(x+3,y+2,27,2);ctx.fillRect(x+2,y+4,2,10);ctx.fillStyle='#3b515b';ctx.fillRect(x+4,y+21,26,2);for(let d=0;d<6;d++){ctx.fillStyle=d%2?'#455e62':'#a1a48e';ctx.fillRect(x+4+Math.floor(noise(n+d+8)*24),y+5+Math.floor(noise(n+d+31)*14),2,2);}if(noise(n+2)>.62){ctx.fillStyle='#356549';ctx.fillRect(x+2,y+2,7,9);ctx.fillStyle='#78a456';ctx.fillRect(x+2,y+2,4,4);}}}
 ctx.fillStyle='#254c40';ctx.fillRect(p.x,p.y,p.w,10);ctx.fillStyle='#699b43';ctx.fillRect(p.x,p.y,p.w,5);ctx.fillStyle='#d4e68a';ctx.fillRect(p.x,p.y,p.w,2);
 for(let x=p.x;x<p.x+p.w;x+=5){let n=noise(x);ctx.fillStyle=n>.5?'#88b854':'#adc969';ctx.fillRect(x,p.y+2,3,3+n*9);if(n>.8){ctx.fillStyle='#568c48';ctx.fillRect(x,p.y+8,3,12+n*5);}}ctx.restore();
 for(let x=p.x+8;x<p.x+p.w;x+=19){ctx.fillStyle='#a6ce65';ctx.fillRect(x,p.y-3,2,4);if(noise(x)>.5){ctx.fillStyle='#76ab4f';ctx.fillRect(x+3,p.y-5,2,6);}}
}
function flower(x,y){ctx.fillStyle='#3f7b48';ctx.fillRect(x,y-17,2,17);ctx.fillRect(x-4,y-8,4,2);ctx.fillStyle='#fff9d7';ctx.fillRect(x-4,y-20,10,3);ctx.fillRect(x-1,y-23,4,10);ctx.fillStyle='#efcf57';ctx.fillRect(x-1,y-20,4,3);}
// Small world decorations are visual only: they never hide holes or block movement.
function details(p){
 const left=p.x+8+Math.max(0,Math.floor((camera-p.x-8)/32))*32,right=Math.min(p.x+p.w-8,camera+viewW()+20);
 for(let x=left;x<right;x+=32){const n=noise(x+p.y),y=p.y;
  if(n>.76){flower(x,y);ctx.fillStyle='#deb1e9';ctx.fillRect(x-3,y-20,3,3);}
  else if(n>.53){ctx.fillStyle='#314f46';ctx.fillRect(x,y-6,10,6);ctx.fillStyle='#88a68d';ctx.fillRect(x+2,y-7,6,4);ctx.fillStyle='#d0cdb0';ctx.fillRect(x+3,y-7,3,1);}
  else if(n>.35){ctx.fillStyle='#d6bb8a';ctx.fillRect(x+3,y-8,2,8);ctx.fillStyle='#b75256';ctx.fillRect(x,y-10,9,4);ctx.fillStyle='#f8dfb0';ctx.fillRect(x+2,y-10,2,2);}
  // Fine moss, root cracks, and hanging ivy break up the stone grid.
  if(p.h>45&&n>.45){for(let d=9;d<Math.min(p.h-5,35+n*58);d+=5){const vx=x+Math.round(Math.sin(d*.15)*3);ctx.fillStyle='#304d45';ctx.fillRect(vx,y+d,2,6);ctx.fillStyle=d%2?'#5b874b':'#87a55e';ctx.fillRect(vx+(d%2?-3:1),y+d,4,3);}}
  if(p.h>70){ctx.fillStyle='#354954';ctx.fillRect(x+13,y+40,1,9);ctx.fillRect(x+14,y+48,3,1);ctx.fillRect(x+16,y+48,1,6);}
 }
}
function shrub(x,y){ctx.fillStyle='#284e46';ctx.fillRect(x,y-12,35,12);ctx.fillRect(x+6,y-21,24,14);ctx.fillStyle='#47784c';ctx.fillRect(x+3,y-14,29,8);ctx.fillRect(x+9,y-23,15,13);ctx.fillStyle='#82ad5b';ctx.fillRect(x+10,y-23,9,4);ctx.fillRect(x+3,y-14,8,3);ctx.fillStyle='#e5be79';ctx.fillRect(x+22,y-12,2,2);}
function cuteTower(x,y){
 const r=(a,b,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(x+a,y+b,w,h);};
 // Plush base and striped sisal posts.
 r(0,132,110,13,'#4d455b');r(3,130,104,10,'#e4aac1');r(8,130,93,3,'#ffe2e4');
 for(const px of [23,82]){r(px,45,12,85,'#765c5b');r(px+2,45,8,85,'#dcb990');for(let yy=49;yy<128;yy+=6)r(px+2,yy,8,2,'#ae856d');r(px+3,46,2,80,'#efd6a6');}
 // Lower mint hammock with a pink blanket.
 r(39,103,40,6,'#4d455b');r(44,109,31,8,'#6caaab');r(49,114,21,5,'#b8e0cf');r(55,107,15,6,'#f3bbcb');
 // Cat-eared house, round doorway, and tiny face details.
 r(1,54,57,48,'#51475b');r(4,57,51,41,'#f3dabb');
 r(3,45,5,15,'#51475b');r(8,49,5,12,'#51475b');r(46,45,5,15,'#51475b');r(41,49,5,12,'#51475b');
 r(6,50,5,10,'#eaaabd');r(43,50,5,10,'#eaaabd');r(6,59,46,4,'#fff0d7');
 r(20,75,20,23,'#685064');r(24,71,12,6,'#685064');r(22,93,16,5,'#dca1bd');
 r(12,68,3,3,'#66536a');r(44,68,3,3,'#66536a');r(26,65,5,3,'#df99b0');
 r(0,98,61,8,'#85738d');r(3,98,55,3,'#c8b6dc');
 // Top cloud cushion with ears and a dangling golden toy.
 r(61,21,48,10,'#53475e');r(64,16,41,10,'#d6b4da');r(69,13,29,8,'#fbe0e5');
 r(65,5,7,13,'#705675');r(67,7,3,10,'#f4becd');r(95,5,7,13,'#705675');r(97,7,3,10,'#f4becd');
 r(77,20,3,2,'#745b78');r(90,20,3,2,'#745b78');r(84,22,3,2,'#d38eac');
 const swing=Math.round(Math.sin(elapsed*2)*3);r(101,31,1,17,'#e8d6ba');r(98+swing,47,7,7,'#dcab51');r(99+swing,47,3,2,'#ffeb9c');
 // Paw-print badge.
 r(77,135,8,5,'#b77797');for(const px of [73,79,85])r(px,132,3,3,'#b77797');
}
function sign(x,y,line1,line2){ctx.fillStyle='#3a302d';ctx.fillRect(x+36,y+54,8,38);ctx.fillRect(x-2,y-2,86,60);ctx.fillStyle='#795439';ctx.fillRect(x,y,82,55);ctx.fillStyle='#ad8459';ctx.fillRect(x+2,y+2,78,3);ctx.fillStyle='#543e31';ctx.fillRect(x+2,y+26,78,2);ctx.fillStyle='#efe5c8';ctx.font='11px monospace';ctx.textAlign='center';ctx.fillText(line1,x+41,y+21);ctx.fillText(line2,x+41,y+41);ctx.textAlign='start';}

function draw(){const w=viewW();ctx.setTransform(canvas.width/w,0,0,canvas.height/540,0,0);ctx.imageSmoothingEnabled=false;
 ctx.fillStyle='#3c95ed';ctx.fillRect(0,0,w,540);
 if(art.background){const bw=540*art.background.width/art.background.height;const offset=(camera*.035)%bw;for(let i=-1;i<=Math.ceil(w/bw)+1;i++){const x=i*bw-offset;ctx.save();if(i%2){ctx.translate(x+bw,0);ctx.scale(-1,1);ctx.drawImage(art.background,0,0,bw,540);}else ctx.drawImage(art.background,x,0,bw,540);ctx.restore();}}
 ctx.fillStyle='#268ddb';ctx.fillRect(0,501,w,39);for(let i=0;i<60;i++){ctx.fillStyle=i%2?'#d2f5ff':'#6bc9ff';ctx.fillRect(((i*57-elapsed*20-camera*.3)%(w+70)+w+70)%(w+70)-35,506+i%6*6,10+i%4*5,2);}
 ctx.save();ctx.translate(-Math.round(camera),0);
 for(const p of platforms){if(p.x+p.w<camera||p.x>camera+w)continue;terrain(p);details(p);}
 const signX=WORLD/2-41;if(signX>camera-90&&signX<camera+w)sign(signX,GROUND-92,'中間地点','あと半分！ →');
 for(let i=0;i<SECTION_COUNT;i++){const x=i*SECTION+155;if(x>camera-50&&x<camera+w){shrub(x,GROUND);flower(x+80,GROUND);}}
 for(const f of fish)if(!f.taken&&f.x>camera-30&&f.x<camera+w+30){const y=f.y+Math.sin(elapsed*3+f.x)*3;if(!sprite('taiyaki',f.x-14,y-10,28,20))pixel(fishPixels,f.x-14,y-8,2,{a:'#ab6d40',o:'#f4bb66',k:'#493e38'});}
 for(const m of mice)if(m.alive&&m.x>camera-40&&m.x<camera+w+40){if(!sprite('mouse',m.x,m.y,m.w,m.h,m.v<0))pixel(mousePixels,m.x-2,m.y+2,2.5,{g:'#7b7480',p:'#e5a6a0',k:'#28343a',n:'#f4bbb0'},m.v<0);}
 const tx=WORLD-200;if(!sprite('tower',tx,GROUND-145,110,145))cuteTower(tx,GROUND-145);
 for(const b of shots){ctx.fillStyle='#a5fff0';ctx.fillRect(b.x,b.y,b.w,b.h);ctx.fillStyle='#fffbe5';ctx.fillRect(b.x,b.y+1,b.w,2);}
 if(player.inv<=0||Math.floor(player.inv*12)%2===0){const bob=player.grounded&&player.vx?Math.sin(elapsed*20)*1.5:0;if(!sprite('cat',player.x-20,player.y-10+bob,68,48-bob,player.dir<0))pixel(catPixels,player.x-2,player.y-2+bob,3,{g:'#909da1',w:'#f9f6e9',k:'#263e44',n:'#e4aaa6'},player.dir<0);}
 for(const p of particles){ctx.globalAlpha=p.t*2;ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,4,4);}ctx.globalAlpha=1;ctx.restore();}
function resize(){const r=canvas.getBoundingClientRect();const width=Math.round(r.width/r.height*540);if(canvas.width!==width)canvas.width=width;canvas.height=540;draw();}window.addEventListener('resize',resize);
function press(k){if(state!=='playing')return;if((k==='left'||k==='right')&&!keys[k]){const now=performance.now();dash[k]=now-lastTap[k]<300;lastTap[k]=now;}if(k==='jump'&&!keys.jump)jumpQueued=true;keys[k]=true;}
function release(k){keys[k]=false;if(k in dash)dash[k]=false;}
const mapping={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',Space:'jump',ArrowUp:'jump',KeyW:'jump',KeyX:'beam',KeyJ:'beam',KeyZ:'beam'};
window.addEventListener('keydown',e=>{if(mapping[e.code]){e.preventDefault();if(!e.repeat)press(mapping[e.code]);}if(e.code==='KeyP'&&!e.repeat)pause();});window.addEventListener('keyup',e=>{if(mapping[e.code]){e.preventDefault();release(mapping[e.code]);}});
document.querySelectorAll('[data-key]').forEach(b=>{const pointers=new Set();b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);pointers.add(e.pointerId);press(b.dataset.key);b.classList.add('active');});const end=e=>{pointers.delete(e.pointerId);if(!pointers.size){release(b.dataset.key);b.classList.remove('active');}};b.addEventListener('pointerup',end);b.addEventListener('pointercancel',end);b.addEventListener('lostpointercapture',end);});
document.addEventListener('contextmenu',e=>e.preventDefault());document.addEventListener('dragstart',e=>e.preventDefault());document.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});window.addEventListener('blur',()=>{clearKeys();if(state==='playing')pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearKeys();if(state==='playing')pause();}});
ui.start.onclick=start;document.querySelector('#pause').onclick=pause;document.querySelector('#sound').onclick=()=>{sound=!sound;document.querySelector('#sound').textContent='音 '+(sound?'ON':'OFF');tone(660);};
function frame(t){if(!last)last=t;acc+=Math.min((t-last)/1000,.05);last=t;while(acc>=1/120){step(1/120);acc-=1/120;}draw();requestAnimationFrame(frame);}reset();resize();requestAnimationFrame(frame);
