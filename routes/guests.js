const express = require('express');
const { dbAll, dbGet, dbRun } = require('../models/database');
const router = express.Router();

router.get('/', (req, res) => {
  const search = req.query.search || '';
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  let huespedes, total;
  if (search) {
    const q = `%${search}%`;
    huespedes = dbAll(`
      SELECT * FROM huespedes
      WHERE nombre LIKE ? OR apellido LIKE ? OR numero_cedula LIKE ? OR email LIKE ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `, [q, q, q, q, limit, offset]);
    total = dbGet(`
      SELECT COUNT(*) as count FROM huespedes
      WHERE nombre LIKE ? OR apellido LIKE ? OR numero_cedula LIKE ? OR email LIKE ?
    `, [q, q, q, q]);
  } else {
    huespedes = dbAll('SELECT * FROM huespedes ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    total = dbGet('SELECT COUNT(*) as count FROM huespedes');
  }

  res.render('huespedes/index', { huespedes, search, page, totalPages: Math.ceil(total.count / limit), total: total.count });
});

router.get('/nuevo', (req, res) => {
  res.render('huespedes/nuevo', { huesped: null, error: null });
});

router.post('/nuevo', (req, res) => {
  const { nombre, apellido, numero_cedula, fecha_nacimiento, lugar_nacimiento, sexo, grupo_sanguineo, estatura, fecha_expedicion, lugar_expedicion, email, telefono, direccion } = req.body;

  if (!nombre || !apellido || !numero_cedula) {
    return res.render('huespedes/nuevo', { huesped: req.body, error: 'Nombre, apellido y cédula son obligatorios' });
  }

  const existing = dbGet('SELECT id FROM huespedes WHERE numero_cedula = ?', [numero_cedula]);
  if (existing) {
    return res.render('huespedes/nuevo', { huesped: req.body, error: 'Ya existe un huésped con esta cédula' });
  }

  const result = dbRun(`
    INSERT INTO huespedes (nombre, apellido, numero_cedula, fecha_nacimiento, lugar_nacimiento, sexo, grupo_sanguineo, estatura, fecha_expedicion, lugar_expedicion, email, telefono, direccion)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [nombre, apellido, numero_cedula, fecha_nacimiento, lugar_nacimiento, sexo, grupo_sanguineo, estatura, fecha_expedicion, lugar_expedicion, email, telefono, direccion]);

  res.redirect(`/huespedes/${result.lastInsertRowid}`);
});

router.get('/:id', (req, res) => {
  const huesped = dbGet('SELECT * FROM huespedes WHERE id = ?', [req.params.id]);
  if (!huesped) return res.redirect('/huespedes');
  const reservas = dbAll(`
    SELECT r.*, ha.numero as hab_numero, ha.tipo as hab_tipo
    FROM reservas r JOIN habitaciones ha ON r.habitacion_id = ha.id
    WHERE r.huesped_id = ? ORDER BY r.created_at DESC
  `, [req.params.id]);
  res.render('huespedes/detalle', { huesped, reservas });
});

router.get('/:id/editar', (req, res) => {
  const huesped = dbGet('SELECT * FROM huespedes WHERE id = ?', [req.params.id]);
  if (!huesped) return res.redirect('/huespedes');
  res.render('huespedes/nuevo', { huesped, error: null });
});

router.post('/:id/editar', (req, res) => {
  const { nombre, apellido, numero_cedula, fecha_nacimiento, lugar_nacimiento, sexo, grupo_sanguineo, estatura, fecha_expedicion, lugar_expedicion, email, telefono, direccion } = req.body;
  if (!nombre || !apellido || !numero_cedula) {
    const huesped = { id: req.params.id, ...req.body };
    return res.render('huespedes/nuevo', { huesped, error: 'Nombre, apellido y cédula son obligatorios' });
  }
  dbRun(`
    UPDATE huespedes SET nombre=?, apellido=?, numero_cedula=?, fecha_nacimiento=?, lugar_nacimiento=?, sexo=?,
    grupo_sanguineo=?, estatura=?, fecha_expedicion=?, lugar_expedicion=?, email=?, telefono=?, direccion=?,
    updated_at=CURRENT_TIMESTAMP WHERE id=?
  `, [nombre, apellido, numero_cedula, fecha_nacimiento, lugar_nacimiento, sexo, grupo_sanguineo, estatura, fecha_expedicion, lugar_expedicion, email, telefono, direccion, req.params.id]);
  res.redirect(`/huespedes/${req.params.id}`);
});

router.post('/:id/eliminar', (req, res) => {
  const reservas = dbGet('SELECT COUNT(*) as count FROM reservas WHERE huesped_id = ?', [req.params.id]);
  if (reservas.count > 0) return res.redirect(`/huespedes/${req.params.id}?error=Tiene reservas asociadas`);
  dbRun('DELETE FROM huespedes WHERE id = ?', [req.params.id]);
  res.redirect('/huespedes');
});

module.exports = router;
