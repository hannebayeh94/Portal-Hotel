const express = require('express');
const { dbAll, dbGet, dbRun } = require('../models/database');
const { body, validationResult } = require('express-validator');
const router = express.Router();

router.get('/', (req, res) => res.redirect('/admin/tarifas'));

router.get('/tarifas', (req, res) => {
  const tarifas = dbAll(`
    SELECT t.*, temp.nombre as temporada_nombre FROM tarifas t
    LEFT JOIN temporadas temp ON t.temporada_id = temp.id ORDER BY t.tipo_habitacion
  `);
  const temporadas = dbAll('SELECT * FROM temporadas WHERE activo = 1');
  const tipos = dbAll('SELECT DISTINCT tipo FROM habitaciones ORDER BY tipo');
  const preciosBase = dbAll('SELECT tipo, MIN(precio_base) as precio FROM habitaciones GROUP BY tipo');
  const habitaciones_precios = {};
  preciosBase.forEach(p => { habitaciones_precios[p.tipo] = p.precio; });
  res.render('admin/tarifas', { tarifas, temporadas, tipos, habitaciones_precios, error: null });
});

router.post('/tarifas/nueva', [
  body('tipo_habitacion').trim().notEmpty().withMessage('El tipo de habitación es obligatorio').isIn(['individual','doble','suite','familiar','presidencial']).withMessage('Tipo inválido'),
  body('temporada_id').optional({ nullable: true }).isInt({ min: 0 }).withMessage('Temporada inválida'),
  body('precio').trim().notEmpty().isFloat({ min: 0 }).withMessage('Precio inválido'),
  body('fecha_inicio').optional({ nullable: true }).trim(),
  body('fecha_fin').optional({ nullable: true }).trim(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const tarifas = dbAll(`
      SELECT t.*, temp.nombre as temporada_nombre FROM tarifas t
      LEFT JOIN temporadas temp ON t.temporada_id = temp.id ORDER BY t.tipo_habitacion
    `);
    const temporadas = dbAll('SELECT * FROM temporadas WHERE activo = 1');
    const tipos = dbAll('SELECT DISTINCT tipo FROM habitaciones ORDER BY tipo');
    const preciosBase = dbAll('SELECT tipo, MIN(precio_base) as precio FROM habitaciones GROUP BY tipo');
    const habitaciones_precios = {};
    preciosBase.forEach(p => { habitaciones_precios[p.tipo] = p.precio; });
    return res.render('admin/tarifas', { tarifas, temporadas, tipos, habitaciones_precios, error: errors.array()[0].msg });
  }

  const { tipo_habitacion, temporada_id, precio, fecha_inicio, fecha_fin } = req.body;
  dbRun('INSERT INTO tarifas (tipo_habitacion, temporada_id, precio, fecha_inicio, fecha_fin) VALUES (?, ?, ?, ?, ?)',
    [tipo_habitacion, temporada_id || null, parseFloat(precio), fecha_inicio, fecha_fin]);
  res.redirect('/admin/tarifas');
});

router.post('/tarifas/:id/eliminar', (req, res) => {
  dbRun('DELETE FROM tarifas WHERE id = ?', [req.params.id]);
  res.redirect('/admin/tarifas');
});

router.get('/temporadas', (req, res) => {
  const temporadas = dbAll('SELECT * FROM temporadas ORDER BY fecha_inicio');
  res.render('admin/temporadas', { temporadas, error: null });
});

router.post('/temporadas/nueva', [
  body('nombre').trim().notEmpty().withMessage('El nombre es obligatorio'),
  body('fecha_inicio').trim().notEmpty().withMessage('Fecha inicio obligatoria'),
  body('fecha_fin').trim().notEmpty().withMessage('Fecha fin obligatoria'),
  body('multiplicador').optional({ nullable: true }).trim().isFloat({ min: 0 }).withMessage('Multiplicador inválido'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const temporadas = dbAll('SELECT * FROM temporadas ORDER BY fecha_inicio');
    return res.render('admin/temporadas', { temporadas, error: errors.array()[0].msg });
  }

  const { nombre, fecha_inicio, fecha_fin, multiplicador } = req.body;
  dbRun('INSERT INTO temporadas (nombre, fecha_inicio, fecha_fin, multiplicador) VALUES (?, ?, ?, ?)',
    [nombre, fecha_inicio, fecha_fin, parseFloat(multiplicador) || 1.0]);
  res.redirect('/admin/temporadas');
});

router.post('/temporadas/:id/eliminar', (req, res) => {
  dbRun('DELETE FROM temporadas WHERE id = ?', [req.params.id]);
  res.redirect('/admin/temporadas');
});

router.get('/promociones', (req, res) => {
  const promociones = dbAll('SELECT * FROM promociones ORDER BY created_at DESC');
  res.render('admin/promociones', { promociones, error: null });
});

router.post('/promociones/nueva', [
  body('nombre').trim().notEmpty().withMessage('El nombre es obligatorio'),
  body('descuento').optional({ nullable: true }).trim().isFloat({ min: 0, max: 100 }).withMessage('Descuento debe ser 0-100'),
  body('tipo_descuento').optional({ nullable: true }).trim().isIn(['porcentaje','fijo']).withMessage('Tipo de descuento inválido'),
  body('codigo').trim().notEmpty().withMessage('El código es obligatorio'),
  body('fecha_inicio').optional({ nullable: true }).trim(),
  body('fecha_fin').optional({ nullable: true }).trim(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const promociones = dbAll('SELECT * FROM promociones ORDER BY created_at DESC');
    return res.render('admin/promociones', { promociones, error: errors.array()[0].msg });
  }

  const { nombre, descripcion, descuento, tipo_descuento, codigo, fecha_inicio, fecha_fin } = req.body;
  dbRun('INSERT INTO promociones (nombre, descripcion, descuento, tipo_descuento, codigo, fecha_inicio, fecha_fin) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [nombre, descripcion || '', parseFloat(descuento || 0), tipo_descuento || 'porcentaje', codigo, fecha_inicio, fecha_fin]);
  res.redirect('/admin/promociones');
});

router.post('/promociones/:id/toggle', (req, res) => {
  const promo = dbGet('SELECT activo FROM promociones WHERE id = ?', [req.params.id]);
  if (promo) dbRun('UPDATE promociones SET activo = ? WHERE id = ?', [promo.activo ? 0 : 1, req.params.id]);
  res.redirect('/admin/promociones');
});

router.get('/reportes', (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  const inicio = req.query.desde || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const fin = req.query.hasta || hoy;

  const ingresos = dbGet(`
    SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count FROM facturas
    WHERE date(fecha_emision) >= ? AND date(fecha_emision) <= ? AND estado = 'pagada'
  `, [inicio, fin]);
  const ocupacion = dbGet("SELECT COUNT(*) as ocupadas FROM habitaciones WHERE estado = 'ocupado'");
  const totalHab = dbGet('SELECT COUNT(*) as total FROM habitaciones');

  const reservasPeriodo = dbAll(`
    SELECT r.*, h.nombre, h.apellido, ha.numero as hab_numero, ha.tipo as hab_tipo
    FROM reservas r
    JOIN huespedes h ON r.huesped_id = h.id
    JOIN habitaciones ha ON r.habitacion_id = ha.id
    WHERE date(r.created_at) >= ? AND date(r.created_at) <= ?
    ORDER BY r.created_at DESC
  `, [inicio, fin]);

  const ingresosPorMes = dbAll(`
    SELECT strftime('%Y-%m', fecha_emision) as mes, SUM(total) as total, COUNT(*) as cantidad
    FROM facturas WHERE estado = 'pagada' AND date(fecha_emision) >= ?
    GROUP BY mes ORDER BY mes DESC LIMIT 12
  `, [inicio]);

  const ocupacionPorTipo = dbAll(`
    SELECT ha.tipo, COUNT(*) as total,
      SUM(CASE WHEN ha.estado = 'ocupado' THEN 1 ELSE 0 END) as ocupadas
    FROM habitaciones ha GROUP BY ha.tipo
  `);

  res.render('admin/reportes', { ingresos, ocupacion, totalHab: totalHab.total, reservasPeriodo, ingresosPorMes, ocupacionPorTipo, desde: inicio, hasta: fin });
});

router.get('/facturacion', (req, res) => {
  const { estado, desde, hasta } = req.query;
  let sql = `
    SELECT f.*, h.nombre, h.apellido, h.numero_cedula, ha.numero as hab_numero,
           r.fecha_entrada, r.fecha_salida
    FROM facturas f
    JOIN huespedes h ON f.huesped_id = h.id
    JOIN reservas r ON f.reserva_id = r.id
    JOIN habitaciones ha ON r.habitacion_id = ha.id
    WHERE 1=1
  `;
  const params = [];
  if (estado && estado !== '') { sql += ' AND f.estado = ?'; params.push(estado); }
  if (desde) { sql += ' AND date(f.fecha_emision) >= ?'; params.push(desde); }
  if (hasta) { sql += ' AND date(f.fecha_emision) <= ?'; params.push(hasta); }
  sql += ' ORDER BY f.fecha_emision DESC';

  const facturas = dbAll(sql, params);
  res.render('admin/facturacion', { facturas, filtros: req.query });
});

router.get('/facturacion/exportar/csv', (req, res) => {
  const facturas = dbAll(`
    SELECT f.*, h.nombre, h.apellido, h.numero_cedula, ha.numero as hab_numero
    FROM facturas f
    JOIN huespedes h ON f.huesped_id = h.id
    JOIN reservas r ON f.reserva_id = r.id
    JOIN habitaciones ha ON r.habitacion_id = ha.id
    ORDER BY f.fecha_emision DESC
  `);

  let csv = '\uFEFFID;Huésped;Cédula;Habitación;Subtotal;IVA;Total;Método Pago;Estado;Fecha Emisión\n';
  facturas.forEach(f => {
    csv += `"${f.id}";"${f.nombre} ${f.apellido}";"${f.numero_cedula}";"${f.hab_numero}";"${f.subtotal}";"${f.impuestos}";"${f.total}";"${f.metodo_pago || ''}";"${f.estado}";"${f.fecha_emision}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="facturas_' + new Date().toISOString().split('T')[0] + '.csv"');
  res.send(csv);
});

router.post('/facturacion/:id/pagar', (req, res) => {
  const { metodo_pago } = req.body;
  const factura = dbGet('SELECT * FROM facturas WHERE id = ?', [req.params.id]);
  if (factura) {
    dbRun("UPDATE facturas SET estado = 'pagada', metodo_pago = ? WHERE id = ? AND estado = 'emitida'", [metodo_pago || 'efectivo', req.params.id]);
    dbRun("UPDATE reservas SET pagado = 1 WHERE id = ?", [factura.reserva_id]);
  }
  res.redirect('/admin/facturacion');
});

router.get('/facturacion/:id/pdf', (req, res) => {
  const factura = dbGet(`
    SELECT f.*, h.nombre, h.apellido, h.numero_cedula, h.direccion, h.email,
           ha.numero as hab_numero, ha.tipo as hab_tipo,
           r.fecha_entrada, r.fecha_salida, r.adultos, r.ninos, r.precio_noche
    FROM facturas f
    JOIN huespedes h ON f.huesped_id = h.id
    JOIN reservas r ON f.reserva_id = r.id
    JOIN habitaciones ha ON r.habitacion_id = ha.id
    WHERE f.id = ?
  `, [req.params.id]);
  if (!factura) return res.redirect('/admin/facturacion');
  res.render('admin/factura-pdf', { factura });
});

module.exports = router;
