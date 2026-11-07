// Test de bout en bout du moteur vidéo : vrai LocalServer Dart, vrai Chrome, vraies vidéos (ffmpeg).
// Usage, depuis la racine du projet : node tool/engine_e2e/run.mjs <dossier_travail>
// Le dossier doit être vide ou absent. Nécessite ffmpeg, ffprobe, dart et google-chrome dans le PATH.
import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const W = process.argv[2];
if (!W) { console.error('usage: run.mjs <dossier>'); process.exit(2); }
mkdirSync(W, {recursive: true});
const sh = (cmd, ...a) => execFileSync(cmd, a, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
const ff = (...a) => sh('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', ...a);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// ---------- Vidéos de test ----------
const SCENE = 'testsrc2=s=1280x720:r=30:d=4,colorchannelmixer=rr=.35:gg=.9:bb=1';
const land = join(W, 'land.mp4'), portrait = join(W, 'portrait.mov'), webm = join(W, 'clip.webm'), moving = join(W, 'moving.mp4');
ff('-f', 'lavfi', '-i', SCENE, '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', land);
// Vidéo « de téléphone » : 640×360 codé avec rotation d'affichage de 90° (le haut de l'image affichée est rouge).
const raw = join(W, 'raw.mp4');
ff('-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', raw);
ff('-display_rotation', '-90', '-i', raw, '-c', 'copy', portrait);
ff('-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=15:d=2', '-c:v', 'libvpx', '-b:v', '500k', webm);
// Carré contrasté qui se déplace de gauche à droite (x = 100 → 1100) sur fond texturé.
ff('-f', 'lavfi', '-i', 'color=c=0x204060:s=1280x720:r=30:d=4', '-f', 'lavfi', '-i', 'color=c=white:s=80x80:r=30:d=4',
   '-filter_complex', "[0]noise=alls=12:allf=p[b];[1]drawbox=x=20:y=20:w=40:h=40:c=black:t=fill[f];[b][f]overlay=x='100+250*t':y=320",
   '-c:v', 'libx264', '-pix_fmt', 'yuv420p', moving);

// Photo bleutée, plus grande que l'écran.
const photo = join(W, 'plongee.jpg');
ff('-f', 'lavfi', '-i', 'testsrc2=s=1600x1200:r=1:d=1,colorchannelmixer=rr=.35:gg=.9:bb=1', '-frames:v', '1', '-update', '1', photo);

// Eau bleue, puis un sujet éclairé par une lampe : photo, et vidéo où la lampe s'allume à 2 s.
const WATER = 'color=c=0x165E78:s=1280x720:r=30:d=4,noise=alls=14:allf=p';
const LIT = 'drawbox=x=480:y=240:w=320:h=240:c=0x8F8273:t=fill';
const lampPhoto = join(W, 'lampe.png'), waterPhoto = join(W, 'eau.png'), lampVideo = join(W, 'lampe.mp4');
ff('-f', 'lavfi', '-i', `${WATER},${LIT}`, '-frames:v', '1', '-update', '1', lampPhoto);
ff('-f', 'lavfi', '-i', WATER, '-frames:v', '1', '-update', '1', waterPhoto);
// Image presque noire : trop peu de pixels visibles pour mesurer l'eau, la protection doit rester coupée.
const darkRed = join(W, 'sombre-rouge.png');
ff('-f', 'lavfi', '-i', 'color=c=black:s=1280x720:d=1,drawbox=x=560:y=300:w=160:h=120:c=0xCC0303:t=fill', '-frames:v', '1', '-update', '1', darkRed);
ff('-f', 'lavfi', '-i', `${WATER},drawbox=x=480:y=240:w=320:h=240:c=0x8F8273:t=fill:enable='gte(t,2)'`, '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', lampVideo);
// Couleur moyenne d'une zone, en R V B 0-255.
const rgbAt = (file, x, y, w, h, ss = 0) => [...execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(ss), '-i', file, '-frames:v', '1',
  '-vf', `crop=${w}:${h}:${x}:${y},scale=1:1:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

// Vidéo très détaillée à fort débit : l'export ne doit pas retomber au plancher de débit.
const rich = join(W, 'riche.mp4');
ff('-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=3,noise=alls=40:allf=t', '-c:v', 'libx264', '-b:v', '20M', '-minrate', '20M', '-maxrate', '20M', '-bufsize', '20M', '-pix_fmt', 'yuv420p', rich);

// ---------- Serveur et navigateur ----------
const outDir = join(W, 'out');
const srv = spawn('dart', ['tool/engine_e2e/serve.dart', outDir, land, portrait, webm, moving, photo, lampPhoto, waterPhoto, lampVideo, rich, darkRed], {stdio: ['ignore', 'pipe', 'inherit']});
const info = await new Promise(res => srv.stdout.once('data', d => res(JSON.parse(String(d)))));
const [L, P, Wb, M, ImgSrc, LampSrc, WaterSrc, LampV, Rich, DarkRed] = info.sources;
const Img = {...ImgSrc, kind: 'image'};
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn('google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(W, 'chrome')}`,
  '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=800,450', 'about:blank'], {stdio: 'ignore'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(250);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let cid = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const cdp = (method, params = {}) => new Promise(r => { const id = ++cid; pend.set(id, r); ws.send(JSON.stringify({id, method, params})); });
const js = async expr => {
  const r = await cdp('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
const cmd = o => js(`Engine.cmd(${JSON.stringify(o)})`);
const events = type => js(`(window.__events||[]).filter(e=>e.type===${JSON.stringify(type)})`);
const clear = () => js(`window.__events=[]`);
async function until(type, pred = () => true, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = (await events(type)).find(pred);
    if (hit) return hit;
    await sleep(100);
  }
  throw new Error(`délai dépassé : ${type}`);
}
const reload = async () => { await cdp('Page.navigate', {url: info.engine}); await until('ready', () => true, 20000); };
const probe = f => JSON.parse(sh('ffprobe', '-v', 'error', '-show_streams', '-of', 'json', f)).streams;
const part = id => join(outDir, id + '.part');
const exportOf = async (src, extra = {}) => {
  await clear();
  await cmd({c: 'export', item: src, ...extra});
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    const ev = (await js(`(window.__events||[]).filter(e=>/^export(Done|Error|Stopped)$/.test(e.type))`))[0];
    if (ev) return ev;
    await sleep(150);
  }
  throw new Error('export sans fin');
};
const ssimAll = (a, b, filter) => {
  const r = spawnSync(a, b, filter);
  const m = /All:([\d.]+)/.exec(r);
  return m ? +m[1] : -1;
};
// Moyenne, sur toutes les images, d'une mesure signalstats après le filtre donné.
function meanStat(file, vf, key) {
  const o = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `${vf},metadata=print:key=lavfi.signalstats.${key}:file=-`, '-f', 'null', '-'], {encoding: 'utf8', maxBuffer: 1 << 26});
  const m = [...o.matchAll(new RegExp(`${key}=([\\d.]+)`, 'g'))].map(x => +x[1]);
  return m.length ? m.reduce((p, c) => p + c) / m.length : -1;
}
function spawnSync(a, b, filter) {
  try { return execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${a}" -i "${b}" -lavfi "${filter}" -f null - 2>&1`], {encoding: 'utf8'}); }
  catch (e) { return String(e.stdout || e); }
}

try {
  await reload();
  check('le moteur démarre et émet ready', true);
  await sleep(600);
  const dims0 = await events('dims');
  check('la scène de démo tourne en 1280×720', dims0.some(d => d.w === 1280 && d.h === 720));
  // Image réelle du moteur : sert de fond aux captures d'écran des tests d'interface.
  const frame = await js(`document.getElementById('view').toDataURL('image/jpeg', .85)`);
  writeFileSync(join(W, 'frame.jpg'), Buffer.from(frame.split(',')[1], 'base64'));
  const tick0 = (await events('tick')).at(-1);
  check('tick envoie gains et stabilisation', !!tick0 && tick0.gains.length === 3 && tick0.shift !== undefined, JSON.stringify(tick0?.gains));

  // Sonde et miniature
  await clear();
  await cmd({c: 'probe', item: L});
  const pr = await until('probe', e => e.id === L.id, 20000);
  check('la sonde lit durée et miniature (lecture par plages)', pr.dur > 3.9 && !!pr.thumb, `dur=${pr.dur}`);

  // Export rapide, sans correction ni stabilisation : la sortie doit ressembler à la source
  await cmd({c: 'settings', v: {strength: 0, stab: false, compare: false}});
  let done = await exportOf(L);
  check('export rapide MP4 terminé en mode fast', done.type === 'exportDone' && done.mode === 'fast', JSON.stringify(done));
  let st = probe(part(L.id));
  const v = st.find(s => s.codec_type === 'video'), a = st.find(s => s.codec_type === 'audio');
  check('sortie H.264 1280×720 lisible sur disque', v?.codec_name === 'h264' && v.width === 1280 && v.height === 720, `${v?.codec_name} ${v?.width}x${v?.height}`);
  check('son AAC d\'origine conservé', a?.codec_name === 'aac');
  check('toutes les images sont présentes', Math.abs(+v.nb_frames - 120) <= 1, `nb_frames=${v.nb_frames}`);
  check('taille annoncée = taille du fichier', done.bytes === statSync(part(L.id)).size, `${done.bytes}`);
  const s1 = ssimAll(part(L.id), land, 'ssim');
  check('filtre à 0 % : image identique à la source', s1 > 0.9, `SSIM=${s1}`);

  // Vidéo portrait (rotation de conteneur appliquée aux pixels)
  await reload();
  await cmd({c: 'settings', v: {strength: 0, stab: false, compare: false}});
  done = await exportOf(P);
  st = probe(part(P.id));
  const pv = st.find(s => s.codec_type === 'video');
  const sideRot = (pv.side_data_list || []).find(d => 'rotation' in d)?.rotation ?? 0;
  check('vidéo portrait : sortie 360×640 sans métadonnée de rotation', done.mode === 'fast' && pv.width === 360 && pv.height === 640 && !sideRot, `${pv.width}x${pv.height} rot=${sideRot} mode=${done.mode}`);
  const s2 = ssimAll(part(P.id), portrait, 'ssim');
  check('vidéo portrait : image à l\'endroit, comme la source', s2 > 0.85, `SSIM=${s2}`);

  // Format 9:16 appliqué à la vidéo paysage
  await reload();
  await cmd({c: 'settings', v: {strength: 100, stab: true, compare: false}});
  await cmd({c: 'load', item: L}); await until('loaded');
  await cmd({c: 'aspect', a: '9:16'});
  const cr = await until('crop', e => e.aspect === '9:16', 5000);
  await cmd({c: 'mode', mode: 'normal'});
  done = await exportOf(L);
  const cv = probe(part(L.id)).find(s => s.codec_type === 'video');
  check('format 9:16 : sortie verticale', done.type === 'exportDone' && Math.abs(cv.width / cv.height - 9 / 16) < .01, `${cv.width}x${cv.height} crop=${cr.w.toFixed(3)}x${cr.h.toFixed(3)}`);

  // Quart de tour
  await reload();
  await cmd({c: 'settings', v: {strength: 0, stab: false, compare: false}});
  await cmd({c: 'orient', v: {rot: 90}});
  done = await exportOf(L);
  const rv = probe(part(L.id)).find(s => s.codec_type === 'video');
  const s3 = ssimAll(part(L.id), land, '[1]transpose=clock[r];[0][r]ssim');
  check('quart de tour : 720×1280 et image pivotée dans le bon sens', rv.width === 720 && rv.height === 1280 && s3 > 0.85, `SSIM=${s3}`);

  // Correction des couleurs : le rouge doit remonter
  await reload();
  await cmd({c: 'settings', v: {strength: 100, stab: false, compare: false}});
  done = await exportOf(L);
  const vIn = meanStat(land, 'signalstats', 'VAVG'), vOut = meanStat(part(L.id), 'signalstats', 'VAVG');
  check('correction : le rouge (chroma V) remonte', vOut > vIn + 2, `V source=${vIn.toFixed(1)} sortie=${vOut.toFixed(1)}`);

  // Lampe : le sujet éclairé garde ses couleurs, et l'eau reste celle du calcul habituel.
  const exportColours = async (src, lamp) => {
    await reload();
    await cmd({c: 'settings', v: {strength: 100, stab: false, compare: false, lamp}});
    const e = await exportOf({...src, kind: 'image'});
    if (e.type !== 'exportDone') throw new Error(JSON.stringify(e));
    return {lit: rgbAt(part(src.id), 560, 300, 160, 120), water: rgbAt(part(src.id), 40, 40, 200, 200)};
  };
  const off = await exportColours(LampSrc, 0), on = await exportColours(LampSrc, 100);
  const waterOff = await exportColours(WaterSrc, 0), waterOn = await exportColours(WaterSrc, 100);
  const litIn = rgbAt(lampPhoto, 560, 300, 160, 120);
  console.log(`     sujet source ${litIn} sans protection ${off.lit} avec ${on.lit} ; eau sans lampe ${waterOff.water} avec lampe ${on.water} (non protégée ${off.water})`);
  check('lampe : le sujet éclairé garde son bleu', on.lit[2] >= litIn[2] - 25 && off.lit[2] < litIn[2] - 25, `bleu source=${litIn[2]} sans=${off.lit[2]} avec=${on.lit[2]}`);
  check('lampe : le sujet éclairé ne vire pas au rouge', on.lit[0] - on.lit[2] < litIn[0] - litIn[2] + 25, `R-B source=${litIn[0] - litIn[2]} avec=${on.lit[0] - on.lit[2]}`);
  check('lampe : l\'eau reste corrigée comme sans protection', near(on.water, off.water, 2), `${on.water} / ${off.water}`);
  check('lampe : aucun effet sur une image sans lampe', near(waterOn.water, waterOff.water, 2), `${waterOn.water} / ${waterOff.water}`);
  const darkOff = await exportColours(DarkRed, 0), darkOn = await exportColours(DarkRed, 100);
  check('lampe : image sombre sans eau mesurable, la protection reste coupée', near(darkOn.lit, darkOff.lit, 2), `${darkOn.lit} / ${darkOff.lit}`);
  await reload();
  await cmd({c: 'settings', v: {strength: 100, stab: false, compare: false, smooth: 90}});
  done = await exportOf(LampV);
  const wBefore = rgbAt(part(LampV.id), 40, 40, 200, 200, 1.5), wAfter = rgbAt(part(LampV.id), 40, 40, 200, 200, 3.5);
  check('lampe : l\'eau ne rougit pas quand la lampe s\'allume', done.type === 'exportDone' && wAfter[0] <= wBefore[0] + 8, `${wBefore} puis ${wAfter}`);

  // Débit d'export : suit une source riche, sans gonfler une source légère.
  const videoBps = f => { const o = JSON.parse(sh('ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=bit_rate', '-of', 'json', f)); return +o.streams[0].bit_rate; };
  await reload();
  await cmd({c: 'settings', v: {strength: 100, stab: false, compare: false}});
  done = await exportOf(Rich);
  const richIn = videoBps(rich), richOut = done.type === 'exportDone' ? videoBps(part(Rich.id)) : 0;
  check('débit : l\'export suit une source à fort débit', richOut > richIn * .8, `source ${(richIn / 1e6).toFixed(1)} Mbit/s, sortie ${(richOut / 1e6).toFixed(1)} Mbit/s`);
  await reload();
  await cmd({c: 'settings', v: {strength: 100, stab: false, compare: false}});
  done = await exportOf(L);
  const landOut = done.type === 'exportDone' ? videoBps(part(L.id)) : Infinity;
  check('débit : une source légère reste au plancher', landOut <= 9e6, `sortie ${(landOut / 1e6).toFixed(1)} Mbit/s`);

  // Arrêt en cours d'export : le moteur revient à l'état normal
  await reload();
  await clear();
  await cmd({c: 'export', item: L});
  await until('exportProgress', () => true, 60000);
  await cmd({c: 'stop'});
  const stopped = await until('exportStopped', () => true, 30000);
  check('arrêt d\'export pris en compte', !!stopped);

  // Format non MP4 : repli en temps réel
  await reload();
  await cmd({c: 'settings', v: {strength: 100, stab: false, compare: false}});
  done = await exportOf(Wb);
  check('WebM : repli sur l\'export en temps réel', done.type === 'exportDone' && done.mode === 'rt', JSON.stringify(done));
  const wv = probe(part(Wb.id)).find(s => s.codec_type === 'video');
  check('export temps réel lisible', !!wv, wv?.codec_name);

  // Extrait : de 1 s à 2,5 s, sans correction pour comparer au contenu d'origine.
  await reload();
  await cmd({c: 'settings', v: {strength: 0, sat: 100, bright: 100, stab: false, compare: false}});
  done = await exportOf({...L, in: 1, out: 2.5});
  const clipStreams = done.type === 'exportDone' ? probe(part(L.id)) : [];
  const clipV = clipStreams.find(s => s.codec_type === 'video'), clipA = clipStreams.find(s => s.codec_type === 'audio');
  check('extrait : conversion rapide terminée', done.type === 'exportDone' && done.mode === 'fast', JSON.stringify(done));
  check('extrait : 45 images, soit 1,5 s', Math.abs(+clipV?.nb_frames - 45) <= 1, `nb_frames=${clipV?.nb_frames} durée=${clipV?.duration}`);
  check('extrait : son de la même durée', !!clipA && Math.abs(+clipA.duration - 1.5) < .1, `durée son=${clipA?.duration}`);
  const refClip = join(W, 'ref-clip.mp4');
  ff('-ss', '1', '-t', '1.5', '-i', land, '-an', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', refClip);
  const clipSsim = +(/All:([\d.]+)/.exec(spawnSync(part(L.id), refClip, 'ssim')) || [])[1];
  check('extrait : bon passage de la vidéo', clipSsim > .85, `SSIM=${clipSsim}`);
  const fullSsim = +(/All:([\d.]+)/.exec(spawnSync(part(L.id), land, 'ssim')) || [])[1];
  check('extrait : différent du début de la vidéo', fullSsim < clipSsim, `SSIM début=${fullSsim}`);

  // Photo extraite d'une vidéo : pleine résolution, sans la ligne avant/après ni le recadrage de stabilisation.
  await reload();
  await cmd({c: 'settings', v: {stab: true, compare: true, split: .5}});
  await cmd({c: 'load', item: L}); await until('loaded');
  await cmd({c: 'seek', t: 2}); await sleep(800);
  await clear();
  await cmd({c: 'snapshot', id: 'snap1'});
  const snap = await until('snapshotDone', () => true, 20000);
  const sv = probe(part('snap1'))[0];
  check('photo : JPEG en pleine résolution', sv.codec_name === 'mjpeg' && sv.width === 1280 && sv.height === 720 && Math.abs(snap.t - 2) < .1, `${sv.codec_name} ${sv.width}x${sv.height} t=${snap.t}`);
  check('photo : couleurs corrigées', meanStat(part('snap1'), 'signalstats', 'VAVG') > meanStat(land, 'signalstats', 'VAVG') + 10, '');
  // Un export demandé pendant l'écriture d'une photo attend la fin de la capture au lieu d'être perdu.
  await clear();
  await js(`Engine.cmd({c:'snapshot', id:'snap2'}); Engine.cmd(${JSON.stringify({c: 'export', item: {...L, out: 1}})})`);
  const snap2 = await until('snapshotDone', () => true, 20000).catch(() => null);
  const afterSnap = await until('exportDone', e => e.id === L.id, 120000).catch(() => null);
  check('photo puis export immédiat : les deux aboutissent', !!snap2 && !!afterSnap, `photo=${!!snap2} export=${afterSnap?.type ?? 'aucune réponse'}`);

  // Image en entrée : pleine résolution, corrigée, sans recadrage de stabilisation.
  await reload();
  await cmd({c: 'settings', v: {stab: true, compare: false}});
  await clear();
  await cmd({c: 'probe', item: Img});
  const ip = await until('probe', () => true, 10000);
  check('image : sonde dimensions et miniature', ip.w === 1600 && ip.h === 1200 && !!ip.thumb, `${ip.w}x${ip.h}`);
  done = await exportOf(Img);
  const iv = done.type === 'exportDone' ? probe(part(Img.id))[0] : null;
  check('image : export JPEG en pleine résolution', iv?.codec_name === 'mjpeg' && iv.width === 1600 && iv.height === 1200 && done.ext === 'jpg', JSON.stringify(done) + ` ${iv?.width}x${iv?.height}`);
  const photoV = meanStat(photo, 'signalstats', 'VAVG'), photoOut = meanStat(part(Img.id), 'signalstats', 'VAVG');
  check('image : le rouge (chroma V) remonte', photoOut > photoV + 10, `V source=${photoV.toFixed(1)} sortie=${photoOut.toFixed(1)}`);
  await cmd({c: 'load', item: Img}); await until('loaded', () => true, 5000);
  await sleep(300); await clear();
  const it0 = await until('tick', () => true, 3000);
  check('image : reste affichée, sans lecture', it0.d === 0 && it0.playing === false && it0.shift === null, `d=${it0.d} playing=${it0.playing}`);
  // Puis une vidéo : la source redevient bien la vidéo.
  await cmd({c: 'load', item: L}); await until('loaded', e => e.id === L.id, 5000);
  await sleep(300); await clear();
  const it1 = await until('tick', t => t.d > 3, 3000);
  check('image puis vidéo : retour à la vidéo', it1.src[0] === 1280, `src=${it1.src}`);

  // Suivi du sujet : le carré va de x≈140 à x≈1140 en 4 s
  await reload();
  await cmd({c: 'settings', v: {stab: false, compare: false}});
  await cmd({c: 'load', item: M}); await until('loaded');
  await sleep(500);
  await cmd({c: 'pickSubject'});
  await until('mode', e => e.mode === 'select', 5000);
  await sleep(300);
  await clear();
  await cmd({c: 'select', a: {x: (100 + 0) / 1280, y: 320 / 720}, b: {x: 180 / 1280, y: 400 / 720}});
  await until('mode', e => e.mode === 'normal', 5000);
  await cmd({c: 'play'});
  await sleep(3200);
  const tk = (await events('tick')).filter(t => t.tr && t.tr.x !== undefined);
  const trackErrs = tk.filter(t => t.t > 0.2).map(t => Math.abs(t.tr.x * 1280 - (140 + 250 * t.t)));
  const worst = Math.max(...trackErrs);
  check('suivi : le sujet est suivi pendant son déplacement', trackErrs.length > 5 && worst < 80 && tk.at(-1).tr.s === 'ok', `écart max ${worst.toFixed(0)} px sur ${trackErrs.length} mesures, état=${tk.at(-1)?.tr.s}`);

  check('suivi : NanoTrack est bien le moteur utilisé', tk.at(-1)?.tr.e === 'nano', `moteur=${tk.at(-1)?.tr.e} confiance=${tk.at(-1)?.tr.conf}`);

  // EdgeTAM : en pause, l'analyse calcule la trajectoire. Puis on se déplace dans la vidéo.
  await cmd({c: 'pause'});
  await sleep(200);
  await clear();
  const anaT0 = Date.now();
  const anaDone = await until('tick', t => t.tr && t.tr.ana === 1, 300000);
  check('EdgeTAM : l\'analyse va au bout de la vidéo', !!anaDone, `${((Date.now() - anaT0)/1000).toFixed(0)} s`);
  const tamErrs = [];
  for (const t of [1.2, 2.4, 0.6, 3.3]){
    await cmd({c: 'seek', t});
    await sleep(700);
    await clear();
    const tick = await until('tick', k => k.tr && k.tr.e === 'tam' && Math.abs(k.t - t) < .05, 5000);
    tamErrs.push(Math.abs(tick.tr.x * 1280 - (140 + 250 * tick.t)));
  }
  check('EdgeTAM : sujet retrouvé après des déplacements dans la vidéo', Math.max(...tamErrs) < 30, `écarts ${tamErrs.map(e => e.toFixed(0)).join(', ')} px`);

  // Export avec suivi : même moteur, même sujet, sortie aux dimensions du cadre
  done = await exportOf(M);
  const tv = probe(part(M.id)).find(s => s.codec_type === 'video');
  check('export avec suivi du sujet : aux dimensions du cadre', done.type === 'exportDone' && done.mode === 'fast' && tv.width === 768 && tv.height === 432, `${tv?.width}x${tv?.height}`);

  // Deux exports à la suite, sans recharger le moteur (export de la liste)
  await reload();
  await cmd({c: 'settings', v: {strength: 100, stab: true, compare: false}});
  const d1 = await exportOf(P), d2 = await exportOf(L);
  check('liste : deux exports enchaînés', d1.type === 'exportDone' && d2.type === 'exportDone' && d2.mode === 'fast', `${d1.type}/${d2.type}`);
  const v2 = probe(part(L.id)).find(s => s.codec_type === 'video');
  check('liste : la 2e sortie garde ses propres dimensions', v2.width === 1280 && v2.height === 720 && Math.abs(+v2.nb_frames - 120) <= 1, `${v2.width}x${v2.height} ${v2.nb_frames} images`);

  // Stabilisation : l'écart moyen entre images successives doit baisser sur une vidéo secouée
  const shaky = join(W, 'shaky.mp4');
  ff('-f', 'lavfi', '-i', 'mandelbrot=s=1400x800:r=30:end_scale=0.3,trim=duration=3', '-vf', "crop=1280:720:60+50*sin(n*1.1):40+35*cos(n*0.9)", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', shaky);
  const srv2 = spawn('dart', ['tool/engine_e2e/serve.dart', join(W, 'out2'), shaky, photo], {stdio: ['ignore', 'pipe', 'inherit']});
  const info2 = await new Promise(res => srv2.stdout.once('data', d => res(JSON.parse(String(d)))));
  try {
    await cdp('Page.navigate', {url: info2.engine}); await until('ready', () => true, 20000);
    await cmd({c: 'settings', v: {strength: 0, stab: true, sforce: 96, scrop: 16, compare: false}});
    await clear();
    await cmd({c: 'export', item: info2.sources[0]});
    await until('exportDone', () => true, 180000);
    const jitter = f => meanStat(f, 'tblend=all_mode=difference,signalstats', 'YAVG');
    const before = jitter(shaky), after = jitter(join(W, 'out2', 'v1.part'));
    check('stabilisation : moins d\'écart entre images', after < before * 0.7, `avant=${before.toFixed(2)} après=${after.toFixed(2)}`);
    // Export de liste : une photo, puis la vidéo secouée. La vidéo doit rester stabilisée.
    await clear();
    await cmd({c: 'export', item: {...info2.sources[1], kind: 'image'}});
    await until('exportDone', e => e.id === info2.sources[1].id, 60000);
    await clear();
    await cmd({c: 'export', item: info2.sources[0]});
    await until('exportDone', e => e.id === info2.sources[0].id, 180000);
    const afterPhoto = jitter(join(W, 'out2', 'v1.part'));
    check('liste : vidéo après une photo, toujours stabilisée', afterPhoto < before * 0.7, `avant=${before.toFixed(2)} après=${afterPhoto.toFixed(2)}`);
  } finally { srv2.kill(); }
} catch (e) {
  check('exécution du scénario', false, String(e.stack || e));
} finally {
  const logs = await js(`(window.__events||[]).filter(e=>e.type==='log')`).catch(() => []);
  if (logs?.length) console.log('journal moteur :', JSON.stringify(logs).slice(0, 800));
  chrome.kill(); srv.kill();
}
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
