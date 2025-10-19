require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sqlite3 = require('node:sqlite');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 10000;

// ==== CONFIGURACIÓN CLOUDINARY ====
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ==== BASE DE DATOS ====
const dbPath = path.join(__dirname, 'data', 'db.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

let db;
(async () => {
  db = await sqlite3.open(dbPath);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      event_date TEXT,
      type TEXT,
      url TEXT
    )
  `);
  console.log(`✅ DB en ${dbPath}`);
})();

// ==== CONFIGURACIÓN DE ARCHIVOS ====
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==== MULTER PARA SUBIDAS ====
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// ==== TOKENS JWT ====
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

function createAccessToken(data = {}) {
  return jwt.sign(data, JWT_SECRET, { expiresIn: '7d' });
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ==== RUTAS HTML ====
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/admin.html', (_req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

app.get('/access/:token', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/create-token', (req, res) => {
  const token = createAccessToken({ by: 'admin' });
  const url = `${req.protocol}://${req.get('host')}/access/${token}`;
  res.type('text').send(url);
});

// ==== API: Obtener medios ====
app.get('/api/media', async (req, res) => {
  const token = req.query.token;
  const valid = verifyAccessToken(token);
  if (!valid) return res.status(401).json({ error: 'Token inválido o expirado' });

  const rows = await db.all('SELECT * FROM media ORDER BY event_date DESC');
  res.json(rows);
});

// ==== ADMIN: Subir nuevo recuerdo ====
app.post('/admin/upload', upload.single('file'), async (req, res) => {
  const { title, description, event_date } = req.body;
  const file = req.file;

  if (!file) return res.status(400).json({ error: 'Archivo requerido' });

  try {
    const uploadResult = await cloudinary.uploader.upload(file.path, { folder: 'recuerdos' });

    await db.run(
      'INSERT INTO media (title, description, event_date, type, url) VALUES (?, ?, ?, ?, ?)',
      [title, description, event_date, 'image', uploadResult.secure_url]
    );

    console.log('📤 Subido:', { title, event_date });
    res.redirect('/admin.html');
  } catch (error) {
    console.error('❌ Error al subir:', error);
    res.status(500).json({ error: 'Error al subir archivo' });
  }
});

// ==== INICIO DEL SERVIDOR ====
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
