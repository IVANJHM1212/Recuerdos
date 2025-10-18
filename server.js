// server.js
// ===================== Setup básico =====================
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

// ===================== Base de datos (node:sqlite) =====================
// Usamos la API experimental sin dependencias extra.
// Si prefieres better-sqlite3, avisa y te paso la variante.
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'db.sqlite');
const db = new DatabaseSync(DB_PATH);
console.log('✅ DB en', DB_PATH);

// Crea tabla (con columnas cloud_* ya incluidas para instalaciones nuevas)
db.exec(`
  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    original_name TEXT,
    type TEXT,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    title TEXT,
    description TEXT,
    event_date TEXT,
    cloud_url TEXT,
    cloud_id  TEXT
  );
`);

// Si vienes de una tabla vieja, intenta añadir columnas (ignora error si existen)
try { db.exec(`ALTER TABLE media ADD COLUMN cloud_url TEXT;`); } catch { }
try { db.exec(`ALTER TABLE media ADD COLUMN cloud_id  TEXT;`); } catch { }

// ===================== Express =====================
const app = express();
const PORT = process.env.PORT || 10000;

// (opcional) sirve archivos estáticos si los tienes en carpeta /public
// Si index.html y admin.html están en la raíz del repo, los servimos más abajo con sendFile.

// ===================== Cloudinary =====================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ===================== Multer (memoria) =====================
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ===================== Auth helpers =====================
// Basic Auth para admin
function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="admin"');
    return res.status(401).send('auth required');
  }
  const [user, pass] = Buffer.from(header.slice(6), 'base64').toString().split(':');
  const AU = process.env.ADMIN_USER || 'admin';
  const AP = process.env.ADMIN_PASS || 'admin';
  if (user === AU && pass === AP) return next();
  return res.status(403).send('forbidden');
}

// Verificación de token para ver la galería
function verifyToken(token) {
  const required = process.env.SECRET_TOKEN; // si existe, debe coincidir
  if (required) return token === required ? { ok: true } : null;
  // si no definiste SECRET_TOKEN, acepta tokens no vacíos (como en tu front)
  return token && token.length >= 10 ? { ok: true } : null;
}

// ===================== Rutas de páginas =====================
// ====== Rutas de páginas y estáticos (robustas) ======
const CANDIDATE_STATIC_DIRS = [
  path.join(__dirname),
  path.join(__dirname, 'public'),
  path.join(__dirname, 'static')
];

// monta estáticos para cada carpeta que exista
for (const dir of CANDIDATE_STATIC_DIRS) {
  if (fs.existsSync(dir)) {
    app.use(express.static(dir));
  }
}

// helper para resolver el primer archivo existente
function resolvePage(filename) {
  for (const dir of CANDIDATE_STATIC_DIRS) {
    const p = path.join(dir, filename);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Home
app.get('/', (req, res) => {
  const file = resolvePage('index.html');
  if (!file) return res.status(404).send('index.html no encontrado (colócalo en /, /public o /static)');
  res.sendFile(file);
});

// Admin
app.get('/admin', (req, res) => {
  const file = resolvePage('admin.html');
  if (!file) return res.status(404).send('admin.html no encontrado (colócalo en /, /public o /static)');
  res.sendFile(file);
});

// ===================== API =====================
// Subida a Cloudinary (imagen o video) usando stream
app.post('/admin/upload', adminAuth, upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).send('file required');

  const mime = req.file.mimetype || '';
  const type = mime.startsWith('video') ? 'video' : 'image';

  const title = (req.body.title || '').trim();
  const description = (req.body.description || '').trim();
  const event_date = (req.body.event_date || '').trim();

  // Carpeta opcional
  const folder = process.env.CLOUDINARY_FOLDER || 'recuerdos';

  const opts = {
    folder,
    resource_type: 'auto' // auto detecta imagen/video
  };

  const stream = cloudinary.uploader.upload_stream(opts, (err, result) => {
    if (err) {
      console.error('Cloudinary error:', err);
      return res.status(500).json({ error: 'upload failed' });
    }

    // Guarda registro en DB
    const insert = db.prepare(`
      INSERT INTO media (filename, original_name, type, title, description, event_date, cloud_url, cloud_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      '',                        // filename vacío (ya no usamos disco local)
      req.file.originalname || '',
      type,
      title,
      description,
      event_date,
      result.secure_url,
      result.public_id
    );

    console.log('📤 Subido a Cloudinary:', { type, url: result.secure_url, id: result.public_id });
    res.json({ ok: true, url: result.secure_url });
  });

  // envía el buffer al stream
  stream.end(req.file.buffer);
});

// Lista de media (prioriza cloud_url)
app.get('/api/media', (req, res) => {
  const token = req.query.token || req.headers['x-access-token'];
  const payload = verifyToken(token);
  if (!payload) return res.status(403).json({ error: 'token inválido' });

  const stmt = db.prepare(`
    SELECT id, filename, original_name, type, uploaded_at, title, description, event_date, cloud_url
    FROM media
    ORDER BY uploaded_at DESC
  `);
  const rows = stmt.all().map(r => {
    const url = (r.cloud_url && r.cloud_url.startsWith('http'))
      ? r.cloud_url
      : (r.filename ? `/uploads/${r.filename}` : '');
    return { ...r, url };
  });
  res.json(rows);
});

// (opcional) healthcheck
app.get('/api/ping', (_req, res) => res.json({ pong: true }));

// ===================== Arranque =====================
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
