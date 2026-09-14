const express = require('express');
const { dbAll, dbGet, dbRun } = require('../models/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { extraerDatosCedula } = require('./cedulaOCR');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    cb(null, `cedula_${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Endpoints ───

router.post('/buscar-huesped', (req, res) => {
  const { q } = req.body;
  if (!q || q.length < 3) return res.json([]);
  const query = `%${q}%`;
  const huespedes = dbAll(`
    SELECT id, nombre, apellido, numero_cedula FROM huespedes
    WHERE nombre LIKE ? OR apellido LIKE ? OR numero_cedula LIKE ? LIMIT 20
  `, [query, query, query]);
  res.json(huespedes);
});

// Búsqueda exacta por cédula: usada por el check-in exprés para saber, apenas se
// lee la cédula, si el huésped ya está registrado y así evitar volver a digitarlo.
router.get('/huesped-por-cedula/:cedula', (req, res) => {
  const cedula = (req.params.cedula || '').replace(/\D/g, '');
  if (!cedula) return res.json({ existe: false });
  const huesped = dbGet('SELECT * FROM huespedes WHERE numero_cedula = ?', [cedula]);
  res.json({ existe: !!huesped, huesped: huesped || null });
});

router.get('/habitaciones-disponibles', (req, res) => {
  const { fecha_entrada, fecha_salida, tipo } = req.query;
  if (!fecha_entrada || !fecha_salida) return res.json([]);

  let sql = `
    SELECT * FROM habitaciones WHERE estado IN ('disponible','reservada')
    AND id NOT IN (
      SELECT habitacion_id FROM reservas
      WHERE estado IN ('confirmada','checkin')
      AND ((fecha_entrada <= ? AND fecha_salida > ?) OR (fecha_entrada < ? AND fecha_salida >= ?))
    )
  `;
  const params = [fecha_entrada, fecha_entrada, fecha_salida, fecha_salida];
  if (tipo && tipo !== '') { sql += ' AND tipo = ?'; params.push(tipo); }
  sql += ' ORDER BY numero ASC';

  const habitaciones = dbAll(sql, params);
  res.json(habitaciones);
});

router.post('/ocr/upload', upload.single('imagen'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ninguna imagen' });
  res.json({ file: `/uploads/${req.file.filename}`, message: 'Imagen recibida. Sugerencia: use buena iluminación, superficie plana, sin reflejos.' });
});

router.post('/extraer-datos', async (req, res) => {
  const { imagePath, lado } = req.body;
  if (!imagePath) return res.status(400).json({ error: 'Ruta de imagen requerida' });
  if (lado !== 'frente' && lado !== 'reverso') return res.status(400).json({ error: 'Parámetro "lado" debe ser "frente" o "reverso"' });

  const fullPath = path.join(__dirname, '..', 'public', imagePath);
  if (!fs.existsSync(fullPath)) return res.status(400).json({ error: 'Archivo no encontrado' });

  try {
    const resultado = await extraerDatosCedula(fullPath, lado);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: 'Error procesando OCR: ' + err.message });
  }
});

router.get('/ocupacion', (req, res) => {
  const ocupacion = dbAll(`
    SELECT ha.tipo, COUNT(*) as total,
      SUM(CASE WHEN ha.estado = 'ocupado' THEN 1 ELSE 0 END) as ocupadas,
      SUM(CASE WHEN ha.estado = 'reservada' THEN 1 ELSE 0 END) as reservadas
    FROM habitaciones ha GROUP BY ha.tipo
  `);
  res.json(ocupacion);
});

router.get('/ingresos-mensuales', (req, res) => {
  const data = dbAll(`
    SELECT strftime('%Y-%m', fecha_emision) as mes, SUM(total) as total
    FROM facturas WHERE estado = 'pagada' AND date(fecha_emision) >= date('now', '-12 months')
    GROUP BY mes ORDER BY mes ASC
  `);
  res.json(data);
});

module.exports = router;
