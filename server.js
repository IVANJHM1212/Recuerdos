// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || 'clave_super_secreta';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '1234';

// === Directorios ===
const DATA_DIR = process.env.DATA_DIR || '/tmp/data';
const uploadDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// === Configuración de subida de archivos ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.floor(Math.random() * 9000 + 1000);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// === Base de datos SQLite ===
const dbPath = path.join(DATA_DIR, 'db.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Error al abrir la base de datos:', err);
  else console.log('✅ Base de datos conectada en', dbPath);
});

// Crear tabla si no existe
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT,
      type TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      title TEXT,
      description TEXT,
      event_date TEXT
    )
  `);
});

// === Middleware estático ===
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// === Token simple firmado ===
function createToken(payloadObj, expiresInSeconds = 60 * 60 * 24 * 30) {
  const payload = {
    ...payloadObj,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  };
  const payloadStr = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('base64url');
  const token = Buffer.from(payloadStr).toString('base64url') + '.' + signature;
  return token;
}

function verifyToken(token) {
  try {
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return null;
    const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const expected = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('base64url');
    if (expected !== sig) return null;
    const payload = JSON.parse(payloadStr);
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// === Rutas ===

// Acceso público
app.get('/access/:token', (req, res) => {
  const payload = verifyToken(req.params.token);
  if (!payload) return res.status(403).send('Para ver los recuerdos debes escanear el código 📷');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API de medios
app.get('/api/media', (req, res) => {
  const token = req.query.token || req.headers['x-access-token'];
  const payload = verifyToken(token);
  if (!payload) return res.status(403).json({ error: 'token inválido' });

  db.all(
    `SELECT id, filename, original_name, type, uploaded_at, title, description, event_date
     FROM media ORDER BY uploaded_at DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      rows.forEach(r => r.url = `/uploads/${r.filename}`);
      res.json(rows);
    }
  );
});

// Auth básica para panel admin
function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic '))
    return res.status(401).set('WWW-Authenticate', 'Basic realm="Admin"').send('Auth required');
  const [user, pass] = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
  if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  res.status(403).send('Forbidden');
}

// Subida de archivos
app.post('/admin/upload', adminAuth, upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).send('file required');
  const type = req.file.mimetype.startsWith('video') ? 'video' : 'image';

  const title = (req.body.title || '').trim();
  const description = (req.body.description || '').trim();
  const event_date = (req.body.event_date || '').trim();

  db.run(
    `INSERT INTO media (filename, original_name, type, title, description, event_date)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.file.filename, req.file.originalname, type, title, description, event_date],
    (err) => {
      if (err) return res.status(500).json({ error: 'DB insert failed' });
      console.log('📤 Subido:', { title, description, event_date });
      res.json({ ok: true, url: `/uploads/${req.file.filename}` });
    }
  );
});

// Crear token
app.get('/create-token', (req, res) => {
  const token = createToken({ for: 'recuerdo' });
  res.json({ token, url: `${req.protocol}://${req.get('host')}/access/${token}` });
});

app.listen(PORT, () => console.log('🚀 Servidor escuchando en puerto', PORT));
