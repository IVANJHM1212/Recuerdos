// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const basicAuth = require('basic-auth');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const Database = require('better-sqlite3');

// ====== Config básica ======
const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || 'supersecret';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.sqlite');

// ====== DB (better-sqlite3) ======
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    original_name TEXT,
    type TEXT CHECK(type IN ('image','video')),
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    title TEXT,
    description TEXT,
    event_date TEXT,
    cloud_url TEXT,
    cloud_id  TEXT
  )
`);
console.log(`✅ DB en ${DB_FILE}`);

// ====== Cloudinary ======
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ====== Middlewares ======
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer en memoria
const storage = multer.memoryStorage();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// ====== Helpers ======
function adminAuth(req, res, next) {
  const user = basicAuth(req);
  const ok = user
    && user.name === (process.env.ADMIN_USER || 'admin')
    && user.pass === (process.env.ADMIN_PASS || 'admin');
  if (!ok) {
    res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Auth required');
  }
  next();
}

function createToken(payload, expires = '90d') {
  return jwt.sign(payload, SECRET, { expiresIn: expires });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

// ====== RUTAS API (antes del estático) ======

// Crear token “rápido” para pruebas (dev tool)
app.get('/create-token', adminAuth, (req, res) => {
  const token = createToken({ memo: 'qr-memories' });
  const url = `${req.protocol}://${req.get('host')}/access/${token}`;
  res.json({ token, url });
});

// Página de acceso que deja el token en la URL (el frontend lo lee)
app.get('/access/:token', (req, res) => {
  // sirve el mismo index.html (el front toma el token del pathname)
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Subida a Cloudinary
app.post('/admin/upload', adminAuth, upload.single('media'), (req, res) => {
  res.type('application/json; charset=utf-8');

  (async () => {
    if (!req.file) {
      return res.status(400).json({ error: 'file required' });
    }

    const mime = req.file.mimetype || '';
    const type = mime.startsWith('video') ? 'video' : 'image';

    const title = (req.body.title || '').trim();
    const description = (req.body.description || '').trim();
    const event_date = (req.body.event_date || '').trim();

    const opts = {
      folder: process.env.CLOUDINARY_FOLDER || 'recuerdos',
      resource_type: 'auto'
    };

    // Promisifica upload_stream para poder usar await
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(opts, (err, resu) => {
        if (err) return reject(err);
        resolve(resu);
      });
      stream.end(req.file.buffer);
    });

    const insert = db.prepare(`
      INSERT INTO media (filename, original_name, type, title, description, event_date, cloud_url, cloud_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      '',
      req.file.originalname || '',
      type,
      title,
      description,
      event_date,
      result.secure_url,
      result.public_id
    );

    console.log('📤 Subido:', { title, event_date, type });
    return res.status(200).json({ ok: true, url: result.secure_url });
  })().catch(err => {
    console.error('❌ Error al subir:', err);
    // devuelve SIEMPRE JSON
    const code = (err && err.http_code) || 500;
    res.status(code).json({
      error: 'upload failed',
      detail: err && (err.message || err.name || String(err))
    });
  });
});

// Listado para la galería (requiere token)
app.get('/api/media', (req, res) => {
  const token = req.query.token || req.headers['x-access-token'];
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

  console.log('📦 /api/media ->', rows.length, 'items');
  res.json(rows);
});


// ====== Archivos estáticos ======
app.use(express.static(path.join(__dirname, 'public')));

// ====== Catch-all SOLO para GET (evita capturar POST/PUT, etc.) ======
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ====== Start ======
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
