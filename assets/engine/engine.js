// Moteur vidéo de Rouge Retrouvé, sans interface : toute l'UI est en Flutter.
// Flutter envoie des commandes avec Engine.cmd({c:'…', …}) et reçoit des événements JSON via RougeBridge.
// Algorithmes repris de la version web : compensation d'Ancuti, étirement par canal, stabilisation par
// block matching, suivi par motif centré, conversion WebCodecs.
// Adaptations mobile : précision highp, aperçu à résolution réduite, rotation de conteneur appliquée aux
// pixels (vidéos filmées en portrait), export écrit en flux sur le disque au lieu de rester en mémoire.
(() => {
  'use strict';
  const view = document.getElementById('view'), video = document.getElementById('src');
  const emit = o => {
    const s = JSON.stringify(o);
    if (window.RougeBridge) window.RougeBridge.postMessage(s);
    else (window.__events = window.__events || []).push(o);
  };
  window.addEventListener('error', e => emit({type: 'log', msg: String(e.message)}));
  window.addEventListener('unhandledrejection', e => emit({type: 'log', msg: String(e.reason && e.reason.message || e.reason)}));

  const gl = view.getContext('webgl', {premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false});
  if (!gl){ emit({type: 'fatal', msg: 'WebGL indisponible sur cet appareil'}); return; }
  view.addEventListener('webglcontextlost', e => { e.preventDefault(); emit({type: 'contextLost'}); });

  // ---------- Shaders ----------
  const VS = `attribute vec2 p; varying vec2 v; void main(){ v = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;
  // highp obligatoire : mediump vaut souvent 16 bits sur mobile et pixelliserait les coordonnées en 4K.
  const PREC = `#ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  `;
  const FS = PREC + `
  varying vec2 v; uniform sampler2D t;
  uniform vec3 lo, sc, mn; uniform float al, be, st, sa, ga, sp; uniform vec4 win; uniform vec3 ax, ay;
  void main(){
    vec2 p = win.xy + vec2(v.x, 1.0 - v.y)*win.zw;
    vec3 c = texture2D(t, vec2(dot(ax.xy, p) + ax.z, dot(ay.xy, p) + ay.z)).rgb;
    vec3 c0 = c;
    float r = c.r + al*(mn.g-mn.r)*(1.0-c.r)*c.g;
    float b = c.b + be*(mn.g-mn.b)*(1.0-c.b)*c.g;
    vec3 x = clamp((vec3(r,c.g,b)-lo)*sc, 0.0, 1.0);
    x = pow(x, vec3(ga));
    float l = dot(x, vec3(0.2126,0.7152,0.0722));
    x = clamp(mix(vec3(l), x, sa), 0.0, 1.0);
    x = mix(c, x, st);
    gl_FragColor = vec4(v.x < sp ? c0 : x, 1.0);
  }`;
  function sh(type, src){
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {}; ['lo','sc','mn','al','be','st','sa','ga','sp','win','ax','ay'].forEach(n => U[n] = gl.getUniformLocation(prog, n));
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // Réduction sur le GPU (160×90, moyenne 6×6) pour l'analyse, sans recopier l'image pleine résolution.
  const MW = 160, MH = 90;
  const DFS = PREC + `varying vec2 v; uniform sampler2D t; uniform vec2 px; uniform vec3 ax, ay;
  void main(){ vec3 s = vec3(0.0);
    for (int i=0;i<6;i++) for (int j=0;j<6;j++){
      vec2 q = v + px*((vec2(float(i),float(j))+0.5)/6.0 - 0.5), p = vec2(q.x, 1.0 - q.y);
      s += texture2D(t, vec2(dot(ax.xy, p) + ax.z, dot(ay.xy, p) + ay.z)).rgb; }
    gl_FragColor = vec4(s/36.0, 1.0); }`;
  const dprog = gl.createProgram();
  gl.attachShader(dprog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(dprog, sh(gl.FRAGMENT_SHADER, DFS)); gl.linkProgram(dprog);
  const dLoc = gl.getAttribLocation(dprog, 'p'), dPx = gl.getUniformLocation(dprog, 'px');
  const dAx = gl.getUniformLocation(dprog, 'ax'), dAy = gl.getUniformLocation(dprog, 'ay');

  // Orientation : quarts de tour horaires puis miroirs. baseRot = rotation du conteneur, à appliquer aux
  // pixels pendant la conversion rapide (les images de VideoDecoder ne sont pas tournées).
  const orient = {rot: 0, fh: false, fv: false};
  let baseRot = 0;
  const effRot = () => (orient.rot + baseRot) % 360;
  const comp = (M, N) => [
    [M[0][0]*N[0][0] + M[0][1]*N[1][0], M[0][0]*N[0][1] + M[0][1]*N[1][1], M[0][0]*N[0][2] + M[0][1]*N[1][2] + M[0][2]],
    [M[1][0]*N[0][0] + M[1][1]*N[1][0], M[1][0]*N[0][1] + M[1][1]*N[1][1], M[1][0]*N[0][2] + M[1][1]*N[1][2] + M[1][2]]];
  function orientAffine(){
    const A = [[orient.fh ? -1 : 1, 0, orient.fh ? 1 : 0], [0, orient.fv ? -1 : 1, orient.fv ? 1 : 0]];
    const R = {0: [[1,0,0],[0,1,0]], 90: [[0,1,0],[-1,0,1]], 180: [[-1,0,1],[0,-1,1]], 270: [[0,-1,1],[1,0,0]]}[effRot()];
    return comp([[1,0,0],[0,-1,1]], comp(R, A));
  }
  function setAffine(lx, ly){ const M = orientAffine(); gl.uniform3f(lx, M[0][0], M[0][1], M[0][2]); gl.uniform3f(ly, M[1][0], M[1][1], M[1][2]); }
  function makeTarget(w, h){
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return f;
  }
  const fbo = makeTarget(MW, MH);
  const TW = 384, TH = 216, tfbo = makeTarget(TW, TH);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const pix = new Uint8Array(MW*MH*4); let havePix = false;

  // ---------- Réglages (la valeur de référence est côté Flutter) ----------
  const S = {strength:100, red:100, clip:8, sat:115, bright:105, smooth:90, sforce:92, scrop:10, follow:88,
    stab:true, compare:true, split:.5, fast:true, listen:false, wantHist:false};

  // ---------- Source : démo ou vidéo ----------
  const demo = document.createElement('canvas'); demo.width = 1280; demo.height = 720;
  const dctx = demo.getContext('2d');
  let useDemo = true, demoT = 0, demoPlaying = true, lastTs = 0;
  const demoLen = 12;
  let seed = 7; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647;
  const corals = Array.from({length:14}, () => ({x:rnd()*1280, h:120+rnd()*230, w:30+rnd()*70, c:['#e23a2e','#f07a1c','#d63c7a','#f2c42b','#9b4ad8','#ff5a3c'][Math.floor(rnd()*6)], br:3+Math.floor(rnd()*4)}));
  const fish = Array.from({length:9}, () => ({y:120+rnd()*360, s:40+rnd()*90, sz:16+rnd()*26, c:['#ff7a1a','#ffd23a','#ff3b3b','#ffffff'][Math.floor(rnd()*4)], o:rnd()*1280}));
  function drawDemo(t){
    const c = dctx, W = 1280, H = 720;
    c.globalCompositeOperation = 'source-over';
    c.save();
    c.translate(Math.sin(t*6.1)*13 + Math.sin(t*14.3)*6 + Math.sin(t*0.9)*20, Math.cos(t*7.7)*10 + Math.sin(t*12.1)*5 + Math.sin(t*1.3)*14);
    let g = c.createLinearGradient(0,0,0,H); g.addColorStop(0,'#5fb4d8'); g.addColorStop(1,'#1d5f86');
    c.fillStyle = g; c.fillRect(-80,-80,W+160,H+160);
    c.fillStyle = '#d9c39a'; c.beginPath(); c.moveTo(-80,560);
    for (let x=-80; x<=W+80; x+=40) c.lineTo(x, 560 + Math.sin(x*0.01)*18);
    c.lineTo(W+80,H+80); c.lineTo(-80,H+80); c.fill();
    c.fillStyle = '#5a4a3a'; [[150,600,90],[620,640,120],[1050,610,80]].forEach(([x,y,r]) => { c.beginPath(); c.ellipse(x,y,r,r*0.45,0,Math.PI,0); c.fill(); });
    corals.forEach((k,i) => {
      c.strokeStyle = k.c; c.lineCap = 'round'; c.lineWidth = k.w*0.22;
      for (let j=0;j<k.br;j++){
        const a = -Math.PI/2 + (j-(k.br-1)/2)*0.38 + Math.sin(t*1.2+i+j)*0.05;
        c.beginPath(); c.moveTo(k.x, 600);
        c.quadraticCurveTo(k.x + Math.cos(a)*k.h*0.4, 600 + Math.sin(a)*k.h*0.5, k.x + Math.cos(a)*k.h*0.75, 600 + Math.sin(a)*k.h);
        c.stroke();
      }
    });
    fish.forEach((f,i) => {
      const x = ((f.o + t*f.s) % (W+120)) - 60, y = f.y + Math.sin(t*1.5+i)*12;
      c.fillStyle = f.c; c.beginPath(); c.ellipse(x, y, f.sz, f.sz*0.5, 0, 0, Math.PI*2); c.fill();
      c.beginPath(); c.moveTo(x-f.sz*0.8,y); c.lineTo(x-f.sz*1.5,y-f.sz*0.5); c.lineTo(x-f.sz*1.5,y+f.sz*0.5); c.fill();
      c.fillStyle = '#111'; c.beginPath(); c.arc(x+f.sz*0.55, y-f.sz*0.1, f.sz*0.09, 0, Math.PI*2); c.fill();
    });
    c.globalCompositeOperation = 'lighter';
    for (let i=0;i<5;i++){ const x = 200 + i*230 + Math.sin(t*0.4+i)*40;
      const rg = c.createLinearGradient(0,0,0,H); rg.addColorStop(0,'rgba(255,255,255,.12)'); rg.addColorStop(1,'rgba(255,255,255,0)');
      c.fillStyle = rg; c.beginPath(); c.moveTo(x,0); c.lineTo(x+60,0); c.lineTo(x+200,H); c.lineTo(x+80,H); c.fill(); }
    c.restore();
    c.globalCompositeOperation = 'multiply'; c.fillStyle = 'rgb(62,175,205)'; c.fillRect(0,0,W,H);
    c.globalCompositeOperation = 'source-over'; c.fillStyle = 'rgba(0,92,110,0.30)'; c.fillRect(0,0,W,H);
  }
  let fastFrame = null, fastRunning = false;
  const source = () => fastFrame || (useDemo ? demo : video);
  const rawW = () => fastFrame ? fastFrame.displayWidth : useDemo ? demo.width : video.videoWidth;
  const rawH = () => fastFrame ? fastFrame.displayHeight : useDemo ? demo.height : video.videoHeight;
  const srcW = () => effRot() % 180 ? rawH() : rawW();
  const srcH = () => effRot() % 180 ? rawW() : rawH();
  const isPlaying = () => useDemo ? demoPlaying : !video.paused && !video.ended;
  const curTime = () => useDemo ? demoT : video.currentTime;
  const duration = () => useDemo ? demoLen : (video.duration || 0);

  // ---------- Analyse des couleurs ----------
  const P = {lo:[0,0,0], sc:[1,1,1], mn:[.5,.5,.5], al:0, be:0}; let haveP = false;
  function analyze(){
    if (!havePix) return null;
    const d = pix, n = d.length/4;
    let mR=0, mG=0, mB=0;
    for (let i=0;i<d.length;i+=4){ mR+=d[i]; mG+=d[i+1]; mB+=d[i+2]; }
    mR/=n*255; mG/=n*255; mB/=n*255;
    const al = S.red/100, be = mG > mB ? al*0.5 : 0;
    const hR = new Uint32Array(256), hG = new Uint32Array(256), hB = new Uint32Array(256);
    for (let i=0;i<d.length;i+=4){
      const r=d[i]/255, g=d[i+1]/255, b=d[i+2]/255;
      const r2 = Math.min(1, r + al*(mG-mR)*(1-r)*g), b2 = Math.min(1, b + be*(mG-mB)*(1-b)*g);
      hR[Math.max(0,Math.round(r2*255))]++; hG[d[i+1]]++; hB[Math.max(0,Math.round(b2*255))]++;
    }
    const clip = S.clip/1000;
    const pct = h => { const lo = n*clip, hi = n*(1-clip); let acc=0, a=0, b=255;
      for (let i=0;i<256;i++){ acc+=h[i]; if (acc>lo){ a=i; break; } }
      acc=0; for (let i=0;i<256;i++){ acc+=h[i]; if (acc>=hi){ b=i; break; } }
      if (b-a < 12) b = Math.min(255, a+12); return [a/255, b/255]; };
    const ch = [pct(hR), pct(hG), pct(hB)];
    return {lo: ch.map(c=>c[0]), sc: ch.map(c=>Math.min(5, 1/(c[1]-c[0]))), mn:[mR,mG,mB], al, be};
  }
  function blend(tgt, k){
    if (!haveP){ k = 1; haveP = true; }
    for (let i=0;i<3;i++){ P.lo[i]+=(tgt.lo[i]-P.lo[i])*k; P.sc[i]+=(tgt.sc[i]-P.sc[i])*k; P.mn[i]+=(tgt.mn[i]-P.mn[i])*k; }
    P.al = tgt.al; P.be = tgt.be;
  }

  // ---------- Stabilisation ----------
  const MR = 10;
  const ST = {prev:null, cx:0, cy:0, sx:0, sy:0, ox:0, oy:0};
  function stabReset(){ ST.prev = null; ST.cx = ST.cy = ST.sx = ST.sy = ST.ox = ST.oy = 0; TR.started = false; }
  function grabGray(){
    const g = new Float32Array(MW*MH);
    for (let y=0; y<MH; y++){ const s = (MH-1-y)*MW*4, o = y*MW;
      for (let x=0; x<MW; x++){ const j = s + x*4; g[o+x] = pix[j]*0.3 + pix[j+1]*0.59 + pix[j+2]*0.11; } }
    return g;
  }
  const HW = MW/2, HH = MH/2;
  function half(g){
    const h = new Float32Array(HW*HH);
    for (let y=0; y<HH; y++) for (let x=0; x<HW; x++){ const i = 2*y*MW + 2*x; h[y*HW+x] = (g[i]+g[i+1]+g[i+MW]+g[i+MW+1])*0.25; }
    return h;
  }
  function sad(a, b, W, H, dx, dy, m, step){
    let s = 0;
    for (let y=m; y<H-m; y+=step){ const r0 = y*W, r1 = (y+dy)*W + dx;
      for (let x=m; x<W-m; x+=step) s += Math.abs(b[r1+x] - a[r0+x]); }
    return s;
  }
  function estimate(prev, cur){
    const R = MR >> 1, N = 2*R+1; let best = Infinity, bx = 0, by = 0, sum = 0;
    for (let dy=-R; dy<=R; dy++) for (let dx=-R; dx<=R; dx++){
      const s = sad(prev.h, cur.h, HW, HH, dx, dy, R, 2); sum += s;
      if (s < best){ best = s; bx = dx; by = dy; }
    }
    if (best > 0.92 * sum/(N*N)) return [0,0];
    const M = MR + 3; let cx = 2*bx, cy = 2*by, c;
    for (let pass=0; pass<3; pass++){
      c = [];
      for (let j=-1; j<=1; j++) for (let i=-1; i<=1; i++) c.push(sad(prev.g, cur.g, MW, MH, cx+i, cy+j, M, 1));
      let k = 0; for (let i=1; i<9; i++) if (c[i] < c[k]) k = i;
      if (k === 4) break;
      const nx = cx + (k%3) - 1, ny = cy + ((k/3)|0) - 1;
      if (Math.abs(nx) > MR || Math.abs(ny) > MR || pass === 2) break;
      cx = nx; cy = ny;
    }
    const para = (a,b,d) => { const den = a - 2*b + d; return den > 0 ? Math.max(-.5, Math.min(.5, 0.5*(a-d)/den)) : 0; };
    return [cx + para(c[3], c[4], c[5]), cy + para(c[1], c[4], c[7])];
  }
  function stabStep(){
    if (!havePix) return;
    const g = grabGray(), f = {g, h: half(g)};
    if (ST.prev){ const [dx,dy] = estimate(ST.prev, f); ST.cx += dx; ST.cy += dy; }
    ST.prev = f;
    const m = S.scrop/200, r = Math.min(1, Math.max(Math.abs(ST.ox), Math.abs(ST.oy)) / m);
    const k = (1 - S.sforce/100) + (S.sforce/100) * 0.35 * r*r*r;
    ST.sx += (ST.cx - ST.sx)*k; ST.sy += (ST.cy - ST.sy)*k;
    let ox = (ST.cx - ST.sx)/MW, oy = (ST.cy - ST.sy)/MH;
    if (Math.abs(ox) > m){ ox = Math.sign(ox)*m; ST.sx = ST.cx - ox*MW; }
    if (Math.abs(oy) > m){ oy = Math.sign(oy)*m; ST.sy = ST.cy - oy*MH; }
    ST.ox = ox; ST.oy = oy;
  }

  // ---------- Recadrage ----------
  const crop = {on:false, aspect:'none', x:0, y:0, w:1, h:1};
  let UIM = 'normal', lastSW = 0, lastSH = 0, exporting = false;
  const ASPECTS = {'16:9':16/9, '9:16':9/16, '1:1':1, '4:5':4/5, '4:3':4/3, '3:4':3/4, '21:9':21/9};
  const normRatio = (sw, sh) => ASPECTS[crop.aspect] ? ASPECTS[crop.aspect] * sh / sw : null;
  function fitAspect(keepCenter){
    const sw = srcW() || 1920, sh = srcH() || 1080, an = normRatio(sw, sh);
    const cx = keepCenter ? crop.x + crop.w/2 : .5, cy = keepCenter ? crop.y + crop.h/2 : .5;
    let w = crop.w, h = crop.h;
    if (an){ if (!keepCenter){ h = 1; w = an; if (w > 1){ w = 1; h = 1/an; } } else { w = h*an; if (w > 1){ w = 1; h = w/an; } } }
    else if (!keepCenter){ w = .8; h = .8; }
    crop.w = w; crop.h = h;
    crop.x = Math.min(1 - w, Math.max(0, cx - w/2)); crop.y = Math.min(1 - h, Math.max(0, cy - h/2));
    emitCrop();
  }
  const emitCrop = () => emit({type:'crop', on:crop.on, aspect:crop.aspect, x:crop.x, y:crop.y, w:crop.w, h:crop.h});
  function outDims(sw, sh){
    if ((UIM !== 'normal' && !exporting) || !crop.on) return [sw, sh];
    return [Math.max(2, Math.round(crop.w*sw/2)*2), Math.max(2, Math.round(crop.h*sh/2)*2)];
  }
  function viewWindow(){
    if (UIM !== 'normal' && !exporting) return {x:0, y:0, w:1, h:1};
    let w = 1, h = 1, cx = .5, cy = .5;
    if (crop.on){ w = crop.w; h = crop.h; cx = crop.x + w/2; cy = crop.y + h/2; }
    if (trackMine()){
      if (TR.started){ cx = TR.sx; cy = TR.sy; }
      else { cx = TR.anchor.box.x + TR.anchor.box.w/2; cy = TR.anchor.box.y + TR.anchor.box.h/2; }
    }
    if (S.stab){ const z = 1 - S.scrop/100; w *= z; h *= z; cx += ST.ox; cy += ST.oy; }
    cx = Math.min(1 - w/2, Math.max(w/2, cx)); cy = Math.min(1 - h/2, Math.max(h/2, cy));
    return {x: cx - w/2, y: cy - h/2, w, h};
  }

  // ---------- Suivi du sujet ----------
  const tpix = new Uint8Array(TW*TH*4), tg = new Float32Array(TW*TH); let haveTg = false;
  const TR = {anchor:null, started:false, x:.5, y:.5, vx:0, vy:0, sx:.5, sy:.5, lost:0, lastT:-1, vals:null, path:new Map()};
  let current = null;
  const itemKey = () => (fastRunning || !useDemo) ? (current ? current.id : null) : 'demo';
  const trackMine = () => !!TR.anchor && TR.anchor.key === itemKey();
  const needTrackBuf = () => trackMine() || UIM === 'select';
  function makeTemplate(box){
    const tw = Math.max(8, Math.round(box.w*TW)), th = Math.max(8, Math.round(box.h*TH));
    const s = Math.max(1, Math.ceil(Math.max(tw, th)/22)), gw = Math.max(4, Math.floor(tw/s)), gh = Math.max(4, Math.floor(th/s));
    const x0 = Math.round(box.x*TW), y0 = Math.round(box.y*TH);
    const vals = new Float32Array(gw*gh); let m = 0;
    for (let j=0; j<gh; j++) for (let i=0; i<gw; i++){ const v = tg[Math.min(TH-1, y0+j*s)*TW + Math.min(TW-1, x0+i*s)]; vals[j*gw+i] = v; m += v; }
    m /= vals.length; let mad = 0;
    for (let k=0; k<vals.length; k++){ vals[k] -= m; mad += Math.abs(vals[k]); }
    return {gw, gh, s, tw: gw*s, th: gh*s, vals, mad: mad/vals.length};
  }
  function zsad(px, py, tp, vals){
    const {gw, gh, s} = tp, n = gw*gh; let sum = 0;
    for (let j=0; j<gh; j++){ const r = (py + j*s)*TW + px; for (let i=0; i<gw; i++) sum += tg[r + i*s]; }
    const m = sum/n; let e = 0, k = 0;
    for (let j=0; j<gh; j++){ const r = (py + j*s)*TW + px; for (let i=0; i<gw; i++, k++) e += Math.abs(tg[r + i*s] - m - vals[k]); }
    return e/n;
  }
  function nearestPath(t){
    const k0 = Math.round(t*100);
    for (let d=0; d<=12; d++){ const r = TR.path.get(k0+d) || TR.path.get(k0-d); if (r) return r; }
    return null;
  }
  function trackInit(t){
    const a = TR.anchor, rec = t - a.t > 0.05 ? nearestPath(t) : null;
    if (rec){ TR.x = rec.x; TR.y = rec.y; TR.sx = rec.sx; TR.sy = rec.sy; }
    else { TR.x = TR.sx = a.box.x + a.box.w/2; TR.y = TR.sy = a.box.y + a.box.h/2; TR.vals = Float32Array.from(a.tpl.vals); }
    if (!TR.vals) TR.vals = Float32Array.from(a.tpl.vals);
    TR.vx = TR.vy = 0; TR.lost = 0; TR.started = true; TR.lastT = t;
  }
  function trackStep(t){
    if (!trackMine() || !haveTg) return;
    const a = TR.anchor, tp = a.tpl;
    if (t < a.t - 0.02){ TR.started = false; return; }
    if (!TR.started){ trackInit(t); return; }
    if (t <= TR.lastT) return;
    TR.lastT = t;
    const R = Math.round(Math.min(44, (8 + 1.5*Math.hypot(TR.vx, TR.vy)) * (TR.lost ? 2 : 1)));
    const px0 = Math.round(TR.x*TW - tp.tw/2 + TR.vx), py0 = Math.round(TR.y*TH - tp.th/2 + TR.vy);
    const maxX = TW - tp.tw - 1, maxY = TH - tp.th - 1;
    let best = Infinity, bx = px0, by = py0;
    for (let dy=-R; dy<=R; dy+=2) for (let dx=-R; dx<=R; dx+=2){
      const x = Math.min(maxX, Math.max(0, px0+dx)), y = Math.min(maxY, Math.max(0, py0+dy));
      const e = zsad(x, y, tp, TR.vals); if (e < best){ best = e; bx = x; by = y; }
    }
    const c = [];
    for (let j=-1; j<=1; j++) for (let i=-1; i<=1; i++){
      const x = Math.min(maxX, Math.max(0, bx+i)), y = Math.min(maxY, Math.max(0, by+j));
      c.push(zsad(x, y, tp, TR.vals));
    }
    let k = 4; for (let i=0; i<9; i++) if (c[i] < c[k]) k = i;
    bx = Math.min(maxX, Math.max(0, bx + (k%3) - 1)); by = Math.min(maxY, Math.max(0, by + ((k/3)|0) - 1));
    const score = c[k] / (tp.mad + 1);
    const para = (p, q, r) => { const d = p - 2*q + r; return d > 0 ? Math.max(-.5, Math.min(.5, .5*(p - r)/d)) : 0; };
    const fx = k === 4 ? para(c[3], c[4], c[5]) : 0, fy = k === 4 ? para(c[1], c[4], c[7]) : 0;
    if (score > 0.85){ TR.lost++; TR.vx *= .6; TR.vy *= .6; }
    else {
      const nx = (bx + fx + tp.tw/2)/TW, ny = (by + fy + tp.th/2)/TH;
      TR.vx = .6*TR.vx + .4*(nx - TR.x)*TW; TR.vy = .6*TR.vy + .4*(ny - TR.y)*TH;
      TR.x = nx; TR.y = ny; TR.lost = 0;
      if (score < 0.5){
        const {gw, gh, s} = tp; let m = 0;
        for (let j=0; j<gh; j++) for (let i=0; i<gw; i++) m += tg[(by+j*s)*TW + bx + i*s];
        m /= gw*gh;
        for (let j=0, q=0; j<gh; j++) for (let i=0; i<gw; i++, q++) TR.vals[q] = .92*TR.vals[q] + .08*(tg[(by+j*s)*TW + bx + i*s] - m);
      }
    }
    const kf = 1 - S.follow/100;
    TR.sx += (TR.x - TR.sx)*kf; TR.sy += (TR.y - TR.sy)*kf;
    TR.path.set(Math.round(t*100), {x:TR.x, y:TR.y, sx:TR.sx, sy:TR.sy});
  }
  function stopTracking(){ TR.anchor = null; TR.started = false; TR.vals = null; TR.path = new Map(); }
  function finishSelection(a, b){
    let x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    if (w*TW < 6 || h*TH < 6){ w = .1; h = .1*(srcW()||16)/(srcH()||9); x0 = a.x - w/2; y0 = a.y - h/2; } // simple toucher
    w = Math.min(w, .6); h = Math.min(h, .6);
    x0 = Math.min(1 - w, Math.max(0, x0)); y0 = Math.min(1 - h, Math.max(0, y0));
    const box = {x:x0, y:y0, w, h};
    if (!sampleFrame() || !haveTg){ setMode('normal'); return; }
    const tpl = makeTemplate(box);
    if (tpl.mad < 2){ emit({type:'note', code:'trackUniform'}); return; }
    const t = curTime();
    TR.anchor = {key: itemKey(), t, box, tpl}; TR.path = new Map(); TR.vals = null;
    TR.started = false; trackInit(t); TR.path.set(Math.round(t*100), {x:TR.x, y:TR.y, sx:TR.sx, sy:TR.sy});
    setMode('normal');
  }

  // ---------- Rendu ----------
  let dirty = true, frame = 0, capTrack = null, redraw = false, lastDims = '';
  const PREVIEW_MAX = Math.min(1920, Math.round(Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1)));
  function resize(){
    const sw = srcW(), sh = srcH(); if (!sw || !sh) return;
    if (crop.on && ASPECTS[crop.aspect] && (sw !== lastSW || sh !== lastSH) && lastSW && !exporting) fitAspect(true);
    lastSW = sw; lastSH = sh;
    const [ow, oh] = outDims(sw, sh);
    // L'aperçu n'a pas besoin de la pleine résolution : moins de pixels, moins de chaleur et de batterie.
    const k = exporting ? 1 : Math.min(1, PREVIEW_MAX / Math.max(ow, oh));
    const w = Math.max(2, Math.round(ow*k)), h = Math.max(2, Math.round(oh*k));
    if (view.width !== w || view.height !== h){ view.width = w; view.height = h; gl.viewport(0,0,w,h); }
    const dims = ow + 'x' + oh;
    if (dims !== lastDims){ lastDims = dims; emit({type:'dims', w:ow, h:oh}); }
  }
  function sampleFrame(){
    resize(); if (!srcW()) return false;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source()); } catch(e){ return false; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, MW, MH);
    gl.useProgram(dprog); gl.enableVertexAttribArray(dLoc); gl.vertexAttribPointer(dLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(dPx, 1/MW, 1/MH); setAffine(dAx, dAy);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.readPixels(0, 0, MW, MH, gl.RGBA, gl.UNSIGNED_BYTE, pix);
    if (needTrackBuf()){
      gl.bindFramebuffer(gl.FRAMEBUFFER, tfbo); gl.viewport(0, 0, TW, TH);
      gl.uniform2f(dPx, 1/TW, 1/TH);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.readPixels(0, 0, TW, TH, gl.RGBA, gl.UNSIGNED_BYTE, tpix);
      for (let y=0; y<TH; y++){ const s = (TH-1-y)*TW*4, o = y*TW;
        for (let x=0; x<TW; x++){ const j = s + x*4; tg[o+x] = tpix[j]*0.3 + tpix[j+1]*0.59 + tpix[j+2]*0.11; } }
      haveTg = true;
    } else haveTg = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, view.width, view.height);
    gl.useProgram(prog); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    havePix = true; return true;
  }
  function processFrame(playing, t){
    if (!sampleFrame()) return;
    const tgt = analyze(); if (tgt) blend(tgt, (playing && !dirty) ? 1 - S.smooth/100 : 1);
    dirty = false;
    if (S.stab) stabStep();
    trackStep(t === undefined ? curTime() : t);
    render();
  }
  function render(){
    if (!havePix) return;
    redraw = false;
    resize();
    const W = viewWindow();
    gl.uniform4f(U.win, W.x, W.y, W.w, W.h); setAffine(U.ax, U.ay);
    gl.uniform3fv(U.lo, P.lo); gl.uniform3fv(U.sc, P.sc); gl.uniform3fv(U.mn, P.mn);
    gl.uniform1f(U.al, P.al); gl.uniform1f(U.be, P.be);
    gl.uniform1f(U.st, S.strength/100); gl.uniform1f(U.sa, S.sat/100); gl.uniform1f(U.ga, 100/S.bright);
    gl.uniform1f(U.sp, (exporting || UIM !== 'normal' || !S.compare) ? 0 : S.split);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (capTrack) capTrack.requestFrame();
  }

  // ---------- Histogramme (uniquement si le panneau est ouvert) ----------
  const HB = 64, hO = [0,1,2].map(() => new Float32Array(HB)), hC = [0,1,2].map(() => new Float32Array(HB));
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  function computeHist(){
    for (let c=0; c<3; c++){ hO[c].fill(0); hC[c].fill(0); }
    const d = pix, n = d.length/4, st = S.strength/100, sa = S.sat/100, ga = 100/S.bright;
    let lo = 0, hi = 0;
    for (let i=0; i<d.length; i+=4){
      const r = d[i]/255, g = d[i+1]/255, b = d[i+2]/255;
      hO[0][Math.min(HB-1, r*HB|0)]++; hO[1][Math.min(HB-1, g*HB|0)]++; hO[2][Math.min(HB-1, b*HB|0)]++;
      const rr = r + P.al*(P.mn[1]-P.mn[0])*(1-r)*g, bb = b + P.be*(P.mn[1]-P.mn[2])*(1-b)*g;
      let x0 = Math.pow(clamp01((rr-P.lo[0])*P.sc[0]), ga), x1 = Math.pow(clamp01((g-P.lo[1])*P.sc[1]), ga), x2 = Math.pow(clamp01((bb-P.lo[2])*P.sc[2]), ga);
      const l = 0.2126*x0 + 0.7152*x1 + 0.0722*x2;
      x0 = clamp01(l + (x0-l)*sa); x1 = clamp01(l + (x1-l)*sa); x2 = clamp01(l + (x2-l)*sa);
      x0 = r + (x0-r)*st; x1 = g + (x1-g)*st; x2 = b + (x2-b)*st;
      hC[0][Math.min(HB-1, x0*HB|0)]++; hC[1][Math.min(HB-1, x1*HB|0)]++; hC[2][Math.min(HB-1, x2*HB|0)]++;
      if (x0 < .004 && x1 < .004 && x2 < .004) lo++;
      if (x0 > .996 || x1 > .996 || x2 > .996) hi++;
    }
    return {o: hO.map(a => Array.from(a)), c: hC.map(a => Array.from(a)), lo: lo/n, hi: hi/n};
  }

  // ---------- État périodique vers Flutter ----------
  function trackState(){
    if (!TR.anchor) return {s:'idle'};
    if (!trackMine()) return {s:'other'};
    const a = TR.anchor.box, base = {at: TR.anchor.t, w: a.w, h: a.h};
    if (!TR.started) return {...base, s:'pending', x: a.x + a.w/2, y: a.y + a.h/2};
    return {...base, s: TR.lost > 2 ? 'lost' : 'ok', x: TR.x, y: TR.y};
  }
  function tick(withHist){
    if (trackMine() && crop.on && UIM === 'edit'){ // le cadre suit le sujet : seule sa taille reste réglable
      const a = TR.anchor.box, cx = TR.started ? TR.sx : a.x + a.w/2, cy = TR.started ? TR.sy : a.y + a.h/2;
      crop.x = Math.min(1 - crop.w, Math.max(0, cx - crop.w/2)); crop.y = Math.min(1 - crop.h, Math.max(0, cy - crop.h/2));
      emitCrop();
    }
    const redBoost = 1 + P.al*Math.max(0,P.mn[1]-P.mn[0])*(1-P.mn[0])*P.mn[1]/Math.max(.02,P.mn[0]);
    const m = {type:'tick', t:curTime(), d:duration(), playing:isPlaying(),
      gains:[P.sc[0]*redBoost, P.sc[1], P.sc[2]],
      shift:S.stab ? [Math.round(ST.ox*srcW()), Math.round(ST.oy*srcH())] : null,
      src:[srcW(), srcH()], tr:trackState()};
    if (withHist && S.wantHist && havePix) m.hist = computeHist();
    emit(m);
  }

  let lastVF = 0, needSample = true, lastCT = -1, pendingSeek = null;
  const hasRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  function onVF(now, meta){
    if (!useDemo && !fastRunning && video.videoWidth){ lastVF = performance.now(); needSample = false; lastCT = video.currentTime; processFrame(!video.paused, meta && meta.mediaTime); }
    video.requestVideoFrameCallback(onVF);
  }
  if (hasRVFC) video.requestVideoFrameCallback(onVF);
  function loop(ts){
    const dt = lastTs ? Math.min(0.1,(ts-lastTs)/1000) : 0; lastTs = ts;
    if (fastRunning){ /* la conversion rapide pilote l'affichage */ }
    else if (useDemo){
      if (demoPlaying) demoT = (demoT + dt) % demoLen;
      if (demoPlaying || needSample || dirty || !haveP){ drawDemo(demoT); needSample = false; processFrame(demoPlaying, demoT); }
      else if (redraw) render();
    } else if (video.videoWidth){
      const ct = video.currentTime, rvfcAlive = performance.now() - lastVF < 300;
      if (needSample || (!rvfcAlive && isPlaying() && ct !== lastCT)){ needSample = false; lastCT = ct; processFrame(isPlaying(), ct); }
      else if (dirty){ const tgt = analyze(); if (tgt) blend(tgt, 1); dirty = false; render(); }
      else if (redraw) render();
    }
    if (frame % 6 === 0) tick(frame % 18 === 0);
    frame++; requestAnimationFrame(loop);
  }

  // ---------- Sources : fichiers servis par le serveur local (lecture par plages) ----------
  class RemoteFile {
    constructor(url, size){ this.url = url; this.size = size; }
    slice(a, b){
      const url = this.url, end = Math.min(b, this.size);
      return {arrayBuffer: async () => {
        const r = await fetch(url, {headers: {Range: `bytes=${a}-${end-1}`}});
        if (!r.ok) throw new Error('Lecture du fichier impossible (' + r.status + ')');
        return r.arrayBuffer();
      }};
    }
  }
  // Écriture séquentielle et positionnée de la sortie sur le disque, via le serveur local.
  class Sink {
    constructor(id){ this.base = '../out/' + encodeURIComponent(id); this.chain = fetch(this.base + '?truncate=1', {method:'POST'}); this.pending = 0; this.bytes = 0; this.error = null; this.waiters = []; }
    write(data, pos){
      const copy = data.slice(), len = copy.byteLength;
      this.pending += len; this.bytes = Math.max(this.bytes, pos + len);
      this.chain = this.chain.then(async () => {
        if (this.error) return;
        const r = await fetch(this.base + '?pos=' + pos, {method:'POST', body:copy});
        if (!r.ok) throw new Error('Écriture impossible (' + r.status + ') : espace disque insuffisant ?');
      }).catch(e => { this.error = e; }).finally(() => {
        this.pending -= len;
        if (this.pending < (24 << 20)) this.waiters.splice(0).forEach(w => w());
      });
    }
    async room(){ if (this.pending >= (48 << 20)) await new Promise(r => this.waiters.push(r)); if (this.error) throw this.error; }
    async close(){ await this.chain; if (this.error) throw this.error; }
  }

  let probeChain = Promise.resolve();
  function probe(it){
    probeChain = probeChain.then(() => new Promise(res => {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.playsInline = true;
      let done = false, dur = 0;
      const end = (extra) => {
        if (done) return; done = true; clearTimeout(to);
        v.onerror = v.onseeked = v.onloadedmetadata = null; v.removeAttribute('src'); v.load();
        emit({type:'probe', id:it.id, dur, ...extra}); res();
      };
      const to = setTimeout(() => end({}), 8000);
      v.onloadedmetadata = () => { dur = isFinite(v.duration) ? v.duration : 0; v.currentTime = Math.max(0.1, Math.min(1, dur/3)); };
      v.onseeked = () => {
        let thumb;
        try {
          const ar = (v.videoWidth / v.videoHeight) || 16/9, c = document.createElement('canvas');
          c.width = ar >= 1 ? 192 : Math.round(192*ar); c.height = ar >= 1 ? Math.round(192/ar) : 192;
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          thumb = c.toDataURL('image/jpeg', .7).split(',')[1];
        } catch(e){}
        end({thumb, w:v.videoWidth, h:v.videoHeight});
      };
      v.onerror = () => end({err:'format'});
      v.src = it.url;
    }));
  }
  function loadItem(it){
    return new Promise((res, rej) => {
      current = it;
      video.onloadeddata = () => { video.onloadeddata = null; video.onerror = null; useDemo = false;
        // Pendant une conversion rapide, ce chargement tardif ne doit pas perturber la vidéo en cours.
        if (!fastRunning){ haveP = false; dirty = true; needSample = true; stabReset(); }
        emit({type:'loaded', id:it.id, d:video.duration || 0}); res(); };
      video.onerror = () => { video.onerror = null; emit({type:'loadError', id:it.id}); rej(new Error('Lecture impossible : format non pris en charge par cet appareil (essayez MP4 H.264)')); };
      video.src = it.url; video.load();
    });
  }
  function showDemo(){
    current = null; video.onerror = null; video.onloadeddata = null; video.pause(); video.removeAttribute('src'); video.load();
    useDemo = true; haveP = false; dirty = true; stabReset();
  }

  function setMode(m){ UIM = m; redraw = true; needSample = true; emit({type:'mode', mode:m}); }
  function setAspect(a){
    crop.aspect = a; crop.on = a !== 'none';
    if (crop.on){ fitAspect(false); setMode('edit'); }
    else { if (TR.anchor) stopTracking(); emitCrop(); setMode('normal'); }
  }
  function setOrient(ch){
    Object.assign(orient, ch);
    stabReset();
    if (TR.anchor){ stopTracking(); emit({type:'note', code:'trackOrient'}); }
    needSample = true; dirty = true; redraw = true;
  }
  function pickSubject(){
    if (UIM === 'select') return setMode('normal');
    if (!crop.on){ crop.aspect = 'free'; crop.on = true; crop.w = crop.h = .6; crop.x = crop.y = .2; emitCrop(); }
    if (useDemo) demoPlaying = false; else video.pause();
    setMode('select');
  }
  function togglePlay(){
    if (exporting) return;
    if (useDemo) demoPlaying = !demoPlaying;
    else if (video.paused || video.ended) video.play().catch(e => emit({type:'log', msg:String(e)})); else video.pause();
  }
  function seek(t){
    if (useDemo){ demoT = t; dirty = true; needSample = true; stabReset(); return; }
    // Un seul déplacement à la fois : sur mobile, empiler les seeks fige l'aperçu.
    if (video.seeking){ pendingSeek = t; return; }
    video.currentTime = t; dirty = true; stabReset();
  }
  video.addEventListener('seeked', () => {
    dirty = true; needSample = true; stabReset();
    if (pendingSeek !== null){ const t = pendingSeek; pendingSeek = null; seek(t); }
  });

  // ---------- Export en temps réel (repli) ----------
  let audioCtx = null, audioDest = null, monitorGain = null, stopFn = null;
  function pickMime(){
    const c = ['video/mp4;codecs=avc1.640028,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
    return c.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  }
  async function record(sink, onProg){
    if (!window.MediaRecorder || !view.captureStream) throw new Error('L\'export en temps réel n\'est pas pris en charge sur cet appareil.');
    const manual = typeof CanvasCaptureMediaStreamTrack !== 'undefined' && 'requestFrame' in CanvasCaptureMediaStreamTrack.prototype;
    const stream = view.captureStream(manual ? 0 : 30);
    try {
      if (!audioCtx){ audioCtx = new (window.AudioContext||window.webkitAudioContext)();
        const srcNode = audioCtx.createMediaElementSource(video); audioDest = audioCtx.createMediaStreamDestination();
        monitorGain = audioCtx.createGain();
        srcNode.connect(audioDest); srcNode.connect(monitorGain); monitorGain.connect(audioCtx.destination); }
      await audioCtx.resume();
      monitorGain.gain.value = S.listen ? 1 : 0;
      audioDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    } catch(e){ /* pas de piste son exploitable : export muet */ }
    const mime = pickMime();
    const bitrate = Math.min(40e6, Math.max(6e6, srcW()*srcH()*30*0.12));
    let rec;
    try { rec = new MediaRecorder(stream, mime ? {mimeType:mime, videoBitsPerSecond:bitrate} : {videoBitsPerSecond:bitrate}); }
    catch(e){ stream.getVideoTracks().forEach(t => t.stop()); throw new Error('Impossible de démarrer l\'enregistrement : ' + e.message); }
    let pos = 0, writes = Promise.resolve();
    rec.ondataavailable = e => { if (!e.data.size) return;
      writes = writes.then(async () => { const b = new Uint8Array(await e.data.arrayBuffer()); sink.write(b, pos); pos += b.length; }); };
    const done = new Promise(r => rec.onstop = r);
    const total = duration();
    const timer = setInterval(() => onProg(total ? Math.min(1, curTime()/total) : 0, 0), 250);
    let outcome = 'ok', muted = false;
    try {
      video.pause(); video.loop = false;
      await new Promise(r => { video.addEventListener('seeked', r, {once:true}); setTimeout(r, 2000); video.currentTime = 0; });
      stabReset(); rec.start(500);
      if (manual){ capTrack = stream.getVideoTracks()[0]; render(); }
      outcome = await new Promise(r => {
        stopFn = () => r('stop');
        video.addEventListener('ended', () => r('ok'), {once:true});
        video.play().catch(async () => {
          video.muted = true; muted = true;
          try { await video.play(); } catch(e){ r('fail'); }
        });
      });
    } finally {
      stopFn = null; capTrack = null; clearInterval(timer);
      video.pause(); video.muted = false;
      if (rec.state !== 'inactive'){ rec.stop(); await done; }
      await writes;
      stream.getVideoTracks().forEach(t => t.stop());
      if (monitorGain) monitorGain.gain.value = 1;
    }
    if (outcome === 'stop') return null;
    if (outcome === 'fail') throw new Error('Lecture de la vidéo refusée par le système.');
    onProg(1, 0);
    const type = rec.mimeType || mime || 'video/webm';
    return {ext: type.includes('mp4') ? 'mp4' : 'webm', muted};
  }

  // ---------- Conversion rapide (WebCodecs) ----------
  class Unsupported extends Error {}
  const canFast = () => S.fast && 'VideoDecoder' in window && 'VideoEncoder' in window && window.MP4Box && window.Mp4Muxer;
  async function topBoxes(file){
    const out = []; let o = 0;
    while (o + 8 <= file.size){
      const dv = new DataView(await file.slice(o, o + 16).arrayBuffer());
      let size = dv.getUint32(0);
      const type = String.fromCharCode(dv.getUint8(4), dv.getUint8(5), dv.getUint8(6), dv.getUint8(7));
      if (size === 1) size = Number(dv.getBigUint64(8)); else if (size === 0) size = file.size - o;
      if (size < 8) break;
      out.push({type, o, size}); o += size;
    }
    return out;
  }
  function videoDesc(trak){
    for (const e of trak.mdia.minf.stbl.stsd.entries){
      const box = e.avcC || e.hvcC;
      if (box){ const s = new DataStream(undefined, 0, DataStream.BIG_ENDIAN); box.write(s); return new Uint8Array(s.buffer, 8); }
    }
  }
  function aacDesc(trak){ try { return trak.mdia.minf.stbl.stsd.entries[0].esds.esd.descs[0].descs[0].data; } catch(e){ return null; } }
  function rotationOf(m){
    if (!m) return 0; const a = m[0], b = m[1];
    if (a === 0 && b > 0) return 90; if (a < 0 && b === 0) return 180; if (a === 0 && b < 0) return 270; return 0;
  }
  const chan = new MessageChannel(), waiters = [];
  chan.port1.onmessage = () => { const r = waiters.shift(); if (r) r(); };
  const tick0 = () => new Promise(r => { waiters.push(r); chan.port2.postMessage(0); });

  async function fastExport(it, file, sink, onProg){
    const boxes = await topBoxes(file);
    if (!boxes.some(b => b.type === 'moov') || boxes.some(b => b.type === 'moof')) throw new Unsupported('structure de fichier non prise en charge');
    const mp4 = MP4Box.createFile();
    let info = null, parseErr = null;
    mp4.onReady = i => info = i; mp4.onError = e => parseErr = e;
    const append = async (o, end) => { const ab = await file.slice(o, end).arrayBuffer(); ab.fileStart = o; mp4.appendBuffer(ab); };
    for (const b of boxes) await append(b.o, b.type === 'mdat' ? b.o + Math.min(16, b.size) : b.o + b.size);
    if (!info) throw new Unsupported('en-tête illisible' + (parseErr ? ' : ' + parseErr : ''));
    const vt = info.videoTracks[0], at = info.audioTracks[0];
    if (!vt) throw new Unsupported('pas de piste vidéo');
    const SW = vt.video.width, SH = vt.video.height;
    // Vidéo filmée en portrait : la rotation du conteneur est appliquée aux pixels, pour que recadrage,
    // stabilisation et suivi (définis sur l'image vue dans l'aperçu) s'appliquent aux bonnes coordonnées.
    const contRot = rotationOf(vt.matrix);
    const turned = (orient.rot + contRot) % 180 !== 0;
    const [W, H] = turned ? outDims(SH, SW) : outDims(SW, SH);
    const fps = vt.nb_samples * vt.timescale / vt.duration;
    const decCfg = {codec: vt.codec, codedWidth: SW, codedHeight: SH};
    const desc = videoDesc(mp4.getTrackById(vt.id)); if (desc) decCfg.description = desc;
    if (!(await VideoDecoder.isConfigSupported(decCfg).catch(() => ({}))).supported) throw new Unsupported('décodage ' + vt.codec + ' non pris en charge');
    let aDesc = null;
    if (at){ aDesc = aacDesc(mp4.getTrackById(at.id)); if (!/^mp4a\.40/.test(at.codec) || !aDesc) throw new Unsupported('son ' + at.codec + ' non recopiable'); }
    const bitrate = Math.round(Math.min(60e6, Math.max(8e6, W*H*fps*0.1)));
    let encCfg = null;
    for (const codec of ['avc1.640034','avc1.640033','avc1.64002a','avc1.640028','avc1.4d0034','avc1.42e034','vp09.00.51.08','vp09.00.41.08','vp09.00.10.08']){
      const c = {codec, width: W, height: H, bitrate, framerate: fps};
      if (codec.startsWith('avc')) c.avc = {format: 'avc'};
      try { if ((await VideoEncoder.isConfigSupported(c)).supported){ encCfg = c; break; } } catch(e){}
    }
    if (!encCfg) throw new Unsupported('aucun encodeur vidéo disponible');

    const target = new Mp4Muxer.StreamTarget({onData: (data, pos) => sink.write(data, pos), chunked: true, chunkSize: 4 << 20});
    const muxer = new Mp4Muxer.Muxer({target, fastStart: false, firstTimestampBehavior: 'cross-track-offset',
      video: Object.assign({codec: encCfg.codec.startsWith('avc') ? 'avc' : 'vp9', width: W, height: H},
        Number.isInteger(vt.timescale) && vt.timescale > 0 && vt.timescale < 2**31 ? {frameRate: vt.timescale} : {}),
      audio: at ? {codec: 'aac', numberOfChannels: at.audio.channel_count, sampleRate: at.audio.sample_rate} : undefined});
    let failErr = null;
    const frames = [];
    const dec = new VideoDecoder({output: f => frames.push(f), error: e => failErr = e});
    const enc = new VideoEncoder({output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: e => failErr = e});
    dec.configure(decCfg); enc.configure(encCfg);

    const vs = []; let aFirst = true;
    const aMeta = at && {decoderConfig: {codec: at.codec, sampleRate: at.audio.sample_rate, numberOfChannels: at.audio.channel_count, description: aDesc}};
    mp4.onSamples = (id, _, samples) => {
      if (id === vt.id){ for (const s of samples) vs.push(s); return; }
      for (const s of samples){ muxer.addAudioChunkRaw(s.data, 'key', s.cts*1e6/s.timescale, s.duration*1e6/s.timescale, aFirst ? aMeta : undefined); aFirst = false; }
      mp4.releaseUsedSamples(id, samples[samples.length-1].number + 1);
    };
    mp4.setExtractionOptions(vt.id, null, {nbSamples: 60});
    if (at) mp4.setExtractionOptions(at.id, null, {nbSamples: 200});
    mp4.start();

    const mdats = boxes.filter(b => b.type === 'mdat'); let mi = 0, mo = mdats.length ? mdats[0].o : 0;
    async function feed(){
      while (mi < mdats.length && mo >= mdats[mi].o + mdats[mi].size){ mi++; if (mi < mdats.length) mo = mdats[mi].o; }
      if (mi >= mdats.length) return false;
      const end = Math.min(mo + (8 << 20), mdats[mi].o + mdats[mi].size);
      await append(mo, end); mo = end; return true;
    }

    const total = vt.nb_samples, keyInt = Math.max(1, Math.round(fps*2)), t0 = performance.now();
    let vi = 0, n = 0, eof = false, flushed = false, stop = false, ts0 = null;
    stopFn = () => { stop = true; };
    baseRot = contRot; lastSW = 0;
    fastRunning = true; haveP = false; dirty = false; stabReset(); video.pause();
    try {
      while (true){
        if (failErr) throw failErr;
        if (stop) return null;
        while (dec.decodeQueueSize < 6 && frames.length < 4){
          if (vi < vs.length){
            const s = vs[vi]; vs[vi++] = null;
            dec.decode(new EncodedVideoChunk({type: s.is_sync ? 'key' : 'delta', timestamp: Math.round(s.cts*1e6/s.timescale), duration: Math.round(s.duration*1e6/s.timescale), data: s.data}));
            if (vi % 30 === 0) mp4.releaseUsedSamples(vt.id, s.number + 1);
            continue;
          }
          if (eof) break;
          if (!(await feed())){ eof = true; mp4.flush(); }
        }
        if (frames.length){
          const f = frames.shift();
          if (ts0 === null) ts0 = f.timestamp;
          fastFrame = f; processFrame(true, (f.timestamp - ts0)/1e6);
          const vf = new VideoFrame(view, {timestamp: f.timestamp, duration: f.duration || Math.round(1e6/fps)});
          enc.encode(vf, {keyFrame: n % keyInt === 0}); vf.close(); f.close(); fastFrame = null; n++;
          if (n % 4 === 0) onProg(Math.min(1, n/total), (n/fps) / Math.max(0.001, (performance.now() - t0)/1000));
          while (enc.encodeQueueSize > 4 && !failErr) await tick0();
          await sink.room();
          if (n % 20 === 0) await tick0();
          continue;
        }
        if (eof && vi >= vs.length){
          if (!flushed){ flushed = true; await dec.flush(); continue; }
          break;
        }
        await tick0();
      }
      await enc.flush();
      if (failErr) throw failErr;
      muxer.finalize();
    } finally {
      stopFn = null; fastRunning = false; fastFrame = null; baseRot = 0; lastSW = 0;
      frames.forEach(f => f.close());
      try { if (dec.state !== 'closed') dec.close(); } catch(e){}
      try { if (enc.state !== 'closed') enc.close(); } catch(e){}
    }
    return {ext: 'mp4', muted: false};
  }

  async function exportItem(it){
    if (exporting) return;
    if (UIM !== 'normal') setMode('normal');
    exporting = true;
    const t0 = performance.now(), file = new RemoteFile(it.url, it.size);
    let mode = 'fast', why = '', out, sink;
    const prog = (p, speed) => emit({type:'exportProgress', id:it.id, p, speed, mode});
    try {
      if (canFast() && /\.(mp4|m4v|mov)$/i.test(it.name)){
        current = it;
        try {
          sink = new Sink(it.id);
          out = await fastExport(it, file, sink, prog);
          if (out === null){ await sink.chain; loadItem(it).catch(() => {}); emit({type:'exportStopped', id:it.id}); return; }
          loadItem(it).catch(() => {});
        } catch(e){
          console.warn('Conversion rapide impossible, passage en temps réel :', e);
          why = String(e.message || e).slice(0, 80); out = undefined;
          if (sink) await sink.chain;
        }
      } else why = canFast() ? 'format non MP4/MOV' : 'conversion rapide indisponible';
      if (out === undefined){
        mode = 'rt';
        await loadItem(it);
        sink = new Sink(it.id);
        out = await record(sink, prog);
        if (!out){ await sink.chain; emit({type:'exportStopped', id:it.id}); return; }
      }
      await sink.close();
      emit({type:'exportDone', id:it.id, ext:out.ext, muted:out.muted, mode, why, bytes:sink.bytes, time:(performance.now()-t0)/1000});
    } catch(e){
      emit({type:'exportError', id:it.id, msg:String(e.message || e)});
    } finally { exporting = false; needSample = true; dirty = true; }
  }

  // ---------- Commandes ----------
  window.Engine = {cmd(m){
    switch (m.c){
      case 'settings': {
        const stabChanged = m.v.stab !== undefined && m.v.stab !== S.stab;
        Object.assign(S, m.v); dirty = true; redraw = true;
        if (stabChanged) stabReset();
        break;
      }
      case 'play': if (!exporting){ if (useDemo) demoPlaying = true; else video.play().catch(() => {}); } break;
      case 'pause': if (!exporting){ if (useDemo) demoPlaying = false; else video.pause(); } break;
      case 'toggle': togglePlay(); break;
      case 'seek': if (!exporting) seek(m.t); break;
      case 'probe': probe(m.item); break;
      case 'load': if (!exporting) loadItem(m.item).catch(() => {}); break;
      case 'demo': if (!exporting) showDemo(); break;
      case 'aspect': if (!exporting) setAspect(m.a); break;
      case 'crop': Object.assign(crop, m.v); redraw = true; break;
      case 'mode': if (!exporting) setMode(m.mode); break;
      case 'orient': if (!exporting) setOrient(m.v); break;
      case 'pickSubject': if (!exporting) pickSubject(); break;
      case 'select': finishSelection(m.a, m.b); break;
      case 'stopTrack': stopTracking(); redraw = true; break;
      case 'export': exportItem(m.item); break;
      case 'stop': if (stopFn) stopFn(); break;
    }
  }};
  requestAnimationFrame(loop);
  emit({type:'ready'});
})();
