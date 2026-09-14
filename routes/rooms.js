const express = require('express');
const { dbAll, dbGet, dbRun } = require('../models/database');
const { body, validationResult } = require('express-validator');
const router = express.Router();

router.get('/', (req, res) => {
  const { tipo, estado, precio_min, precio_max } = req.query;
  let sql = 'SELECT * FROM habitaciones WHERE 1=1';
  const params = [];

  if (tipo && tipo !== '') { sql += ' AND tipo = ?'; params.push(tipo); }
  if (estado && estado !== '') { sql += ' AND estado = ?'; params.push(estado); }
  if (precio_min) { sql += ' AND precio_base >= ?'; params.push(parseFloat(precio_min)); }
  if (precio_max) { sql += ' AND precio_base <= ?'; params.push(parseFloat(precio_max)); }

  sql += ' ORDER BY numero ASC';
  const habitaciones = dbAll(sql, params);
  const tipos = dbAll('SELECT DISTINCT tipo FROM habitaciones ORDER BY tipo');

  res.render('habitaciones/index', { habitaciones, tipos, filtros: req.query, total: habitaciones.length });
});

router.get('/nueva', (req, res) => {
  res.render('habitaciones/nueva', { habitacion: null, error: null });
});

router.post('/nueva', [
  body('numero').trim().notEmpty().withMessage('El número de habitación es obligatorio'),
  body('tipo').trim().notEmpty().withMessage('El tipo es obligatorio').isIn(['individual','doble','suite','familiar','presidencial']).withMessage('Tipo de habitación inválido'),
  body('precio_base').trim().notEmpty().isFloat({ min: 0 }).withMessage('Precio base inválido'),
  body('capacidad').optional({ nullable: true }).trim().isInt({ min: 1 }).withMessage('Capacidad inválida'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('habitaciones/nueva', { habitacion: req.body, errors: errors.array() });
  }

  const { numero, tipo, precio_base, capacidad, descripcion, servicios } = req.body;
  const servArray = servicios ? servicios.split(',').map(s => s.trim()).filter(Boolean) : [];
  try {
    dbRun('INSERT INTO habitaciones (numero, tipo, precio_base, capacidad, descripcion, servicios) VALUES (?, ?, ?, ?, ?, ?)',
      [numero, tipo, parseFloat(precio_base), parseInt(capacidad) || 2, descripcion || '', JSON.stringify(servArray)]);
    res.redirect('/habitaciones');
  } catch (e) {
    res.render('habitaciones/nueva', { habitacion: req.body, error: 'El número de habitación ya existe' });
  }
});

router.get('/:id', (req, res) => {
  const habitacion = dbGet('SELECT * FROM habitaciones WHERE id = ?', [req.params.id]);
  if (!habitacion) return res.redirect('/habitaciones');
  const reservas = dbAll(`
    SELECT r.*, h.nombre, h.apellido, h.numero_cedula
    FROM reservas r JOIN huespedes h ON r.huesped_id = h.id
    WHERE r.habitacion_id = ? AND r.estado != 'cancelada'
    ORDER BY r.fecha_entrada DESC LIMIT 20
  `, [req.params.id]);
  res.render('habitaciones/detalle', { habitacion, reservas, error: req.query.error || null });
});

router.get('/:id/editar', (req, res) => {
  const habitacion = dbGet('SELECT * FROM habitaciones WHERE id = ?', [req.params.id]);
  if (!habitacion) return res.redirect('/habitaciones');
  res.render('habitaciones/nueva', { habitacion, error: null });
});

router.post('/:id/editar', [
  body('numero').trim().notEmpty().withMessage('El número de habitación es obligatorio'),
  body('tipo').trim().notEmpty().isIn(['individual','doble','suite','familiar','presidencial']).withMessage('Tipo de habitación inválido'),
  body('precio_base').trim().optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Precio base inválido'),
  body('capacidad').optional({ nullable: true }).trim().isInt({ min: 1 }).withMessage('Capacidad inválida'),
  body('estado').optional({ nullable: true }).trim().isIn(['disponible','ocupado','mantenimiento','reservada']).withMessage('Estado inválido'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('habitaciones/nueva', { habitacion: { id: req.params.id, ...req.body }, errors: errors.array() });
  }

  const { numero, tipo, precio_base, capacidad, descripcion, servicios, estado } = req.body;
  const servArray = servicios ? servicios.split(',').map(s => s.trim()).filter(Boolean) : [];
  dbRun(`UPDATE habitaciones SET numero=?, tipo=?, precio_base=?, capacidad=?, descripcion=?, servicios=?, estado=? WHERE id=?`,
    [numero, tipo, parseFloat(precio_base || 0), parseInt(capacidad) || 2, descripcion || '', JSON.stringify(servArray), estado || 'disponible', req.params.id]);
  res.redirect(`/habitaciones/${req.params.id}`);
});

router.post('/:id/estado', (req, res) => {
  const { nuevo_estado } = req.body;
  if (['disponible', 'ocupado', 'mantenimiento', 'reservada'].includes(nuevo_estado)) {
    dbRun('UPDATE habitaciones SET estado = ? WHERE id = ?', [nuevo_estado, req.params.id]);
  }
  res.redirect(req.get('Referrer') || '/habitaciones');
});

router.post('/:id/eliminar', (req, res) => {
  const reservasActivas = dbGet(`
    SELECT COUNT(*) as count FROM reservas WHERE habitacion_id = ? AND estado IN ('pendiente','confirmada','checkin')
  `, [req.params.id]);
  if (reservasActivas.count > 0) {
    return res.redirect(`/habitaciones/${req.params.id}?error=No se puede eliminar: tiene reservas activas`);
  }
  dbRun('DELETE FROM habitaciones WHERE id = ?', [req.params.id]);
  res.redirect('/habitaciones');
});

module.exports = router;
