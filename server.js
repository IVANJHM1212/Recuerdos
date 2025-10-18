// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || 'clave_super_secreta';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '1234';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const uploadDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.floor(Math.random() * 9000 + 1000);
        cb(null, unique + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

const db = new Database(path.join(DATA_DIR, 'db.sqlite'));
db.prepare(`CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  original_name TEXT,
  type TEXT,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

// Migración suave de columnas nuevas (si ya existía la tabla)
const cols = db.prepare("PRAGMA table_info(media)").all().map(c => c.name);
if (!cols.includes('title')) db.prepare("ALTER TABLE media ADD COLUMN title TEXT").run();
if (!cols.includes('description')) db.prepare("ALTER TABLE media ADD COLUMN description TEXT").run();
if (!cols.includes('event_date')) db.prepare("ALTER TABLE media ADD COLUMN event_date TEXT").run();

app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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

app.get('/access/:token', (req, res) => {
    const payload = verifyToken(req.params.token);
    if (!payload) return res.status(403).send('Token inválido o expirado');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/media', (req, res) => {
  const token = req.query.token || req.headers['x-access-token'];
  const payload = verifyToken(token);
  if (!payload) return res.status(403).json({error:'token inválido'});

  const rows = db.prepare(`
    SELECT id, filename, original_name, type, uploaded_at, title, description, event_date
    FROM media
    ORDER BY uploaded_at DESC
  `).all();
  rows.forEach(r => r.url = `/uploads/${r.filename}`);
  res.json(rows);
});

function adminAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) return res.status(401).set('WWW-Authenticate', 'Basic realm="Admin"').send('Auth required');
    const [user, pass] = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
    if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
    res.status(403).send('Forbidden');
}

app.post('/admin/upload', adminAuth, upload.single('media'), (req, res) => {
    if (!req.file) return res.status(400).send('file required');
    const type = req.file.mimetype.startsWith('video') ? 'video' : 'image';

    const title = (req.body.title || '').trim();
    const description = (req.body.description || '').trim();
    const event_date = (req.body.event_date || '').trim(); // formato yyyy-mm-dd desde <input type="date">

    db.prepare(`
    INSERT INTO media (filename, original_name, type, title, description, event_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.file.filename, req.file.originalname, type, title, description, event_date);

    res.json({ ok: true, url: `/uploads/${req.file.filename}` });
    console.log('upload meta →', { title, description, event_date, type: req.file.mimetype });

});


app.get('/create-token', (req, res) => {
    const token = createToken({ for: 'recuerdo' });
    res.json({ token, url: `${req.protocol}://${req.get('host')}/access/${token}` });
});

app.listen(PORT, () => console.log('✅ Servidor escuchando en puerto', PORT));
