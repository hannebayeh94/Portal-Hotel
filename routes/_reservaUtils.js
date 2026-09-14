const { dbGet } = require('../models/database');

// Predicado de solapamiento reutilizado por el flujo de reservas y el de check-in
// exprés: una habitación está en conflicto si tiene una reserva 'confirmada' o
// 'checkin' cuyo rango se cruza con el rango pedido. Se comprueba en ambos sentidos.
function hayConflicto(habitacion_id, fecha_entrada, fecha_salida, excluirReservaId = null) {
  let sql = `
    SELECT id FROM reservas WHERE habitacion_id = ? AND estado IN ('confirmada','checkin')
    AND ((fecha_entrada <= ? AND fecha_salida > ?) OR (fecha_entrada < ? AND fecha_salida >= ?))
  `;
  const params = [habitacion_id, fecha_entrada, fecha_entrada, fecha_salida, fecha_salida];
  if (excluirReservaId) { sql += ' AND id != ?'; params.push(excluirReservaId); }
  return dbGet(sql, params);
}

// Precio por noche = suma noche a noche considerando la temporada activa de cada fecha,
// menos el descuento aplicable de la promoción. Devuelve
// { habitacion, dias, precioNoche, precioTotal } o null si la habitación no existe.
function calcularPrecio({ habitacion_id, fecha_entrada, fecha_salida, promocion_id }) {
  const habitacion = dbGet('SELECT * FROM habitaciones WHERE id = ?', [habitacion_id]);
  if (!habitacion) return null;

  const msPorDia = 1000 * 60 * 60 * 24;
  const start = new Date(fecha_entrada);
  const end = new Date(fecha_salida);
  let dias = Math.ceil((end - start) / msPorDia);
  if (isNaN(dias) || dias < 1) dias = 1;

  let totalEstancia = 0;
  for (let i = 0; i < dias; i++) {
    const diaActual = new Date(start.getTime() + i * msPorDia);
    const diaStr = diaActual.toISOString().split('T')[0];

    let precioDia = habitacion.precio_base;
    const temporada = dbGet(`
      SELECT * FROM temporadas WHERE activo = 1 AND fecha_inicio <= ? AND fecha_fin >= ?
      ORDER BY multiplicador DESC LIMIT 1
    `, [diaStr, diaStr]);

    if (temporada) {
      precioDia = Math.round(precioDia * temporada.multiplicador);
    }
    totalEstancia += precioDia;
  }

  let descuento = 0;
  if (promocion_id) {
    const promo = dbGet('SELECT * FROM promociones WHERE id = ? AND activo = 1', [promocion_id]);
    if (promo) {
      if (promo.tipo_descuento === 'porcentaje') {
        descuento = Math.round(totalEstancia * (promo.descuento / 100));
      } else {
        descuento = Math.min(promo.descuento, totalEstancia);
      }
    }
  }

  const precioTotal = Math.max(0, totalEstancia - descuento);
  const precioNoche = Math.round(precioTotal / dias);

  return { habitacion, dias, precioNoche, precioTotal };
}

module.exports = { hayConflicto, calcularPrecio };
