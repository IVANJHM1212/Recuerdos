// server.js
require('dotenv').config();

const path        = require('path');
const fs          = require('fs');
const express     = require('express');
const multer      = require('multer');
const cloudinary  = require('cloudinary').v2;
const crypto      = require('crypto');

// ==== Express base ====
const app  = express();
const PORT = process.env.PORT || 10000;

// ==== Archivos estáticos ====
// sirve index.html y admin.html desde el directorio raíz del repo
app.use(express.static(__dirname, { extensions: ['html'] }));

// ==== SQLite (better-sqlite3, síncrono y estable) ====
// Si no la tienes en package.json, añade:  "better-sqlite3": "^9.6.0"
const Database = require('better-sqlite3');
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH  = path.join(DATA_DIR, 'db.sqlite');
const db = new Database(DB_PATH);
console.log(`✅ DB en ${DB_PATH}`);

// crea tabla si no existe
db.exec(`
  CREATE TABLE IF NOT EXISTS media (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    filename      TEXT,
    original_name TEXT,
    type          TEXT CHECK(type IN ('image','video')) NOT NULL,
    uploaded_at   TEXT DEFAULT (datetime('now')),
    title         TEXT,
    description   TEXT,
    event_date    TEXT,
    cloud_url     TEXT,
    cloud_id      TEXT
  )
`);

// ==== Migración segura (agrega columnas si faltan) ====
try { db.exec(`ALTER TABLE media ADD COLUMN cloud_url TEXT;`); } catch {}
try { db.exec(`ALTER TABLE media ADD COLUMN cloud_id  TEXT;`); } catch {}

// ==== Auth admin básica ====
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
function adminAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  if (!hdr.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="admin"');
    return res.status(401).send('auth required');
  }
  const [user, pass] = Buffer.from(hdr.slice(6), 'base64').toString().split(':');
  if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  res.set('WWW-Authenticate', 'Basic realm="admin"');
  return res.status(401).send('invalid credentials');
}

// ==== Tokens de acceso (HMAC simple) ====
const ACCESS_SECRET = process.env.ACCESS_SECRET || 'cambia-esto';
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', ACCESS_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expSig = crypto.createHmac('sha256', ACCESS_SECRET).update(body).digest('base64url');
  if (sig !== expSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload;
  } catch { return null; }
}

// Ruta para crear un token rápido (útil para pruebas)
// GET /create-token  -> devuelve URL /access/<token>
app.get('/create-token', (req, res) => {
  const token = signToken({ created_at: Date.now() });
  const url   = `${req.protocol}://${req.get('host')}/access/${token}`;
  res.type('text').send(url);
});

// ==== Cloudinary ====
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// carpeta opcional (si no existe, Cloudinary la crea automáticamente)
const CLOUD_FOLDER = process.env.CLOUDINARY_FOLDER || 'recuerdos';

// ==== Multer en memoria ====
const upload = multer({ storage: multer.memoryStorage() });

// ==== Subida admin -> Cloudinary ====
app.post('/admin/upload', adminAuth, upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).send('file required');

  const mime = req.file.mimetype || '';
  const type = mime.startsWith('video') ? 'video' : 'image';

  const title       = (req.body.title || '').trim();
  const description = (req.body.description || '').trim();
  const event_date  = (req.body.event_date || '').trim();

  const opts = { folder: CLOUD_FOLDER, resource_type: 'auto' };

  const stream = cloudinary.uploader.upload_stream(opts, (err, result) => {
    if (err) {
      console.error('Cloudinary error:', err);
      return res.status(500).json({ error: 'upload failed' });
    }

    const insert = db.prepare(`
      INSERT INTO media (filename, original_name, type, title, description, event_date, cloud_url, cloud_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      '',                              // ya no guardamos local
      req.file.originalname || '',
      type,
      title,
      description,
      event_date,
      result.secure_url,
      result.public_id
    );

    console.log('📤 Subido a Cloudinary:', { title, event_date, type });
    res.json({ ok: true, url: result.secure_url });
  });

  stream.end(req.file.buffer);
});

// ==== API pública de media (requiere token) ====
app.get('/api/media', (req, res) => {
  const token   = req.query.token || req.headers['x-access-token'];
  const payload = verifyToken(token);
  if (!payload) return res.status(403).json({ error: 'token inválido' });

  const rows = db.prepare(`
    SELECT id, filename, original_name, type, uploaded_at, title, description, event_date, cloud_url
    FROM media
    ORDER BY uploaded_at DESC
  `).all().map(r => {
    const url = r.cloud_url && r.cloud_url.startsWith('http')
      ? r.cloud_url
      : (r.filename ? `/uploads/${r.filename}` : '');
    return { ...r, url };
  });

  res.json(rows);
});

// ==== Rutas que sirven index.html y soportan /access/<token> ====
// / -> index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// /access/:token -> sirve index.html (el front lee el token del segmento de la URL)
app.get('/access/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// fallback útil para SPA si quieres que todo lo no reconocido
// caiga en index.html (opcional):
// app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ==== Start ====
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
