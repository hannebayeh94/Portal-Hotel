const express = require('express');
const { dbAll, dbGet, dbRun } = require('../models/database');
const { hayConflicto, calcularPrecio } = require('./_reservaUtils');
const router = express.Router();

// Pantalla única de check-in exprés (escanear → confirmar → habitación → registrar).
router.get('/', (req, res) => {
  const promociones = dbAll(`
    SELECT * FROM promociones WHERE activo = 1
    AND (fecha_inicio IS NULL OR date(fecha_inicio) <= date('now'))
    AND (fecha_fin IS NULL OR date(fecha_fin) >= date('now'))
  `);
  res.render('checkin/express', { promociones });
});

// Registra la entrada en un solo paso: crea (o reutiliza) el huésped, crea la reserva
// en estado 'checkin', marca la habitación como ocupada y registra el check-in.
// Responde JSON para que el asistente no pierda los datos escaneados si algo falla.
router.post('/registrar', (req, res) => {
  const b = req.body;
  const nombre = (b.nombre || '').trim();
  const apellido = (b.apellido || '').trim();
  const numero_cedula = (b.numero_cedula || '').replace(/\D/g, '');
  const { habitacion_id, fecha_entrada, fecha_salida } = b;

  if (!nombre || !apellido || !numero_cedula) return res.status(400).json({ error: 'Faltan el nombre, el apellido o la cédula del huésped.' });
  if (!habitacion_id) return res.status(400).json({ error: 'Seleccione una habitación.' });
  if (!fecha_entrada || !fecha_salida) return res.status(400).json({ error: 'Faltan las fechas de entrada o salida.' });
  if (new Date(fecha_entrada) >= new Date(fecha_salida)) return res.status(400).json({ error: 'La fecha de salida debe ser posterior a la de entrada.' });

  try {
    // Resolver el huésped: el ya emparejado por id, o uno existente con la misma
    // cédula (evita duplicados), o crear uno nuevo con lo que trajo el escaneo.
    let huespedId = (b.huesped_id && dbGet('SELECT id FROM huespedes WHERE id = ?', [b.huesped_id])) ? parseInt(b.huesped_id) : null;
    if (!huespedId) {
      const existente = dbGet('SELECT id FROM huespedes WHERE numero_cedula = ?', [numero_cedula]);
      if (existente) huespedId = existente.id;
    }
    if (!huespedId) {
      const r = dbRun(`
        INSERT INTO huespedes (nombre, apellido, numero_cedula, fecha_nacimiento, lugar_nacimiento, sexo, grupo_sanguineo, estatura, fecha_expedicion, lugar_expedicion, foto_cedula)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [nombre, apellido, numero_cedula, b.fecha_nacimiento || null, b.lugar_nacimiento || null, b.sexo || null, b.grupo_sanguineo || null, b.estatura || null, b.fecha_expedicion || null, b.lugar_expedicion || null, b.foto_cedula || null]);
      huespedId = r.lastInsertRowid;
    }

    if (hayConflicto(habitacion_id, fecha_entrada, fecha_salida)) {
      return res.status(409).json({ error: 'Esa habitación ya está ocupada en esas fechas. Elija otra.' });
    }

    const precio = calcularPrecio({ habitacion_id, fecha_entrada, fecha_salida, promocion_id: b.promocion_id });
    if (!precio) return res.status(400).json({ error: 'La habitación seleccionada no existe.' });

    const result = dbRun(`
      INSERT INTO reservas (huesped_id, habitacion_id, fecha_entrada, fecha_salida, estado, adultos, ninos, precio_noche, precio_total, promocion_id, notas)
      VALUES (?, ?, ?, ?, 'checkin', ?, ?, ?, ?, ?, ?)
    `, [huespedId, habitacion_id, fecha_entrada, fecha_salida, parseInt(b.adultos) || 1, parseInt(b.ninos) || 0, precio.precioNoche, precio.precioTotal, b.promocion_id || null, b.notas || '']);

    dbRun("UPDATE habitaciones SET estado = 'ocupado' WHERE id = ?", [habitacion_id]);
    dbRun('INSERT INTO checkins (reserva_id, huesped_id, habitacion_id) VALUES (?, ?, ?)', [result.lastInsertRowid, huespedId, habitacion_id]);

    res.json({ ok: true, reservaId: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo registrar la entrada: ' + err.message });
  }
});

module.exports = router;
