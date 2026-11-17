const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const os = require('os');
const JOBS_DIR = process.env.JOBS_DIR || path.join(ROOT, 'jobs');
const PORT = process.env.PORT || 3000;

// Localiza JDK/Android SDK: env var, Docker (/opt/android-sdk, /usr/lib), ou ~/build
function pick(cands, file) { for (const c of cands) if (c && fs.existsSync(path.join(c, file))) return c; return cands.find(Boolean); }
const JAVA_HOME = process.env.JAVA_HOME || pick(['/home/user/build/jdk17', '/usr/lib/jvm/java-17-openjdk-amd64', '/usr/lib/jvm/java-17-openjdk', '/opt/jdk17'], 'bin/java') || '/usr/lib/jvm/java-17-openjdk-amd64';
const ANDROID_HOME = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || pick(['/home/user/build/android-sdk', '/opt/android-sdk', '/usr/lib/android-sdk'], 'build-tools') || '/opt/android-sdk';
const BT = path.join(ANDROID_HOME, 'build-tools', '34.0.0');
const ANDROID_JAR = path.join(ANDROID_HOME, 'platforms', 'android-34', 'android.jar');
const KEYSTORE = process.env.KEYSTORE_PATH || path.join(ROOT, 'keystore', 'debug.keystore');

const jobs = new Map();
let jobsDir = JOBS_DIR;
try { fs.mkdirSync(jobsDir, { recursive: true }); }
catch { jobsDir = path.join(os.tmpdir(), 'web2apk-jobs'); fs.mkdirSync(jobsDir, { recursive: true }); }
try { fs.mkdirSync(path.dirname(KEYSTORE), { recursive: true }); } catch {}

function env() {
  return { ...process.env, JAVA_HOME, ANDROID_HOME, PATH: `${path.join(JAVA_HOME, 'bin')}:${process.env.PATH}` };
}
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: env(), ...opts });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve({ out, err }) : reject(new Error(`${path.basename(cmd)} falhou (código ${code}):\n${(err || out).slice(-3000)}`)));
  });
}
function toolchainOk() {
  return fs.existsSync(path.join(BT, 'aapt2')) && fs.existsSync(ANDROID_JAR) && fs.existsSync(path.join(JAVA_HOME, 'bin', 'java'));
}
async function ensureKeystore() {
  if (fs.existsSync(KEYSTORE)) return;
  await run(path.join(JAVA_HOME, 'bin', 'keytool'), ['-genkeypair', '-keystore', KEYSTORE, '-alias', 'androiddebugkey',
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-keypass', 'android', '-storepass', 'android',
    '-dname', 'CN=Web2APK, OU=Web2APK, O=Web2APK, L=BR, ST=BR, C=BR']);
}

// ---------- util ----------
const escXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function sanitizeRel(p) {
  p = String(p || '').replace(/\\/g, '/');
  const parts = p.split('/').filter(x => x && x !== '.' && x !== '..');
  return parts.join('/');
}
function copyFileSyncSafe(src, dest) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); }
function copyDir(src, dest) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d); else copyFileSyncSafe(s, d);
  }
}
function findIndexRoot(dir) {
  if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  // procura index.html até 2 níveis
  for (const e of entries) if (e.isDirectory()) {
    const sub = path.join(dir, e.name);
    if (fs.existsSync(path.join(sub, 'index.html'))) return sub;
    for (const e2 of fs.readdirSync(sub, { withFileTypes: true }))
      if (e2.isDirectory() && fs.existsSync(path.join(sub, e2.name, 'index.html'))) return path.join(sub, e2.name);
  }
  return null;
}

// ---------- multipart (sem dependências) ----------
function parseMultipart(buffer, boundary) {
  const fields = {}, files = [];
  const sep = Buffer.from('--' + boundary);
  let start = buffer.indexOf(sep);
  while (start !== -1) {
    let partStart = start + sep.length;
    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) partStart += 2;
    if (buffer[partStart] === 45 && buffer[partStart + 1] === 45) break; // fim
    const headerEnd = buffer.indexOf('\r\n\r\n', partStart);
    if (headerEnd === -1) break;
    const header = buffer.slice(partStart, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    let next = buffer.indexOf(sep, dataStart);
    if (next === -1) break;
    let dataEnd = next - 2; // \r\n antes do boundary
    const data = buffer.slice(dataStart, dataEnd);
    const nameMatch = /name="([^"]*)"/.exec(header);
    const fileMatch = /filename="([^"]*)"/.exec(header);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(header);
    if (nameMatch) {
      if (fileMatch && fileMatch[1] !== '') files.push({ field: nameMatch[1], filename: fileMatch[1], type: typeMatch ? typeMatch[1] : '', data });
      else if (!fileMatch) fields[nameMatch[1]] = data.toString('utf8');
      else fields[nameMatch[1]] = ''; // input file vazio
    }
    start = next;
  }
  return { fields, files };
}

// ---------- build ----------
async function build(job) {
  const step = (msg, pct) => { job.step = msg; job.progress = pct; job.log.push(msg); console.log(`[${job.id}] ${msg}`); };
  try {
    if (!toolchainOk()) throw new Error('Ferramentas do Android não encontradas neste servidor. Rode ./setup.sh uma vez (veja o README).');
    const f = job.fields;
    const appName = (f.appName || 'Meu App').trim().slice(0, 60);
    const pkg = (f.packageName || '').trim().toLowerCase();
    const versionName = (f.versionName || '1.0.0').trim();
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(pkg)) throw new Error('Nome de pacote inválido. Use algo como com.minhaempresa.meuapp (só minúsculas, números e ponto).');
    let versionCode = parseInt(f.versionCode, 10);
    if (!versionCode || versionCode < 1) {
      const p = versionName.split('.').map(n => parseInt(n, 10) || 0);
      versionCode = ((p[0] || 1) * 10000) + ((p[1] || 0) * 100) + (p[2] || 0);
    }
    const color = /^#[0-9a-fA-F]{6}$/.test(f.themeColor || '') ? f.themeColor : '#6D28D9';

    const work = path.join(jobsDir, job.id);
    const wwwUpload = path.join(work, 'upload');
    const proj = path.join(work, 'project');
    const www = path.join(proj, 'assets', 'www');
    fs.mkdirSync(www, { recursive: true });

    step('Recebendo seus arquivos…', 10);
    // monta os arquivos do site em wwwUpload
    fs.mkdirSync(wwwUpload, { recursive: true });
    const siteFiles = job.files.filter(x => x.field === 'siteFiles');
    const zipFile = job.files.find(x => x.field === 'zipFile');
    const htmlFile = job.files.find(x => x.field === 'htmlFile');

    if (f.mode === 'code') {
      if (!f.htmlCode || !f.htmlCode.trim()) throw new Error('Cole o código HTML antes de gerar.');
      fs.writeFileSync(path.join(wwwUpload, 'index.html'), f.htmlCode);
    } else if (zipFile) {
      const zp = path.join(work, 'site.zip');
      fs.writeFileSync(zp, zipFile.data);
      await run('unzip', ['-q', '-o', zp, '-d', wwwUpload]);
    } else if (htmlFile) {
      fs.writeFileSync(path.join(wwwUpload, 'index.html'), htmlFile.data);
    } else if (siteFiles.length) {
      for (const sf of siteFiles) {
        // filename pode vir como "pasta/sub/arquivo" (webkitRelativePath) — remove a 1ª pasta se houver index fora?
        const rel = sanitizeRel(sf.rel || sf.filename);
        if (!rel) continue;
        const dest = path.join(wwwUpload, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, sf.data);
      }
    } else throw new Error('Nenhum arquivo recebido. Envie um HTML, um ZIP ou uma pasta.');

    const indexRoot = findIndexRoot(wwwUpload);
    if (!indexRoot) throw new Error('Não encontrei um index.html nos arquivos enviados. Ele é a página inicial do app.');
    copyDir(indexRoot, www);
    const fileCount = (function count(d) { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? count(path.join(d, e.name)) : 1; return n; })(www);
    step(`${fileCount} arquivo(s) do site prontos (HTML/CSS/JS/WASM).`, 25);

    // ---- projeto Android ----
    step('Criando o projeto do app…', 35);
    const javaDir = path.join(proj, 'src', ...pkg.split('.'));
    fs.mkdirSync(javaDir, { recursive: true });
    fs.mkdirSync(path.join(proj, 'res'), { recursive: true });
    copyDir(path.join(ROOT, 'template', 'res'), path.join(proj, 'res'));

    let manifest = fs.readFileSync(path.join(ROOT, 'template', 'AndroidManifest.xml'), 'utf8')
      .replaceAll('__PACKAGE__', pkg).replaceAll('__VCODE__', versionCode).replaceAll('__VNAME__', escXml(versionName))
      .replaceAll('__APPNAME__', escXml(appName))
      .replaceAll('__PERMISSION__', f.internet === 'on' ? '<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />' : '')
      .replaceAll('__ORIENTATION__', f.orientation === 'landscape' ? 'landscape' : f.orientation === 'portrait' ? 'portrait' : 'unspecified');
    fs.writeFileSync(path.join(proj, 'AndroidManifest.xml'), manifest);

    let activity = fs.readFileSync(path.join(ROOT, 'template', 'MainActivity.java'), 'utf8')
      .replaceAll('__PACKAGE__', pkg).replaceAll('__COLOR__', color).replaceAll('__ZOOM__', f.zoom === 'on' ? 'true' : 'false');
    fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), activity);

    const colorsPath = path.join(proj, 'res', 'values', 'colors.xml');
    fs.writeFileSync(colorsPath, fs.readFileSync(colorsPath, 'utf8').replaceAll('__COLOR__', color));

    // ---- ícone ----
    step('Gerando o ícone do app…', 48);
    const iconFile = job.files.find(x => x.field === 'iconFile');
    let iconSrc = '';
    if (iconFile) { iconSrc = path.join(work, 'icon-source'); fs.writeFileSync(iconSrc, iconFile.data); }
    await run('python3', [path.join(ROOT, 'make_icon.py'), iconSrc, path.join(proj, 'res'), appName, color]);

    // ---- compilar ----
    await ensureKeystore();
    step('Compilando o aplicativo (isso leva alguns segundos)…', 62);
    const gen = path.join(proj, 'gen'), classes = path.join(proj, 'classes'), dexDir = path.join(proj, 'dex');
    fs.mkdirSync(gen, { recursive: true }); fs.mkdirSync(classes, { recursive: true }); fs.mkdirSync(dexDir, { recursive: true });
    await run(path.join(BT, 'aapt2'), ['compile', '--dir', path.join(proj, 'res'), '-o', path.join(proj, 'compiled.zip')]);
    await run(path.join(BT, 'aapt2'), ['link', '-o', path.join(proj, 'app-unsigned.apk'), '-I', ANDROID_JAR,
      '--manifest', path.join(proj, 'AndroidManifest.xml'), '-R', path.join(proj, 'compiled.zip'),
      '-A', path.join(proj, 'assets'), '--java', gen, '--auto-add-overlay']);

    const rJava = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.java')) rJava.push(p); } })(gen);
    await run(path.join(JAVA_HOME, 'bin', 'javac'), ['-source', '8', '-target', '8', '-bootclasspath', ANDROID_JAR, '-d', classes, path.join(javaDir, 'MainActivity.java'), ...rJava]);

    step('Empacotando e assinando o APK…', 82);
    await run(path.join(JAVA_HOME, 'bin', 'jar'), ['cf', path.join(proj, 'classes.jar'), '-C', classes, '.']);
    await run(path.join(BT, 'd8'), ['--release', '--output', dexDir, path.join(proj, 'classes.jar')]);
    fs.copyFileSync(path.join(proj, 'app-unsigned.apk'), path.join(proj, 'app-dex.apk'));
    await run('zip', ['-uj', path.join(proj, 'app-dex.apk'), path.join(dexDir, 'classes.dex')]);
    const safeName = appName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';
    const apkName = `${safeName}-v${versionName}.apk`;
    const finalApk = path.join(work, apkName);
    await run(path.join(BT, 'zipalign'), ['-f', '-p', '4', path.join(proj, 'app-dex.apk'), path.join(proj, 'app-aligned.apk')]);
    await run(path.join(BT, 'apksigner'), ['sign', '--ks', KEYSTORE, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', finalApk, path.join(proj, 'app-aligned.apk')]);
    await run(path.join(BT, 'apksigner'), ['verify', finalApk]);
    const { out: badging } = await run(path.join(BT, 'aapt2'), ['dump', 'badging', finalApk]);

    job.apkName = apkName;
    job.apkPath = finalApk;
    job.size = fs.statSync(finalApk).size;
    job.badging = badging.split('\n').slice(0, 3).join('\n');
    step('APK pronto! 🎉', 100);
    job.status = 'done';
  } catch (e) {
    job.status = 'error';
    job.error = String(e.message || e).slice(0, 4000);
    job.log.push('Erro: ' + job.error);
    console.error(`[${job.id}]`, job.error);
  }
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  // CORS — o site na Vercel (outro domínio) precisa chamar este backend
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(PUBLIC, 'index.html')));
  }
  if (req.method === 'GET' && url.pathname.startsWith('/static/')) {
    const p = path.join(PUBLIC, url.pathname.slice(8));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(p));
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: toolchainOk(), toolchain: toolchainOk() ? 'Android SDK 34 + JDK 17 prontos' : 'toolchain ausente — rode ./setup.sh' }));
  }
  if (req.method === 'POST' && url.pathname === '/api/build') {
    const ct = req.headers['content-type'] || '';
    const bMatch = /boundary=(.+)$/.exec(ct);
    if (!bMatch) { res.writeHead(400); return res.end('multipart esperado'); }
    const chunks = []; let total = 0;
    req.on('data', c => { total += c.length; if (total > 150 * 1024 * 1024) req.destroy(); chunks.push(c); });
    req.on('end', () => {
      try {
        const { fields, files } = parseMultipart(Buffer.concat(chunks), bMatch[1].trim());
        // relPaths vem como campo JSON: { "nomeOriginal": "pasta/sub/nome" }
        let relMap = {};
        try { relMap = JSON.parse(fields.relPaths || '{}'); } catch {}
        for (const fl of files) if (fl.field === 'siteFiles' && relMap[fl.filename]) fl.rel = relMap[fl.filename];
        const id = crypto.randomBytes(6).toString('hex');
        const job = { id, status: 'building', progress: 3, step: 'Na fila…', log: [], fields, files, createdAt: Date.now() };
        jobs.set(id, job);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jobId: id }));
        build(job);
      } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message || e) })); }
    });
    return;
  }
  const jobMatch = /^\/api\/job\/([a-f0-9]+)$/.exec(url.pathname);
  if (req.method === 'GET' && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"job não encontrado"}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: job.status, progress: job.progress, step: job.step, log: job.log, error: job.error || null,
      apkName: job.apkName || null, size: job.size || null, downloadUrl: job.status === 'done' ? `/api/download/${job.id}` : null }));
  }
  const dlMatch = /^\/api\/download\/([a-f0-9]+)$/.exec(url.pathname);
  if (req.method === 'GET' && dlMatch) {
    const job = jobs.get(dlMatch[1]);
    if (!job || job.status !== 'done' || !fs.existsSync(job.apkPath)) { res.writeHead(404); return res.end('APK não encontrado'); }
    res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': `attachment; filename="${job.apkName}"`, 'Content-Length': job.size });
    return fs.createReadStream(job.apkPath).pipe(res);
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => console.log(`Web2APK rodando em http://0.0.0.0:${PORT} | toolchain: ${toolchainOk() ? 'OK' : 'AUSENTE (rode ./setup.sh)'}`));
// limpeza de jobs antigos (>1h)
setInterval(() => { const now = Date.now(); for (const [id, j] of jobs) if (now - j.createdAt > 3600e3) { jobs.delete(id); fs.rmSync(path.join(jobsDir, id), { recursive: true, force: true }); } }, 600e3);
