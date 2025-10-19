require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// --- App / Puerto
const app = express();
const PORT = process.env.PORT || 10000;

// --- Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- Estaticos
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- DB (sqlite experimental de Node 20+)
const sqlite = require('node:sqlite'); // viene con Node 20+ (experimental)
const dbFile = path.join(__dirname, 'data', 'db.sqlite');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

let db;
(async () => {
  db = await sqlite.open(dbFile);
  await db.exec(`
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
  console.log(`✅ DB en ${dbFile}`);
})();

// --- Multer (disco)  NOTE: el input del form se llama 'media'
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + (file.originalname || 'file'));
  }
});
const upload = multer({ storage });

// --- JWT util
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

function signToken(payload = {}) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}
function verifyToken(t) {
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
}

// --- Rutas HTML
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/admin.html', (_req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/access/:token', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// Genera un enlace con token
app.get('/create-token', (req, res) => {
  const token = signToken({ from: 'admin' });
  const url = `${req.protocol}://${req.get('host')}/access/${token}`;
  res.type('text').send(url);
});

// --- API: lista de medios
app.get('/api/media', async (req, res) => {
  const token = req.query.token;
  if (!verifyToken(token)) return res.status(401).json({ error: 'Token inválido o faltante' });

  const rows = await db.all(`
    SELECT id, title, description, event_date, type, url, uploaded_at
    FROM media
    ORDER BY uploaded_at DESC
  `);
  res.json(rows);
});

// --- ADMIN: subida (campo 'media' desde admin.html)
app.post('/admin/upload', upload.single('media'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

    const { title = '', description = '', event_date = '' } = req.body;

    // Sube a Cloudinary (auto: imagen o video)
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: process.env.CLOUDINARY_FOLDER || 'recuerdos',
      resource_type: 'auto'
    });

    const type = (result.resource_type === 'video') ? 'video' : 'image';

    await db.run(
      `INSERT INTO media (title, description, event_date, type, url)
       VALUES (?, ?, ?, ?, ?)`,
      [title.trim(), description.trim(), event_date.trim(), type, result.secure_url]
    );

    console.log('📤 Subido:', { title, event_date, type });
    res.redirect('/admin.html');
  } catch (err) {
    console.error('❌ Error al subir:', err);
    res.status(500).json({ error: 'Error al subir archivo' });
  }
});

// --- Inicio
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
