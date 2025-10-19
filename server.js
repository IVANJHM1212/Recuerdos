// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const crypto = require('crypto');

const { DatabaseSync } = require('node:sqlite'); // módulo nativo (experimental)
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

const app = express();

// ---------- Config ----------
const PORT = process.env.PORT || 10000;

// Admin Basic Auth
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

// Token HMAC secret
const SECRET = process.env.SECRET || 'supersecret';

// Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key:    process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || ''
});

// Multer: memoria (no escribir a disco)
const storage = multer.memoryStorage();
const upload  = multer({ storage });

// ---------- DB (SQLite nativo Node) ----------
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const dbPath = path.join(__dirname, 'data', 'db.sqlite');
const db = new DatabaseSync(dbPath);

// Crear tabla si no existe
db.exec(`
  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    original_name TEXT,
    type TEXT,
    uploaded_at TEXT DEFAULT (datetime('now')),
    title TEXT,
    description TEXT,
    event_date TEXT
  );
`);

// Migraciones (agregar columnas si faltan)
try { db.exec(`ALTER TABLE media ADD COLUMN cloud_url TEXT;`); } catch {}
try { db.exec(`ALTER TABLE media ADD COLUMN cloud_id  TEXT;`); } catch {}

console.log(`✅ DB en ${dbPath}`);

// ---------- Utilidades de token (HMAC) ----------
function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function signToken(payloadObj) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payloadObj));
  const data = `${headerB64}.${payloadB64}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64')
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return `${data}.${sig}`;
}
function verifyToken(token) {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const data = `${h}.${p}`;
    const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64')
      .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    if (s !== expected) return null;
    const payload = JSON.parse(Buffer.from(p.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
    return payload;
  } catch {
    return null;
  }
}

// ---------- Middlewares ----------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Servir archivos estáticos del root (para css/imágenes si las hubiera)
app.use(express.static(__dirname));

// ---------- Auth básica ----------
function adminAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  if (!hdr.startsWith('Basic ')) return res.status(401).set('WWW-Authenticate','Basic').send('Auth required');

  const creds = Buffer.from(hdr.slice(6), 'base64').toString('utf8');
  const [user, pass] = creds.split(':');
  if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  return res.status(403).send('forbidden');
}

// ---------- Rutas de páginas ----------
app.get('/', (_, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin.html', (_, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Crear un link con token
app.get('/create-token', (req, res) => {
  const token = signToken({ fam: 'recuerdos', iat: Date.now() });
  const url = `${req.protocol}://${req.get('host')}/access/${token}`;
  res.type('text/plain').send(url);
});

// Ruta de acceso: deja el token en la URL (lo lee index.html del pathname)
app.get('/access/:token', (req, res) => {
  const payload = verifyToken(req.params.token);
  if (!payload) return res.status(403).send('token inválido');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------- Upload a Cloudinary ----------
app.post('/admin/upload', adminAuth, upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).send('file required');

  const mime = req.file.mimetype || '';
  const type = mime.startsWith('video') ? 'video' : 'image';

  const title       = (req.body.title || '').trim();
  const description = (req.body.description || '').trim();
  const event_date  = (req.body.event_date || '').trim();

  const opts = {
    folder: process.env.CLOUDINARY_FOLDER || 'recuerdos',
    resource_type: 'auto'
  };

  const stream = cloudinary.uploader.upload_stream(opts, (err, result) => {
    if (err) {
      console.error('Cloudinary error:', err);
      return res.status(500).json({ error: 'upload failed' });
    }

    const stmt = db.prepare(`
      INSERT INTO media (filename, original_name, type, title, description, event_date, cloud_url, cloud_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      '', // filename local vacío (ya no usamos disco)
      req.file.originalname || '',
      type,
      title,
      description,
      event_date,
      result.secure_url || '',
      result.public_id  || ''
    );

    console.log('📤 Subido a Cloudinary:', { type, url: result.secure_url, id: result.public_id });
    res.json({ ok: true, url: result.secure_url });
  });

  stream.end(req.file.buffer);
});

// ---------- API media (requiere token) ----------
app.get('/api/media', (req, res) => {
  const token = req.query.token || req.headers['x-access-token'] || '';
  const payload = verifyToken(token);
  if (!payload) return res.status(403).json({ error: 'token inválido' });

  const rows = db.prepare(`
    SELECT id, filename, original_name, type, uploaded_at, title, description, event_date, cloud_url
    FROM media
    ORDER BY uploaded_at DESC
  `).all();

  const mapped = rows.map(r => {
    const url = r.cloud_url && r.cloud_url.startsWith('http')
      ? r.cloud_url
      : (r.filename ? `/uploads/${r.filename}` : '');
    return { ...r, url };
  });

  res.json(mapped);
});

// ---------- Arranque ----------
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
