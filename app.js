const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const hotel = require('./config/hotel');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'uploads')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'hotel-admin-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.path = req.path;
  res.locals.csrfToken = req.session ? req.session.id : null;
  res.locals.hotel = hotel;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

async function startServer() {
  const { initialize, dbAll, dbGet, dbRun } = require('./models/database');
  await initialize();

  const authRoutes = require('./routes/auth');
  const guestRoutes = require('./routes/guests');
  const roomRoutes = require('./routes/rooms');
  const reservationRoutes = require('./routes/reservations');
  const adminRoutes = require('./routes/admin');
  const apiRoutes = require('./routes/api');
  const checkinRoutes = require('./routes/checkin');

  app.use('/', authRoutes);
  app.use('/api', apiRoutes);
  app.use('/checkin', requireAuth, checkinRoutes);
  app.use('/huespedes', requireAuth, guestRoutes);
  app.use('/habitaciones', requireAuth, roomRoutes);
  app.use('/reservas', requireAuth, reservationRoutes);
  app.use('/admin', requireAuth, adminRoutes);

  app.get('/', requireAuth, (req, res) => {
    const hoy = new Date().toISOString().split('T')[0];

    const totalHuespedes = dbGet('SELECT COUNT(*) as count FROM huespedes');
    const totalReservas = dbGet("SELECT COUNT(*) as count FROM reservas WHERE estado != 'cancelada'");
    const habitacionesOcupadas = dbGet("SELECT COUNT(*) as count FROM habitaciones WHERE estado = 'ocupado'");
    const totalHabitaciones = dbGet('SELECT COUNT(*) as count FROM habitaciones');
    const ingresosMes = dbGet(`
      SELECT COALESCE(SUM(total), 0) as total FROM facturas
      WHERE strftime('%Y-%m', fecha_emision) = strftime('%Y-%m', 'now')
      AND estado = 'pagada'
    `);
    const reservasActivas = dbAll(`
      SELECT r.*, h.nombre, h.apellido, h.numero_cedula, ha.numero as hab_numero, ha.tipo as hab_tipo
      FROM reservas r
      JOIN huespedes h ON r.huesped_id = h.id
      JOIN habitaciones ha ON r.habitacion_id = ha.id
      WHERE r.estado IN ('confirmada','checkin')
      AND r.fecha_entrada <= ? AND r.fecha_salida >= ?
      ORDER BY r.fecha_entrada ASC
    `, [hoy, hoy]);
    const checkinsHoy = dbAll(`
      SELECT r.*, h.nombre, h.apellido, ha.numero as hab_numero
      FROM reservas r
      JOIN huespedes h ON r.huesped_id = h.id
      JOIN habitaciones ha ON r.habitacion_id = ha.id
      WHERE r.fecha_entrada = ? AND r.estado = 'confirmada'
    `, [hoy]);
    const checkoutsHoy = dbAll(`
      SELECT r.*, h.nombre, h.apellido, ha.numero as hab_numero
      FROM reservas r
      JOIN huespedes h ON r.huesped_id = h.id
      JOIN habitaciones ha ON r.habitacion_id = ha.id
      WHERE r.fecha_salida = ? AND r.estado = 'checkin'
    `, [hoy]);

    const ocupacionPorTipo = dbAll(`
      SELECT ha.tipo, COUNT(*) as total,
        SUM(CASE WHEN ha.estado = 'ocupado' THEN 1 ELSE 0 END) as ocupadas,
        SUM(CASE WHEN ha.estado = 'reservada' THEN 1 ELSE 0 END) as reservadas
      FROM habitaciones ha GROUP BY ha.tipo
    `);

    const ingresosMensuales = dbAll(`
      SELECT strftime('%Y-%m', fecha_emision) as mes, SUM(total) as total
      FROM facturas WHERE estado = 'pagada'
      GROUP BY mes ORDER BY mes ASC LIMIT 12
    `);

    res.render('dashboard', {
      totalHuespedes: totalHuespedes.count,
      totalReservas: totalReservas.count,
      ocupacion: totalHabitaciones.count > 0 ? Math.round((habitacionesOcupadas.count / totalHabitaciones.count) * 100) : 0,
      ingresosMes: ingresosMes.total || 0,
      reservasActivas,
      checkinsHoy,
      checkoutsHoy,
      ocupacionPorTipo,
      ingresosMensuales
    });
  });

  app.use((req, res) => {
    res.status(404).render('error', { message: 'Página no encontrada' });
  });

  app.listen(PORT, () => {
    console.log(`Hotel Admin Portal corriendo en http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Error iniciando servidor:', err);
  process.exit(1);
});
