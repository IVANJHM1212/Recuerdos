// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 10000;

// ---------- Cloudinary ----------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ---------- Paths / estáticos ----------
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- DB (better-sqlite3, síncrono y estable) ----------
const dbPath = path.join(DATA_DIR, 'db.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT,
    event_date TEXT,
    type TEXT,
    url TEXT,
    uploaded_at TEXT DEFAULT (datetime('now'))
  );
`);
console.log(`✅ DB en ${dbPath}`);

// ---------- JWT ----------
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

const signToken = (payload = {}) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

const verifyToken = (t) => {
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
};

// ---------- Multer (campo 'media' desde admin.html) ----------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, Date.now() + '-' + (file.originalname || 'file'))
});
const upload = multer({ storage });

// ---------- Rutas HTML ----------
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/admin.html', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/access/:token', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// Genera URL con token
app.get('/create-token', (req, res) => {
  const token = signToken({ role: 'viewer' });
  const url = `${req.protocol}://${req.get('host')}/access/${token}`;
  res.type('text').send(url);
});

// ---------- API: listar media (requiere token) ----------
app.get('/api/media', (req, res) => {
  const token = req.query.token;
  if (!verifyToken(token)) return res.status(401).json({ error: 'Token inválido o faltante' });

  const rows = db.prepare(`
    SELECT id, title, description, event_date, type, url, uploaded_at
    FROM media
    ORDER BY uploaded_at DESC
  `).all();

  res.json(rows);
});

// ---------- ADMIN: subir a Cloudinary (acepta imagen/video) ----------
app.post('/admin/upload', upload.single('media'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

    const title = (req.body.title || '').trim();
    const description = (req.body.description || '').trim();
    const event_date = (req.body.event_date || '').trim();

    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: process.env.CLOUDINARY_FOLDER || 'recuerdos',
      resource_type: 'auto' // detecta image|video
    });

    const type = (result.resource_type === 'video') ? 'video' : 'image';

    db.prepare(`
      INSERT INTO media (title, description, event_date, type, url)
      VALUES (?, ?, ?, ?, ?)
    `).run(title, description, event_date, type, result.secure_url);

    console.log('📤 Subido:', { title, event_date, type });
    res.redirect('/admin.html');
  } catch (err) {
    console.error('❌ Error al subir:', err);
    res.status(500).json({ error: 'Error al subir archivo' });
  }
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
