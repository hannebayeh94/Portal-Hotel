const express = require('express');
const { dbAll, dbGet, dbRun } = require('../models/database');
const { body, validationResult } = require('express-validator');
const { hayConflicto, calcularPrecio } = require('./_reservaUtils');
const router = express.Router();

router.get('/', (req, res) => {
  const { estado, fecha_desde, fecha_hasta, huesped, pago } = req.query;
  let sql = `
    SELECT r.*, h.nombre, h.apellido, h.numero_cedula, ha.numero as hab_numero, ha.tipo as hab_tipo
    FROM reservas r
    JOIN huespedes h ON r.huesped_id = h.id
    JOIN habitaciones ha ON r.habitacion_id = ha.id
    WHERE 1=1
  `;
  const params = [];

  if (estado && estado !== '') { sql += ' AND r.estado = ?'; params.push(estado); }
  if (fecha_desde) { sql += ' AND r.fecha_entrada >= ?'; params.push(fecha_desde); }
  if (fecha_hasta) { sql += ' AND r.fecha_salida <= ?'; params.push(fecha_hasta); }
  if (huesped) { const q = `%${huesped}%`; sql += ' AND (h.nombre LIKE ? OR h.apellido LIKE ? OR h.numero_cedula LIKE ?)'; params.push(q, q, q); }
  if (pago === 'pagado') { sql += ' AND r.pagado = 1'; }
  if (pago === 'pendiente') { sql += ' AND r.pagado = 0'; }

  sql += ' ORDER BY r.fecha_entrada DESC';
  const reservas = dbAll(sql, params);
  res.render('reservas/index', { reservas, filtros: req.query });
});

router.get('/nueva', (req, res) => {
  const huespedes = dbAll('SELECT * FROM huespedes ORDER BY nombre ASC');
  const habitaciones = dbAll("SELECT * FROM habitaciones WHERE estado IN ('disponible','reservada') ORDER BY numero ASC");
  const promociones = dbAll("SELECT * FROM promociones WHERE activo = 1 AND (fecha_inicio IS NULL OR date(fecha_inicio) <= date('now')) AND (fecha_fin IS NULL OR date(fecha_fin) >= date('now'))");
  res.render('reservas/nueva', { reserva: null, huespedes, habitaciones, promociones, error: null, rapido: req.query.rapido !== '0' });
});

router.post('/nueva', [
  body('huesped_id').notEmpty().withMessage('El huésped es obligatorio'),
  body('habitacion_id').notEmpty().withMessage('La habitación es obligatoria'),
  body('fecha_entrada').trim().notEmpty().withMessage('La fecha de entrada es obligatoria'),
  body('fecha_salida').trim().notEmpty().withMessage('La fecha de salida es obligatoria'),
  body('adultos').optional({ nullable: true }).isInt({ min: 0 }).withMessage('Adultos inválido'),
  body('ninos').optional({ nullable: true }).isInt({ min: 0 }).withMessage('Niños inválido'),
  body('promocion_id').optional({ nullable: true }).isInt({ min: 0 }).withMessage('Promoción inválida'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const huespedes = dbAll('SELECT * FROM huespedes ORDER BY nombre ASC');
    const habitaciones = dbAll("SELECT * FROM habitaciones WHERE estado IN ('disponible','reservada') ORDER BY numero ASC");
    const promociones = dbAll('SELECT * FROM promociones WHERE activo = 1');
    return res.render('reservas/nueva', { reserva: req.body, huespedes, habitaciones, promociones, error: errors.array()[0].msg, rapido: req.body.checkin_inmediato === '1' });
  }

  const { huesped_id, habitacion_id, fecha_entrada, fecha_salida, adultos, ninos, promocion_id, notas, checkin_inmediato } = req.body;

  if (new Date(fecha_entrada) >= new Date(fecha_salida)) {
    const huespedes = dbAll('SELECT * FROM huespedes ORDER BY nombre ASC');
    const habitaciones = dbAll("SELECT * FROM habitaciones WHERE estado IN ('disponible','reservada') ORDER BY numero ASC");
    const promociones = dbAll('SELECT * FROM promociones WHERE activo = 1');
    return res.render('reservas/nueva', { reserva: req.body, huespedes, habitaciones, promociones, error: 'La fecha de salida debe ser posterior a la fecha de entrada', rapido: checkin_inmediato === '1' });
  }

  const conflicto = hayConflicto(habitacion_id, fecha_entrada, fecha_salida);
  if (conflicto) {
    const huespedes = dbAll('SELECT * FROM huespedes ORDER BY nombre ASC');
    const habitaciones = dbAll("SELECT * FROM habitaciones WHERE estado IN ('disponible','reservada') ORDER BY numero ASC");
    const promociones = dbAll('SELECT * FROM promociones WHERE activo = 1');
    return res.render('reservas/nueva', { reserva: req.body, huespedes, habitaciones, promociones, error: 'La habitación ya está reservada para esas fechas', rapido: checkin_inmediato === '1' });
  }

  const { precioNoche, precioTotal } = calcularPrecio({ habitacion_id, fecha_entrada, fecha_salida, promocion_id });
  const ocuparAhora = checkin_inmediato === '1' || checkin_inmediato === 'on';
  const estadoInicial = ocuparAhora ? 'checkin' : 'confirmada';

  const result = dbRun(`
    INSERT INTO reservas (huesped_id, habitacion_id, fecha_entrada, fecha_salida, estado, adultos, ninos, precio_noche, precio_total, promocion_id, notas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [huesped_id, habitacion_id, fecha_entrada, fecha_salida, estadoInicial, parseInt(adultos) || 1, parseInt(ninos) || 0, precioNoche, precioTotal, promocion_id || null, notas || '']);

  if (ocuparAhora) {
    dbRun("UPDATE habitaciones SET estado = 'ocupado' WHERE id = ?", [habitacion_id]);
    dbRun('INSERT INTO checkins (reserva_id, huesped_id, habitacion_id) VALUES (?, ?, ?)', [result.lastInsertRowid, huesped_id, habitacion_id]);
    return res.redirect(`/reservas/${result.lastInsertRowid}`);
  }

  dbRun("UPDATE habitaciones SET estado = 'reservada' WHERE id = ?", [habitacion_id]);
  res.redirect('/reservas');
});

router.get('/:id', (req, res) => {
  const reserva = dbGet(`
    SELECT r.*, h.nombre, h.apellido, h.numero_cedula, h.email, h.telefono,
           ha.numero as hab_numero, ha.tipo as hab_tipo, ha.precio_base,
           p.nombre as promo_nombre, p.descuento as promo_descuento
    FROM reservas r
    JOIN huespedes h ON r.huesped_id = h.id
    JOIN habitaciones ha ON r.habitacion_id = ha.id
    LEFT JOIN promociones p ON r.promocion_id = p.id
    WHERE r.id = ?
  `, [req.params.id]);
  if (!reserva) return res.redirect('/reservas');
  const factura = dbGet('SELECT * FROM facturas WHERE reserva_id = ?', [req.params.id]);
  res.render('reservas/detalle', { reserva, factura });
});

router.post('/:id/checkin', (req, res) => {
  dbRun("UPDATE reservas SET estado = 'checkin', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND estado = 'confirmada'", [req.params.id]);
  const r = dbGet('SELECT * FROM reservas WHERE id = ?', [req.params.id]);
  if (r) {
    dbRun("UPDATE habitaciones SET estado = 'ocupado' WHERE id = ?", [r.habitacion_id]);
    dbRun('INSERT INTO checkins (reserva_id, huesped_id, habitacion_id) VALUES (?, ?, ?)', [r.id, r.huesped_id, r.habitacion_id]);
  }
  res.redirect(`/reservas/${req.params.id}`);
});

router.get('/exportar/csv', (req, res) => {
  const reservas = dbAll(`
    SELECT r.*, h.nombre, h.apellido, h.numero_cedula, ha.numero as hab_numero, ha.tipo as hab_tipo
    FROM reservas r
    JOIN huespedes h ON r.huesped_id = h.id
    JOIN habitaciones ha ON r.habitacion_id = ha.id
    ORDER BY r.fecha_entrada DESC
  `);

  let csv = '\uFEFFID;Huésped;Cédula;Habitación;Tipo;Entrada;Salida;Adultos;Niños;Total;Estado;Pagado;Fecha Registro\n';
  reservas.forEach(r => {
    csv += `"${r.id}";"${r.nombre} ${r.apellido}";"${r.numero_cedula}";"${r.hab_numero}";"${r.hab_tipo}";"${r.fecha_entrada}";"${r.fecha_salida}";"${r.adultos}";"${r.ninos}";"${r.precio_total}";"${r.estado}";"${r.pagado ? 'Sí' : 'No'}";"${r.created_at}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="reservas_' + new Date().toISOString().split('T')[0] + '.csv"');
  res.send(csv);
});

router.post('/:id/checkout', (req, res) => {
  dbRun("UPDATE reservas SET estado = 'checkout', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND estado = 'checkin'", [req.params.id]);
  const r = dbGet('SELECT * FROM reservas WHERE id = ?', [req.params.id]);
  if (r) {
    dbRun("UPDATE habitaciones SET estado = 'mantenimiento' WHERE id = ?", [r.habitacion_id]);
    dbRun('UPDATE checkins SET fecha_checkout = CURRENT_TIMESTAMP WHERE reserva_id = ? AND fecha_checkout IS NULL', [r.id]);
    const existing = dbGet('SELECT id FROM facturas WHERE reserva_id = ?', [r.id]);
    if (!existing) {
      const impuesto = Math.round(r.precio_total * 0.19);
      const estadoFactura = r.pagado ? 'pagada' : 'emitida';
      dbRun('INSERT INTO facturas (reserva_id, huesped_id, subtotal, impuestos, total, estado) VALUES (?, ?, ?, ?, ?, ?)',
        [r.id, r.huesped_id, r.precio_total, impuesto, r.precio_total + impuesto, estadoFactura]);
    }
  }
  res.redirect(`/reservas/${req.params.id}`);
});

router.post('/:id/pago', (req, res) => {
  const reserva = dbGet('SELECT pagado FROM reservas WHERE id = ?', [req.params.id]);
  if (reserva) {
    const nuevoEstado = reserva.pagado ? 0 : 1;
    dbRun('UPDATE reservas SET pagado = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [nuevoEstado, req.params.id]);
    if (nuevoEstado === 1) {
      dbRun("UPDATE facturas SET estado = 'pagada' WHERE reserva_id = ? AND estado = 'emitida'", [req.params.id]);
    } else {
      dbRun("UPDATE facturas SET estado = 'emitida' WHERE reserva_id = ? AND estado = 'pagada'", [req.params.id]);
    }
  }
  res.redirect(req.get('Referrer') || `/reservas/${req.params.id}`);
});

router.post('/:id/cancelar', (req, res) => {
  dbRun("UPDATE reservas SET estado = 'cancelada', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
  const r = dbGet('SELECT * FROM reservas WHERE id = ?', [req.params.id]);
  if (r) dbRun("UPDATE habitaciones SET estado = 'disponible' WHERE id = ?", [r.habitacion_id]);
  res.redirect('/reservas');
});

module.exports = router;
