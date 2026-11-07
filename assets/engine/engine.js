// Moteur vidéo de Scuba See Red, sans interface : toute l'UI est en Flutter.
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
  // Lampe : un pixel bien plus rouge que l'eau alentour reçoit une vraie lumière blanche. La correction pensée pour
  // l'eau le saturerait, il garde donc ses couleurs. am = rapport rouge/(vert ou bleu) de l'eau. Même calcul : lampWeight.
  const LAMP_FROM = .2, LAMP_SPAN = .35, LAMP_DARK = .08, LAMP_DARK_SPAN = .12, LAMP_PUNCH = .6, LAMP_MAX_GAIN = 1.25, LAMP_MIN_PIXELS = 30;
  const FS = PREC + `
  varying vec2 v; uniform sampler2D t;
  uniform vec3 lo, sc, mn; uniform float al, be, st, sa, ga, sp, am, lp, ll, ls; uniform vec4 win; uniform vec3 ax, ay;
  void main(){
    vec2 p = win.xy + vec2(v.x, 1.0 - v.y)*win.zw;
    vec3 c = texture2D(t, vec2(dot(ax.xy, p) + ax.z, dot(ay.xy, p) + ay.z)).rgb;
    vec3 c0 = c;
    float r = c.r + al*(mn.g-mn.r)*(1.0-c.r)*c.g;
    float b = c.b + be*(mn.g-mn.b)*(1.0-c.b)*c.g;
    vec3 x = clamp((vec3(r,c.g,b)-lo)*sc, 0.0, 1.0);
    float e = max(c.g, c.b);
    float w = lp*smoothstep(am + ${LAMP_FROM}, am + ${LAMP_FROM + LAMP_SPAN}, c.r/max(e, 0.02))
      *smoothstep(${LAMP_DARK}, ${LAMP_DARK + LAMP_DARK_SPAN}, max(c.r, e));
    // La zone éclairée a son propre contraste, le même sur les trois couleurs : du relief, sans dominante.
    vec3 lit = clamp((c-ll)*ls, 0.0, 1.0);
    float lm = dot(lit, vec3(0.2126,0.7152,0.0722));
    lit = clamp(lit*mix(lm, smoothstep(0.0, 1.0, lm), ${LAMP_PUNCH})/max(lm, 0.02), 0.0, 1.0);
    x = mix(x, lit, w);
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
  const U = {}; ['lo','sc','mn','al','be','st','sa','ga','sp','am','lp','ll','ls','win','ax','ay'].forEach(n => U[n] = gl.getUniformLocation(prog, n));
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
  // Fenêtre carrée pour NanoTrack, prise directement dans l'image source pour garder les détails.
  // Hors de l'image : couleur moyenne. Neuf échantillons par pixel, car la fenêtre est souvent réduite.
  const NFS = PREC + `varying vec2 v; uniform sampler2D t; uniform vec2 px; uniform vec4 win; uniform vec3 ax, ay, pad;
  void main(){ vec3 s = vec3(0.0);
    for (int i=0;i<3;i++) for (int j=0;j<3;j++){
      vec2 q = v + px*((vec2(float(i),float(j))+0.5)/3.0 - 0.5), p = win.xy + vec2(q.x, 1.0 - q.y)*win.zw;
      if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) s += pad;
      else s += texture2D(t, vec2(dot(ax.xy, p) + ax.z, dot(ay.xy, p) + ay.z)).rgb; }
    gl_FragColor = vec4(s/9.0, 1.0); }`;
  const nprog = gl.createProgram();
  gl.attachShader(nprog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(nprog, sh(gl.FRAGMENT_SHADER, NFS)); gl.linkProgram(nprog);
  const nLoc = gl.getAttribLocation(nprog, 'p'), nU = {};
  ['px','win','ax','ay','pad'].forEach(n => nU[n] = gl.getUniformLocation(nprog, n));
  const NZ = 127, NX = 255, nzfbo = makeTarget(NZ, NZ), nxfbo = makeTarget(NX, NX);
  const TMN = 512, tmfbo = makeTarget(TMN, TMN), tmTex = gl.createTexture(); // entrée d'EdgeTAM et image de son lecteur
  gl.bindTexture(gl.TEXTURE_2D, tmTex);
  [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
  [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR));
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const pix = new Uint8Array(MW*MH*4); let havePix = false;

  // ---------- Réglages (la valeur de référence est côté Flutter) ----------
  const S = {strength:100, red:100, clip:8, sat:115, bright:105, smooth:90, lamp:100, sforce:92, scrop:10, follow:88,
    nano:true, tam:true, stab:true, compare:true, split:.5, fast:true, listen:false, wantHist:false};

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
  let still = null, snapping = false; // photo source (toile, orientation EXIF déjà appliquée) et capture en cours
  const stabOn = () => S.stab && !still && !snapping; // une image seule n'a rien à stabiliser
  const source = () => fastFrame || still || (useDemo ? demo : video);
  const rawW = () => fastFrame ? fastFrame.displayWidth : still ? still.width : useDemo ? demo.width : video.videoWidth;
  const rawH = () => fastFrame ? fastFrame.displayHeight : still ? still.height : useDemo ? demo.height : video.videoHeight;
  const srcW = () => effRot() % 180 ? rawH() : rawW();
  const srcH = () => effRot() % 180 ? rawW() : rawH();
  const isPlaying = () => still ? false : useDemo ? demoPlaying : !video.paused && !video.ended;
  const curTime = () => still ? 0 : useDemo ? demoT : video.currentTime;
  const duration = () => still ? 0 : useDemo ? demoLen : (video.duration || 0);

  // ---------- Analyse des couleurs ----------
  const NO_AMBIENT = 9;
  const P = {lo:[0,0,0], sc:[1,1,1], mn:[.5,.5,.5], al:0, be:0, am:NO_AMBIENT, lp:1, ll:0, ls:1}; let haveP = false;
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const smooth01 = t => { t = clamp01(t); return t*t*(3-2*t); };
  // Part de lumière de lampe dans un pixel (0 à 1) : même calcul que le shader.
  const lampWeight = (r, g, b, am) => { const e = Math.max(g, b);
    return smooth01((r/Math.max(e, .02) - am - LAMP_FROM)/LAMP_SPAN)*smooth01((Math.max(r, e) - LAMP_DARK)/LAMP_DARK_SPAN); };
  // Couleur d'un pixel éclairé : même calcul que le shader.
  function litColor(r, g, b){
    const ch = [r, g, b].map(v => clamp01((v - P.ll)*P.ls));
    const l = 0.2126*ch[0] + 0.7152*ch[1] + 0.0722*ch[2];
    const k = (l + (smooth01(l) - l)*LAMP_PUNCH)/Math.max(l, .02);
    return ch.map(v => clamp01(v*k));
  }
  // Rapport rouge/(vert ou bleu) de l'eau : 30e centile, pour rester sur l'eau même si la lampe éclaire une grande partie
  // de l'image. Sans assez de pixels visibles, rien n'est considéré comme éclairé.
  function ambientRatio(d, n){
    const h = new Uint32Array(128); let seen = 0;
    for (let i=0;i<d.length;i+=4){ const e = Math.max(d[i+1], d[i+2]);
      if (Math.max(d[i], e) < LAMP_DARK*255) continue;
      h[Math.min(127, d[i]/Math.max(e, 5)*64|0)]++; seen++; }
    if (seen < n*.05) return NO_AMBIENT;
    let acc = 0; for (let i=0;i<128;i++){ acc += h[i]; if (acc >= seen*.3) return (i+.5)/64; }
    return NO_AMBIENT;
  }
  function analyze(){
    if (!havePix) return null;
    const d = pix, n = d.length/4, lp = S.lamp/100, am = lp > 0 ? ambientRatio(d, n) : NO_AMBIENT;
    let mR=0, mG=0, mB=0;
    for (let i=0;i<d.length;i+=4){ mR+=d[i]; mG+=d[i+1]; mB+=d[i+2]; }
    mR/=n*255; mG/=n*255; mB/=n*255;
    const al = S.red/100, be = mG > mB ? al*0.5 : 0;
    // Les pixels éclairés restent dans les statistiques : ce sont eux qui limitent le gain du rouge sur le reste de l'image.
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
    // Niveaux de la zone éclairée. Le gain reste limité : une surface unie ne doit ni s'assombrir ni tourner au gris.
    const hLo = new Uint32Array(256), hHi = new Uint32Array(256); let nLit = 0;
    if (lp > 0) for (let i=0;i<d.length;i+=4){
      if (lampWeight(d[i]/255, d[i+1]/255, d[i+2]/255, am) < .5) continue;
      hLo[Math.min(d[i], d[i+1], d[i+2])]++; hHi[Math.max(d[i], d[i+1], d[i+2])]++; nLit++;
    }
    let ll = 0, ls = 1;
    if (nLit >= LAMP_MIN_PIXELS){
      let acc = 0, a = 0, b = 255;
      for (let i=0;i<256;i++){ acc+=hLo[i]; if (acc>nLit*clip){ a=i; break; } }
      acc = 0; for (let i=0;i<256;i++){ acc+=hHi[i]; if (acc>=nLit*(1-clip)){ b=i; break; } }
      ll = Math.min(.08, a/255); ls = Math.min(LAMP_MAX_GAIN, 1/(Math.max(.8, b/255) - ll));
    }
    return {lo: ch.map(c=>c[0]), sc: ch.map(c=>Math.min(5, 1/(c[1]-c[0]))), mn:[mR,mG,mB], al, be, am, lp, ll, ls};
  }
  function blend(tgt, k){
    if (!haveP){ k = 1; haveP = true; }
    for (let i=0;i<3;i++){ P.lo[i]+=(tgt.lo[i]-P.lo[i])*k; P.sc[i]+=(tgt.sc[i]-P.sc[i])*k; P.mn[i]+=(tgt.mn[i]-P.mn[i])*k; }
    P.al = tgt.al; P.be = tgt.be; P.lp = tgt.lp;
    P.am += (tgt.am - P.am)*k; P.ll += (tgt.ll - P.ll)*k; P.ls += (tgt.ls - P.ls)*k;
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
    if (stabOn()){ const z = 1 - S.scrop/100; w *= z; h *= z; cx += ST.ox; cy += ST.oy; }
    cx = Math.min(1 - w/2, Math.max(w/2, cx)); cy = Math.min(1 - h/2, Math.max(h/2, cy));
    return {x: cx - w/2, y: cy - h/2, w, h};
  }

  // ---------- Suivi du sujet ----------
  const tpix = new Uint8Array(TW*TH*4), tg = new Float32Array(TW*TH); let haveTg = false;
  const TR = {anchor:null, started:false, x:.5, y:.5, w:.1, h:.1, vx:0, vy:0, sx:.5, sy:.5, lost:0, conf:1, lastT:-1, vals:null, path:new Map()};
  let current = null;
  const itemKey = () => (fastRunning || !useDemo) ? (current ? current.id : null) : 'demo';
  const trackMine = () => !!TR.anchor && TR.anchor.key === itemKey();

  // NanoTrack (réseau siamois) : le modèle du sujet est calculé une fois à la sélection et ne change
  // plus, donc il ne dérive pas. L'inférence est asynchrone : en lecture, on analyse la dernière image
  // disponible ; à l'export rapide, chaque image attend son résultat. Si le modèle ne peut pas tourner
  // (WASM SIMD absent, par exemple), le suivi par motif ci-dessous prend le relais.
  const NT = {state:'off', load:null, bb:null, head:null, busy:Promise.resolve(), inflight:false, gen:0,
    inZ:new Float32Array(3*NZ*NZ), inX:new Float32Array(3*NX*NX), rgba:new Uint8Array(4*NX*NX), hann:new Float32Array(256)};
  for (let y=0; y<16; y++) for (let x=0; x<16; x++)
    NT.hann[y*16+x] = (.5 - .5*Math.cos(2*Math.PI*x/15)) * (.5 - .5*Math.cos(2*Math.PI*y/15));
  const NANO_LOST = .35, NANO_FOUND = .6; // seuils de confiance : perte, puis reprise (hystérésis)
  const nanoOn = () => !!TR.anchor && !!TR.anchor.nano && NT.state !== 'failed';
  const nanoSize = (w, h) => { const p = .5*(w + h); return Math.sqrt((w + p)*(h + p)); };
  function nanoFail(e){ NT.state = 'failed'; emit({type:'log', msg:'NanoTrack indisponible : ' + e}); }
  // ONNX Runtime tourne dans un worker : une analyse EdgeTAM dure plusieurs secondes et ne doit pas figer l'aperçu.
  const ORT_BASE = new URL('vendor/', location.href).href;
  const ORT_OPT = {executionProviders:['wasm'], graphOptimizationLevel:'all'};
  let ortLoaded = null, ortChain = Promise.resolve();
  function ortLoad(){
    return ortLoaded || (ortLoaded = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'vendor/ort.wasm.min.js';
      s.onload = () => {
        // Plusieurs threads exigent l'isolation cross-origin (en-têtes du serveur local).
        ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
        ort.env.wasm.wasmPaths = ORT_BASE; ort.env.wasm.proxy = true;
        res();
      };
      s.onerror = () => rej(new Error('ONNX Runtime introuvable'));
      document.head.appendChild(s);
    }));
  }
  // Une inférence à la fois. Le worker prend possession des tampons reçus : on lui donne donc des copies.
  function ortRun(session, inputs){
    const own = {};
    for (const k in inputs) own[k] = new ort.Tensor(inputs[k].type, inputs[k].data.slice(), inputs[k].dims);
    const p = ortChain.then(() => session.run(own));
    ortChain = p.catch(() => {});
    return p;
  }
  function nanoLoad(){
    if (NT.load) return NT.load;
    NT.state = 'loading';
    NT.load = (async () => {
      await ortLoad();
      NT.bb = await ort.InferenceSession.create(ORT_BASE + 'nanotrack_backbone.onnx', ORT_OPT);
      NT.head = await ort.InferenceSession.create(ORT_BASE + 'nanotrack_head.onnx', ORT_OPT);
      NT.state = 'ready';
    })().catch(nanoFail);
    return NT.load;
  }
  // Rend la fenêtre (centre et côté en pixels de l'image orientée) et la convertit en RVB 0-255, plans séparés.
  function nanoCrop(cx, cy, side, n, target, out){
    const W = srcW(), H = srcH(), d = NT.rgba;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target); gl.viewport(0, 0, n, n);
    gl.useProgram(nprog); gl.enableVertexAttribArray(nLoc); gl.vertexAttribPointer(nLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(nU.px, 1/n, 1/n); gl.uniform4f(nU.win, (cx - side/2)/W, (cy - side/2)/H, side/W, side/H);
    setAffine(nU.ax, nU.ay); gl.uniform3fv(nU.pad, P.mn);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, d);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, view.width, view.height);
    gl.useProgram(prog); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const nn = n*n;
    for (let y=0; y<n; y++){ const s = (n-1-y)*n*4, o = y*n; // readPixels part du bas de l'image
      for (let x=0; x<n; x++){ const j = s + x*4, i = o + x; out[i] = d[j]; out[nn+i] = d[j+1]; out[2*nn+i] = d[j+2]; } }
    return out;
  }
  function nanoTemplate(a){
    const W = srcW(), H = srcH(), w = a.box.w*W, h = a.box.h*H;
    const data = nanoCrop((a.box.x + a.box.w/2)*W, (a.box.y + a.box.h/2)*H, nanoSize(w, h), NZ, nzfbo, NT.inZ).slice();
    a.nano = {z:null};
    const prev = NT.busy;
    a.nano.ready = NT.busy = (async () => {
      await prev; await nanoLoad();
      if (NT.state !== 'ready') return;
      a.nano.z = (await ortRun(NT.bb, {input: new ort.Tensor('float32', data, [1, 3, NZ, NZ])})).output;
    })().catch(nanoFail);
  }
  // Lance une analyse, sauf s'il y en a déjà une en cours : en lecture, les images intermédiaires sont sautées.
  function nanoPump(){
    const a = TR.anchor;
    if (NT.inflight || !a.nano.z) return;
    const W = srcW(), H = srcH(), w = TR.w*W, h = TR.h*H;
    // Sujet perdu : la fenêtre de recherche grandit jusqu'à le retrouver.
    const grow = TR.lost > 2 ? Math.min(4, Math.pow(1.5, TR.lost - 2)) : 1;
    const c = {x:TR.x*W, y:TR.y*H, w, h, W, H, sx:Math.min(2*Math.max(W, H), 2*nanoSize(w, h)*grow)};
    nanoCrop(c.x, c.y, c.sx, NX, nxfbo, NT.inX);
    const gen = NT.gen; NT.inflight = true;
    const prev = NT.busy;
    NT.busy = (async () => {
      await prev;
      const xf = (await ortRun(NT.bb, {input: new ort.Tensor('float32', NT.inX, [1, 3, NX, NX])})).output;
      const o = await ortRun(NT.head, {input1: a.nano.z, input2: xf});
      if (gen === NT.gen && TR.anchor === a) nanoApply(o.output1.data, o.output2.data, c);
    })().catch(nanoFail).finally(() => { NT.inflight = false; });
  }
  // Décodage de la sortie, d'après TrackerNano (OpenCV) ; la pénalité d'échelle compare bien à la taille du sujet.
  function nanoApply(cls, reg, c){
    const scale = NX/c.sx, ws = c.w*scale, hs = c.h*scale, base = nanoSize(ws, hs), ratio = ws/hs;
    const wi = TR.lost ? 0 : .455, keep = v => Math.max(v, 1/v); // pas de préférence pour le centre après une perte
    let best = -Infinity, bi = 0, bs = 0, bp = 1;
    for (let i=0; i<256; i++){
      const pw = reg[i] + reg[512+i], ph = reg[256+i] + reg[768+i];
      const s = 1/(1 + Math.exp(cls[i] - cls[256+i]));
      const pen = Math.exp(-(keep(ratio/(pw/ph))*keep(nanoSize(pw, ph)/base) - 1)*.055);
      const v = pen*s*(1 - wi) + NT.hann[i]*wi;
      if (v > best){ best = v; bi = i; bs = s; bp = pen; }
    }
    TR.conf = bs;
    if (bs < (TR.lost ? NANO_FOUND : NANO_LOST)){ TR.lost++; return; }
    TR.lost = 0;
    const gx = ((bi & 15) - 8)*16 + 127, gy = ((bi >> 4) - 8)*16 + 127;
    const l = reg[bi], t = reg[256+bi], r = reg[512+bi], b = reg[768+bi];
    const lr = bp*bs*.37;
    TR.x = clamp01((c.x + (gx + (r - l)/2 - 127)/scale)/c.W);
    TR.y = clamp01((c.y + (gy + (b - t)/2 - 127)/scale)/c.H);
    TR.w = Math.min(1, Math.max(10, (l + r)/scale*lr + (1 - lr)*c.w)/c.W);
    TR.h = Math.min(1, Math.max(10, (t + b)/scale*lr + (1 - lr)*c.h)/c.H);
  }

  // ---------- EdgeTAM : trajectoire calculée à l'avance ----------
  // Trop lent pour le direct, mais fiable : il segmente le sujet et le retrouve dans toute l'image grâce à sa
  // mémoire. Un second lecteur parcourt la vidéo depuis la sélection, à TM_STEP secondes d'intervalle, quand la
  // lecture est en pause ou à l'export. L'aperçu et l'export lisent ensuite cette trajectoire ; NanoTrack ne
  // sert que sur les passages pas encore analysés. Même logique de mémoire que SAM2Base.track_step
  // (voir tool/edgetam_export/verify.py) : la mémoire de sélection, les 6 dernières, 16 pointeurs d'objet.
  const TM_STEP = .25, TM_MEM = 6, TM_PTR = 15, TM_GRID = TMN/4;
  const TM = {state:'off', load:null, s:null, gen:0, path:[], done:false, dead:false, force:false, prog:0, on:false,
    rgba:new Uint8Array(4*TMN*TMN), img:new Float32Array(3*TMN*TMN)};
  const tmOn = a => !!a && !!a.url && !!S.tam && TM.state !== 'failed';
  const delay = ms => new Promise(r => setTimeout(r, ms));
  function tamLoad(){
    if (TM.load) return TM.load;
    TM.state = 'loading';
    TM.load = (async () => {
      await ortLoad();
      const s = {};
      for (const n of ['encoder', 'attention', 'decoder', 'memory'])
        s[n] = await ort.InferenceSession.create(ORT_BASE + 'edgetam_' + n + '.onnx', ORT_OPT);
      TM.s = s; TM.state = 'ready';
    })().catch(e => { TM.state = 'failed'; emit({type:'log', msg:'EdgeTAM indisponible : ' + e}); });
    return TM.load;
  }
  // Image entière, déformée en carré comme à l'entraînement, en RVB 0-1 et plans séparés.
  function tamCapture(v){
    const n = TMN, nn = n*n, d = TM.rgba, out = TM.img;
    gl.bindTexture(gl.TEXTURE_2D, tmTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tmfbo); gl.viewport(0, 0, n, n);
    gl.useProgram(nprog); gl.enableVertexAttribArray(nLoc); gl.vertexAttribPointer(nLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(nU.px, 1/n, 1/n); gl.uniform4f(nU.win, 0, 0, 1, 1);
    setAffine(nU.ax, nU.ay); gl.uniform3fv(nU.pad, P.mn);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, d);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, view.width, view.height);
    gl.useProgram(prog); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    for (let y=0; y<n; y++){ const s = (n-1-y)*n*4, o = y*n; // readPixels part du bas de l'image
      for (let x=0; x<n; x++){ const j = s + x*4, i = o + x; out[i] = d[j]/255; out[nn+i] = d[j+1]/255; out[2*nn+i] = d[j+2]/255; } }
    return new ort.Tensor('float32', out, [1, 3, n, n]);
  }
  const tmF = (data, dims) => new ort.Tensor('float32', data, dims);
  const tmI = (vals, dims) => new ort.Tensor('int64', BigInt64Array.from(vals.map(BigInt)), dims);
  function tamDecode(feat, e, points, labels, addNoMem){
    return ortRun(TM.s.decoder, {feat, high0:e.feat0, high1:e.feat1, points:tmF(points, [1, labels.length, 2]),
      labels:tmI(labels, [1, labels.length]), add_no_mem:tmF(new Float32Array([addNoMem]), [])});
  }
  // Centre de gravité et encombrement du masque, en coordonnées 0-1 de l'image.
  function tamEntry(t, mask, score, prev){
    const g = TM_GRID; let n = 0, sx = 0, sy = 0, x0 = g, y0 = g, x1 = 0, y1 = 0;
    for (let y=0; y<g; y++) for (let x=0; x<g; x++) if (mask[y*g + x] > 0){
      n++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const conf = 1/(1 + Math.exp(-score));
    if (!n || score <= 0) return {t, x:prev.x, y:prev.y, w:prev.w, h:prev.h, ok:false, conf};
    return {t, x:(sx/n + .5)/g, y:(sy/n + .5)/g, w:(x1 - x0 + 1)/g, h:(y1 - y0 + 1)/g, ok:true, conf};
  }
  async function tamRun(a, gen){
    // Charger les modèles occupe le worker plusieurs secondes : NanoTrack passe d'abord, et la lecture aussi.
    if (a.nano) await a.nano.ready;
    while (gen === TM.gen && !TM.force && (isPlaying() || exporting)) await delay(250);
    if (gen !== TM.gen) return;
    await tamLoad();
    if (TM.state !== 'ready' || gen !== TM.gen) return;
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    // Pas de display:none, pour la même raison que le lecteur principal (iOS).
    v.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(v);
    const alive = () => gen === TM.gen && TR.anchor === a;
    const seekTo = t => new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('lecteur d\'analyse bloqué')), 15000);
      v.onseeked = () => { clearTimeout(to); res(); }; v.currentTime = t;
    });
    try {
      await new Promise((res, rej) => {
        v.onloadeddata = res; v.onerror = () => rej(new Error('vidéo illisible'));
        v.src = a.url;
      });
      const dur = isFinite(v.duration) ? v.duration : 0;
      let cond = null, past = [];
      for (let t = a.t; alive() && t < Math.max(dur, a.t + .001); t += TM_STEP){
        // La lecture et les autres exports passent d'abord : une seule inférence peut tourner à la fois.
        while (alive() && !TM.force && (isPlaying() || exporting || TR.anchor.key !== itemKey())) await delay(250);
        if (!alive()) break;
        await seekTo(t);
        if (!alive()) break;
        const e = await ortRun(TM.s.encoder, {image: tamCapture(v)});
        if (!alive()) break;
        let dec, best = 0, feat = e.feat2;
        if (!cond){
          const b = a.box, p = [b.x, b.y, b.x + b.w, b.y + b.h].map(c => c*TMN);
          dec = await tamDecode(feat, e, new Float32Array(p), [2, 3], 1); // une boîte : un seul masque, le premier
        } else {
          const recent = past.slice(-TM_MEM), n = recent.length, mems = new Float32Array((n + 1)*512*64);
          mems.set(cond.mem, 0); recent.forEach((m, k) => mems.set(m.mem, (k + 1)*512*64));
          const tpos = [6, ...recent.map((m, k) => n - k - 1)];
          const ptrList = [cond.ptr, ...past.slice(-TM_PTR).reverse().map(m => m.ptr)], ptrs = new Float32Array(ptrList.length*256);
          ptrList.forEach((q, k) => ptrs.set(q, k*256));
          feat = (await ortRun(TM.s.attention, {feat:e.feat2, mem:tmF(mems, [1, (n + 1)*512, 64]), tpos:tmI(tpos, [n + 1]),
            ptrs:tmF(ptrs, [1, ptrList.length*4, 64])})).out;
          if (!alive()) break;
          dec = await tamDecode(feat, e, new Float32Array(2), [-1], 0);
          const iou = dec.iou.data; best = 1; for (let i=2; i<4; i++) if (iou[i] > iou[best]) best = i;
        }
        if (!alive()) break;
        const g2 = TM_GRID*TM_GRID, mask = dec.masks.data.slice(best*g2, (best + 1)*g2), ptr = dec.ptrs.data.slice(best*256, (best + 1)*256);
        const mem = (await ortRun(TM.s.memory, {feat:e.feat2, mask:tmF(mask, [1, 1, TM_GRID, TM_GRID])})).mem.data;
        if (!alive()) break;
        if (!cond) cond = {mem, ptr}; else { past.push({mem, ptr}); if (past.length > TM_PTR) past.shift(); }
        const b = a.box;
        TM.path.push(tamEntry(t, mask, dec.score.data[0], TM.path[TM.path.length - 1] || {x:b.x + b.w/2, y:b.y + b.h/2, w:b.w, h:b.h}));
        TM.prog = dur > a.t ? Math.min(1, (t - a.t + TM_STEP)/(dur - a.t)) : 1;
        redraw = true;
      }
      if (alive()){ TM.done = true; TM.prog = 1; }
    } catch(e){
      if (alive()){ TM.dead = true; emit({type:'log', msg:'Analyse EdgeTAM interrompue : ' + e}); }
    } finally { v.onseeked = v.onloadeddata = v.onerror = null; v.removeAttribute('src'); v.load(); v.remove(); }
  }
  function tamStart(a){
    TM.gen++; TM.path = []; TM.done = false; TM.dead = false; TM.prog = 0; TM.on = false;
    if (tmOn(a)) tamRun(a, TM.gen);
  }
  // Moyenne gaussienne centrée : la trajectoire étant connue d'avance, le cadre n'a aucun retard sur le sujet.
  function tamSmooth(k){
    const sig = Math.max(.01, S.follow/100*.6/TM_STEP), r = Math.ceil(2*sig), p = TM.path;
    let w = 0, x = 0, y = 0;
    for (let i = Math.max(0, k - r); i <= Math.min(p.length - 1, k + r); i++){
      if (!p[i].ok && i !== k) continue;
      const g = Math.exp(-.5*((i - k)/sig)**2); w += g; x += p[i].x*g; y += p[i].y*g;
    }
    return [x/w, y/w];
  }
  // Applique la trajectoire à l'instant t ; faux si ce passage n'est pas encore analysé.
  function tamApply(t){
    const a = TR.anchor, p = TM.path, last = p.length - 1, f = (t - a.t)/TM_STEP;
    TM.on = false;
    if (last < 0 || f < 0 || (f > last && !TM.done)) return false;
    const c = Math.min(f, last), i = Math.floor(c), j = Math.min(last, i + 1), u = c - i, A = p[i], B = p[j];
    const mix = (q, r) => q + (r - q)*u, si = tamSmooth(i), sj = tamSmooth(j);
    TR.x = mix(A.x, B.x); TR.y = mix(A.y, B.y); TR.w = mix(A.w, B.w); TR.h = mix(A.h, B.h);
    TR.sx = mix(si[0], sj[0]); TR.sy = mix(si[1], sj[1]);
    TR.lost = A.ok ? 0 : 3; TR.conf = A.conf; TR.started = true; TR.lastT = t; TM.on = true;
    return true;
  }

  const needTrackBuf = () => (trackMine() && !nanoOn()) || UIM === 'select';
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
    if (rec){ TR.x = rec.x; TR.y = rec.y; TR.sx = rec.sx; TR.sy = rec.sy; TR.w = rec.w; TR.h = rec.h; }
    else { TR.x = TR.sx = a.box.x + a.box.w/2; TR.y = TR.sy = a.box.y + a.box.h/2; TR.w = a.box.w; TR.h = a.box.h; TR.vals = Float32Array.from(a.tpl.vals); }
    if (!TR.vals) TR.vals = Float32Array.from(a.tpl.vals);
    TR.vx = TR.vy = 0; TR.lost = 0; TR.conf = 1; TR.started = true; TR.lastT = t; NT.gen++;
  }
  // Renvoie true si cette image fait avancer le suivi : l'appelant lisse alors la trajectoire (trackSmooth).
  function trackStep(t){
    if (!trackMine() || (!nanoOn() && !haveTg)) return false;
    const a = TR.anchor;
    if (t < a.t - 0.02){ TR.started = false; return false; }
    if (tamApply(t)) return false;
    if (!TR.started){ trackInit(t); return false; }
    if (t <= TR.lastT) return false;
    TR.lastT = t;
    if (nanoOn()) nanoPump(); else templateStep(a.tpl);
    return true;
  }
  function trackSmooth(t){
    const kf = 1 - S.follow/100;
    TR.sx += (TR.x - TR.sx)*kf; TR.sy += (TR.y - TR.sy)*kf;
    TR.path.set(Math.round(t*100), {x:TR.x, y:TR.y, w:TR.w, h:TR.h, sx:TR.sx, sy:TR.sy});
  }
  function templateStep(tp){
    const R =Math.round(Math.min(44, (8 + 1.5*Math.hypot(TR.vx, TR.vy)) * (TR.lost ? 2 : 1)));
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
  }
  function stopTracking(){ TR.anchor = null; TR.started = false; TR.vals = null; TR.path = new Map(); NT.gen++; tamStart(null); }
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
    TR.anchor = {key: itemKey(), t, box, tpl, nano:null, url: useDemo || !current ? null : current.url}; TR.path = new Map(); TR.vals = null;
    if (S.nano && NT.state !== 'failed') nanoTemplate(TR.anchor);
    TR.started = false; trackInit(t); TR.path.set(Math.round(t*100), {x:TR.x, y:TR.y, w:TR.w, h:TR.h, sx:TR.sx, sy:TR.sy});
    tamStart(TR.anchor);
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
    if (stabOn()) stabStep();
    const tt = t === undefined ? curTime() : t;
    if (trackStep(tt)) trackSmooth(tt);
    render();
  }
  // Conversion rapide : rien ne presse, chaque image attend le résultat du suivi avant d'être rendue.
  async function processFrameExact(t){
    if (!sampleFrame()) return;
    const tgt = analyze(); if (tgt) blend(tgt, dirty ? 1 : 1 - S.smooth/100);
    dirty = false;
    if (stabOn()) stabStep();
    if (trackMine() && nanoOn()){
      await NT.busy;
      if (nanoOn() && !TR.anchor.nano.z) await TR.anchor.nano.ready;
    }
    const moved = trackStep(t);
    if (trackMine() && nanoOn()) await NT.busy;
    if (moved) trackSmooth(t);
    render();
  }
  function render(){
    if (!havePix) return;
    redraw = false;
    resize();
    const W = viewWindow();
    gl.uniform4f(U.win, W.x, W.y, W.w, W.h); setAffine(U.ax, U.ay);
    gl.uniform3fv(U.lo, P.lo); gl.uniform3fv(U.sc, P.sc); gl.uniform3fv(U.mn, P.mn);
    gl.uniform1f(U.al, P.al); gl.uniform1f(U.be, P.be); gl.uniform1f(U.am, P.am); gl.uniform1f(U.lp, P.lp); gl.uniform1f(U.ll, P.ll); gl.uniform1f(U.ls, P.ls);
    gl.uniform1f(U.st, S.strength/100); gl.uniform1f(U.sa, S.sat/100); gl.uniform1f(U.ga, 100/S.bright);
    gl.uniform1f(U.sp, (exporting || UIM !== 'normal' || !S.compare) ? 0 : S.split);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (capTrack) capTrack.requestFrame();
  }

  // ---------- Histogramme (uniquement si le panneau est ouvert) ----------
  const HB = 64, hO = [0,1,2].map(() => new Float32Array(HB)), hC = [0,1,2].map(() => new Float32Array(HB));
  function computeHist(){
    for (let c=0; c<3; c++){ hO[c].fill(0); hC[c].fill(0); }
    const d = pix, n = d.length/4, st = S.strength/100, sa = S.sat/100, ga = 100/S.bright;
    let lo = 0, hi = 0;
    for (let i=0; i<d.length; i+=4){
      const r = d[i]/255, g = d[i+1]/255, b = d[i+2]/255;
      hO[0][Math.min(HB-1, r*HB|0)]++; hO[1][Math.min(HB-1, g*HB|0)]++; hO[2][Math.min(HB-1, b*HB|0)]++;
      const rr = r + P.al*(P.mn[1]-P.mn[0])*(1-r)*g, bb = b + P.be*(P.mn[1]-P.mn[2])*(1-b)*g;
      const w = P.lp*lampWeight(r, g, b, P.am);
      const lit = w > 0 ? litColor(r, g, b) : null;
      const mixLit = (v, c) => Math.pow(w > 0 ? v*(1-w) + lit[c]*w : v, ga);
      let x0 = mixLit(clamp01((rr-P.lo[0])*P.sc[0]), 0), x1 = mixLit(clamp01((g-P.lo[1])*P.sc[1]), 1), x2 = mixLit(clamp01((bb-P.lo[2])*P.sc[2]), 2);
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
    const a = TR.anchor.box, e = TM.on ? 'tam' : nanoOn() ? 'nano' : 'motif';
    if (!TR.started) return {at: TR.anchor.t, w: a.w, h: a.h, e, s:'pending', x: a.x + a.w/2, y: a.y + a.h/2};
    return {at: TR.anchor.t, w: TR.w, h: TR.h, e, conf: TR.conf, s: TR.lost > 2 ? 'lost' : 'ok', x: TR.x, y: TR.y, sx: TR.sx, sy: TR.sy, ana: TM.prog};
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
      shift:stabOn() ? [Math.round(ST.ox*srcW()), Math.round(ST.oy*srcH())] : null,
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
    else if (still){
      if (needSample || dirty || !haveP){ needSample = false; processFrame(false, 0); }
      else if (redraw) render();
    }
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
    if (it.kind === 'image'){
      probeChain = probeChain.then(() => new Promise(res => {
        const im = new Image();
        im.onload = () => {
          let thumb;
          try {
            const ar = (im.naturalWidth / im.naturalHeight) || 1, c = document.createElement('canvas');
            c.width = ar >= 1 ? 192 : Math.round(192*ar); c.height = ar >= 1 ? Math.round(192/ar) : 192;
            c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
            thumb = c.toDataURL('image/jpeg', .7).split(',')[1];
          } catch(e){}
          emit({type:'probe', id:it.id, dur:0, thumb, w:im.naturalWidth, h:im.naturalHeight}); res();
        };
        im.onerror = () => { emit({type:'probe', id:it.id, dur:0, err:'format'}); res(); };
        im.src = it.url;
      }));
      return;
    }
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
  function loadStill(it){
    return new Promise((res, rej) => {
      current = it;
      const im = new Image();
      im.onload = () => {
        if (current !== it) return res();
        const k = Math.min(1, gl.getParameter(gl.MAX_TEXTURE_SIZE)/Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(2, Math.round(im.naturalWidth*k)); c.height = Math.max(2, Math.round(im.naturalHeight*k));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        video.onerror = null; video.onloadeddata = null; video.pause(); video.removeAttribute('src'); video.load();
        still = c; useDemo = false; haveP = false; dirty = true; needSample = true; stabReset();
        emit({type:'loaded', id:it.id, d:0}); res();
      };
      im.onerror = () => { emit({type:'loadError', id:it.id}); rej(new Error('Image illisible : format non pris en charge par cet appareil (essayez JPEG)')); };
      im.src = it.url;
    });
  }
  function loadItem(it){
    if (it.kind === 'image') return loadStill(it);
    still = null;
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
    still = null; current = null; video.onerror = null; video.onloadeddata = null; video.pause(); video.removeAttribute('src'); video.load();
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
    if (still) return; // le suivi n'a de sens que dans le temps
    if (UIM === 'select') return setMode('normal');
    if (!crop.on){ crop.aspect = 'free'; crop.on = true; crop.w = crop.h = .6; crop.x = crop.y = .2; emitCrop(); }
    if (useDemo) demoPlaying = false; else video.pause();
    if (S.nano) nanoLoad(); // chargé seulement si le suivi sert, et prêt avant la fin de la sélection
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
  // Débit d'export : jamais moins que la source, à surface égale, pour ne pas perdre de détail au réencodage.
  // La marge couvre la seconde génération de compression ; H.264 demande en plus davantage de débit que HEVC.
  const MAX_BITRATE = 100e6;
  function exportBitrate(pixels, fps, srcBps, srcPixels, hevc){
    const fromSource = srcBps > 0 && srcPixels > 0 ? srcBps*Math.min(1, pixels/srcPixels)*(hevc ? 1.6 : 1.15) : 0;
    return Math.round(Math.min(MAX_BITRATE, Math.max(8e6, pixels*fps*0.1, fromSource)));
  }
  async function record(sink, onProg, rIn = 0, rOut = Infinity, srcBytes = 0){
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
    const bitrate = exportBitrate(srcW()*srcH(), 30, duration() > 0 ? srcBytes*8/duration() : 0, srcW()*srcH(), false);
    let rec;
    try { rec = new MediaRecorder(stream, mime ? {mimeType:mime, videoBitsPerSecond:bitrate} : {videoBitsPerSecond:bitrate}); }
    catch(e){ stream.getVideoTracks().forEach(t => t.stop()); throw new Error('Impossible de démarrer l\'enregistrement : ' + e.message); }
    let pos = 0, writes = Promise.resolve();
    rec.ondataavailable = e => { if (!e.data.size) return;
      writes = writes.then(async () => { const b = new Uint8Array(await e.data.arrayBuffer()); sink.write(b, pos); pos += b.length; }); };
    const done = new Promise(r => rec.onstop = r);
    const total = Math.min(rOut, duration()) - rIn;
    const timer = setInterval(() => onProg(total > 0 ? Math.min(1, (curTime() - rIn)/total) : 0, 0), 250);
    let endWatch = null;
    let outcome = 'ok', muted = false;
    try {
      video.pause(); video.loop = false;
      await new Promise(r => { video.addEventListener('seeked', r, {once:true}); setTimeout(r, 2000); video.currentTime = rIn; });
      stabReset(); rec.start(500);
      if (manual){ capTrack = stream.getVideoTracks()[0]; render(); }
      outcome = await new Promise(r => {
        stopFn = () => r('stop');
        video.addEventListener('ended', () => r('ok'), {once:true});
        if (isFinite(rOut)) endWatch = setInterval(() => { if (video.currentTime >= rOut) r('ok'); }, 20);
        video.play().catch(async () => {
          video.muted = true; muted = true;
          try { await video.play(); } catch(e){ r('fail'); }
        });
      });
    } finally {
      stopFn = null; capTrack = null; clearInterval(timer); clearInterval(endWatch);
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

  async function fastExport(it, file, sink, onProg, rIn = 0, rOut = Infinity){
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
    const srcBps = vt.bitrate > 0 ? vt.bitrate : file.size*8*vt.timescale/vt.duration;
    const bitrate = exportBitrate(W*H, fps, srcBps, SW*SH, /^(hvc|hev)/.test(vt.codec));
    let encCfg = null;
    // Si l'encodeur refuse ce débit, on en essaie un plus bas plutôt que de renoncer à la conversion rapide.
    for (const rate of [...new Set([bitrate, Math.min(bitrate, 60e6), Math.min(bitrate, 40e6), Math.min(bitrate, 20e6)])]){
      for (const codec of ['avc1.640034','avc1.640033','avc1.64002a','avc1.640028','avc1.4d0034','avc1.42e034','vp09.00.51.08','vp09.00.41.08','vp09.00.10.08']){
        const c = {codec, width: W, height: H, bitrate: rate, framerate: fps};
        if (codec.startsWith('avc')) c.avc = {format: 'avc'};
        try { if ((await VideoEncoder.isConfigSupported(c)).supported){ encCfg = c; break; } } catch(e){}
      }
      if (encCfg) break;
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

    // Extrait : on décode depuis l'image clé qui précède le début, et les horodatages repartent de zéro.
    const smp = (mp4.getTrackSamplesInfo(vt.id) || []);
    let ts0 = smp.length ? Infinity : null;
    for (const s of smp.slice(0, 64)) ts0 = Math.min(ts0, Math.round(s.cts*1e6/s.timescale));
    const offUs = rIn > 0 && ts0 !== null ? ts0 + Math.round(rIn*1e6) : 0;
    const endUs = isFinite(rOut) && ts0 !== null ? ts0 + Math.round(rOut*1e6) : Infinity;
    let firstDec = 0, kept = 0;
    for (const s of smp){
      const u = Math.round(s.cts*1e6/s.timescale);
      if (s.is_sync && u <= offUs) firstDec = s.number;
      if (u >= offUs && u < endUs) kept++;
    }
    const vs = []; let aFirst = true, aEnd = 0;
    const aMeta = at && {decoderConfig: {codec: at.codec, sampleRate: at.audio.sample_rate, numberOfChannels: at.audio.channel_count, description: aDesc}};
    mp4.onSamples = (id, _, samples) => {
      if (id === vt.id){ for (const s of samples) vs.push(s); return; }
      for (const s of samples){
        const u = s.cts*1e6/s.timescale, d = s.duration*1e6/s.timescale;
        aEnd = u + d;
        if (u + d <= offUs || u >= endUs) continue;
        muxer.addAudioChunkRaw(s.data, 'key', Math.max(0, u - offUs), d, aFirst ? aMeta : undefined); aFirst = false;
      }
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

    const total = kept || vt.nb_samples, keyInt = Math.max(1, Math.round(fps*2)), t0 = performance.now();
    let vi = 0, n = 0, eof = false, flushed = false, stop = false, reached = false;
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
            if (s.number < firstDec){ if (vi % 30 === 0) mp4.releaseUsedSamples(vt.id, s.number + 1); continue; }
            dec.decode(new EncodedVideoChunk({type: s.is_sync ? 'key' : 'delta', timestamp: Math.round(s.cts*1e6/s.timescale), duration: Math.round(s.duration*1e6/s.timescale), data: s.data}));
            if (vi % 30 === 0) mp4.releaseUsedSamples(vt.id, s.number + 1);
            continue;
          }
          if (eof) break;
          if (!(await feed())){ eof = true; mp4.flush(); }
        }
        if (frames.length){
          const f = frames.shift();
          if (f.timestamp < offUs){ f.close(); continue; }
          if (f.timestamp >= endUs){ f.close(); reached = true; break; }
          if (ts0 === null) ts0 = f.timestamp;
          fastFrame = f; await processFrameExact((f.timestamp - ts0)/1e6);
          const vf = new VideoFrame(view, {timestamp: f.timestamp - offUs, duration: f.duration || Math.round(1e6/fps)});
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
      // Le son est extrait par lots : on lit encore le fichier jusqu'à dépasser la fin de l'extrait.
      if (reached && at){
        while (aEnd < endUs && !eof){ if (!(await feed())){ eof = true; mp4.flush(); } }
      }
      if (!n) throw new Error('extrait vide');
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

  // Image affichée, en pleine résolution et avec les corrections, écrite en JPEG. Le dessin et la lecture de la
  // toile doivent rester dans la même tâche : sans quoi le navigateur peut avoir déjà vidé le tampon.
  async function captureJpeg(id){
    const was = exporting; exporting = true; snapping = true;
    try {
      if (still){ dirty = true; processFrame(false, 0); }
      else { if (!sampleFrame()) throw new Error('Aucune image disponible'); render(); }
      const w = view.width, h = view.height;
      const blob = await new Promise(r => { render(); view.toBlob(r, 'image/jpeg', .95); });
      if (!blob) throw new Error('Encodage JPEG impossible');
      const sink = new Sink(id);
      sink.write(new Uint8Array(await blob.arrayBuffer()), 0);
      await sink.close();
      return {bytes:sink.bytes, w, h};
    } finally { exporting = was; snapping = false; needSample = true; dirty = true; redraw = true; }
  }
  async function snapshot(id){
    if (exporting) return emit({type:'snapshotError', id, msg:'Un export est en cours'});
    try {
      if (!still && !useDemo){
        video.pause();
        if (video.seeking) await new Promise(r => { video.addEventListener('seeked', r, {once:true}); setTimeout(r, 2000); });
      }
      const r = await captureJpeg(id);
      emit({type:'snapshotDone', id, bytes:r.bytes, w:r.w, h:r.h, t:curTime()});
    } catch(e){ emit({type:'snapshotError', id, msg:String(e.message || e)}); }
  }

  async function exportItem(it){
    if (exporting) return;
    if (UIM !== 'normal') setMode('normal');
    exporting = true;
    const t0 = performance.now(), file = new RemoteFile(it.url, it.size);
    let mode = 'fast', why = '', out, sink;
    const prog = (p, speed) => emit({type:'exportProgress', id:it.id, p, speed, mode});
    const rIn = Math.max(0, +it.in || 0), rOut = +it.out > 0 ? +it.out : Infinity;
    try {
      if (it.kind === 'image'){
        mode = 'photo';
        if (current !== it || !still) await loadItem(it);
        const r = await captureJpeg(it.id);
        emit({type:'exportDone', id:it.id, ext:'jpg', muted:false, mode, why:'', bytes:r.bytes, time:(performance.now()-t0)/1000});
        return;
      }
      // Le sujet suivi doit être analysé jusqu'au bout avant de composer l'image.
      const a = TR.anchor;
      if (a && a.key === it.id && tmOn(a)){
        let stopped = false; mode = 'analyse'; stopFn = () => { stopped = true; }; TM.force = true;
        try {
          // L'analyse s'arrête utilement à la fin de l'extrait.
          const covered = () => TM.done || a.t >= rOut || (TM.path.length && TM.path[TM.path.length - 1].t >= rOut);
          while (!stopped && !covered() && !TM.dead && TM.state !== 'failed' && TR.anchor === a){ prog(TM.prog, 0); await delay(250); }
        } finally { stopFn = null; TM.force = false; mode = 'fast'; }
        if (stopped){ emit({type:'exportStopped', id:it.id}); return; }
      }
      if (canFast() && /\.(mp4|m4v|mov)$/i.test(it.name)){
        current = it;
        try {
          sink = new Sink(it.id);
          out = await fastExport(it, file, sink, prog, rIn, rOut);
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
        out = await record(sink, prog, rIn, rOut, file.size);
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
      case 'snapshot': snapshot(m.id); break;
    }
  }};
  requestAnimationFrame(loop);
  emit({type:'ready'});
})();
