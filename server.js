// arriba de todo
const cloudinary = require('cloudinary').v2;

// …tus const PORT, SECRET, etc…

// Cloudinary config (desde variables de entorno)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ===== Multer en memoria (no escribir a disco) =====
const storage = multer.memoryStorage();
const upload  = multer({ storage });

// ===== Migración de columnas para Cloudinary =====
// (si ya creaste la tabla antes)
db.exec(`
  ALTER TABLE media ADD COLUMN cloud_url TEXT;
`);
db.exec(`
  ALTER TABLE media ADD COLUMN cloud_id  TEXT;
`);
// Nota: si las columnas ya existen, estas sentencias pueden fallar una vez.
// No pasa nada; si prefieres hacerlo sin errores, envuélvelo en try/catch.

// ===== /admin/upload: subir a Cloudinary =====
app.post('/admin/upload', adminAuth, upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).send('file required');

  // Detecta tipo
  const mime = req.file.mimetype || '';
  const type = mime.startsWith('video') ? 'video' : 'image';

  const title       = (req.body.title || '').trim();
  const description = (req.body.description || '').trim();
  const event_date  = (req.body.event_date || '').trim();

  // Subir mediante stream para no escribir a disco
  const opts = {
    folder: process.env.CLOUDINARY_FOLDER || 'recuerdos',
    resource_type: 'auto' // auto = imagen o video
  };

  const stream = cloudinary.uploader.upload_stream(opts, (err, result) => {
    if (err) {
      console.error('Cloudinary error:', err);
      return res.status(500).json({ error: 'upload failed' });
    }

    // result.secure_url -> URL público
    // result.public_id  -> id para borrar en el futuro si lo necesitas
    const insert = db.prepare(`
      INSERT INTO media (filename, original_name, type, title, description, event_date, cloud_url, cloud_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      '',                        // filename vacío (ya no usamos archivos locales)
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

  // enviar el buffer a Cloudinary
  stream.end(req.file.buffer);
});

// ===== /api/media: prioriza Cloudinary =====
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
    const url = r.cloud_url && r.cloud_url.startsWith('http')
      ? r.cloud_url
      : (r.filename ? `/uploads/${r.filename}` : '');
    return { ...r, url };
  });
  res.json(rows);
});
