const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'hotel.db');
let db = null;

function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) { rows.push(stmt.getAsObject()); }
  stmt.free();
  return rows;
}

function dbGet(sql, params = []) {
  const rows = dbAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  const lastId = db.exec("SELECT last_insert_rowid() as id");
  saveDb();
  return {
    lastInsertRowid: lastId.length > 0 ? lastId[0].values[0][0] : 0,
    changes: db.getRowsModified()
  };
}

async function initialize() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA foreign_keys = ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      nombre TEXT NOT NULL,
      rol TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS huespedes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      apellido TEXT NOT NULL,
      numero_cedula TEXT UNIQUE NOT NULL,
      fecha_nacimiento TEXT,
      lugar_nacimiento TEXT,
      sexo TEXT,
      grupo_sanguineo TEXT,
      estatura TEXT,
      fecha_expedicion TEXT,
      lugar_expedicion TEXT,
      email TEXT,
      telefono TEXT,
      direccion TEXT,
      foto_cedula TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const columnasHuespedes = dbAll("PRAGMA table_info(huespedes)").map(c => c.name);
  for (const col of ['lugar_nacimiento', 'sexo', 'grupo_sanguineo', 'estatura']) {
    if (!columnasHuespedes.includes(col)) {
      db.run(`ALTER TABLE huespedes ADD COLUMN ${col} TEXT`);
    }
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS habitaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT UNIQUE NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('individual','doble','suite','familiar','presidencial')),
      precio_base REAL NOT NULL,
      capacidad INTEGER NOT NULL DEFAULT 2,
      descripcion TEXT,
      servicios TEXT DEFAULT '[]',
      estado TEXT DEFAULT 'disponible' CHECK(estado IN ('disponible','ocupado','mantenimiento','reservada')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS temporadas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      fecha_inicio TEXT NOT NULL,
      fecha_fin TEXT NOT NULL,
      multiplicador REAL DEFAULT 1.0,
      activo INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tarifas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo_habitacion TEXT NOT NULL,
      temporada_id INTEGER REFERENCES temporadas(id),
      precio REAL NOT NULL,
      fecha_inicio TEXT,
      fecha_fin TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS promociones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      descripcion TEXT,
      descuento REAL NOT NULL,
      tipo_descuento TEXT DEFAULT 'porcentaje' CHECK(tipo_descuento IN ('porcentaje','fijo')),
      codigo TEXT UNIQUE,
      fecha_inicio TEXT,
      fecha_fin TEXT,
      activo INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reservas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      huesped_id INTEGER NOT NULL REFERENCES huespedes(id),
      habitacion_id INTEGER NOT NULL REFERENCES habitaciones(id),
      fecha_entrada TEXT NOT NULL,
      fecha_salida TEXT NOT NULL,
      estado TEXT DEFAULT 'pendiente' CHECK(estado IN ('pendiente','confirmada','checkin','checkout','cancelada')),
      adultos INTEGER DEFAULT 1,
      ninos INTEGER DEFAULT 0,
      precio_noche REAL NOT NULL,
      precio_total REAL NOT NULL,
      promocion_id INTEGER REFERENCES promociones(id),
      notas TEXT,
      pagado INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const columnasReservas = dbAll("PRAGMA table_info(reservas)").map(c => c.name);
  if (!columnasReservas.includes('pagado')) {
    db.run('ALTER TABLE reservas ADD COLUMN pagado INTEGER DEFAULT 0');
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS facturas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reserva_id INTEGER NOT NULL REFERENCES reservas(id),
      huesped_id INTEGER NOT NULL REFERENCES huespedes(id),
      subtotal REAL NOT NULL,
      descuento REAL DEFAULT 0,
      impuestos REAL DEFAULT 0,
      total REAL NOT NULL,
      metodo_pago TEXT DEFAULT 'efectivo',
      estado TEXT DEFAULT 'emitida' CHECK(estado IN ('emitida','pagada','cancelada','anulada')),
      fecha_emision DATETIME DEFAULT CURRENT_TIMESTAMP,
      notas TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reserva_id INTEGER NOT NULL REFERENCES reservas(id),
      huesped_id INTEGER NOT NULL REFERENCES huespedes(id),
      habitacion_id INTEGER NOT NULL REFERENCES habitaciones(id),
      fecha_checkin DATETIME DEFAULT CURRENT_TIMESTAMP,
      fecha_checkout DATETIME,
      observaciones TEXT
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_huespedes_cedula ON huespedes(numero_cedula)');
  db.run('CREATE INDEX IF NOT EXISTS idx_reservas_fechas ON reservas(fecha_entrada, fecha_salida)');
  db.run('CREATE INDEX IF NOT EXISTS idx_reservas_huesped ON reservas(huesped_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_facturas_reserva ON facturas(reserva_id)');

  const existingUser = dbGet('SELECT id FROM usuarios WHERE username = ?', ['admin']);
  if (!existingUser) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    dbRun('INSERT INTO usuarios (username, password, nombre, rol) VALUES (?, ?, ?, ?)', ['admin', hashedPassword, 'Administrador', 'admin']);
  }

  const existingRooms = dbGet('SELECT COUNT(*) as count FROM habitaciones');
  if (existingRooms.count === 0) {
    const roomTypes = [
      { numero: '101', tipo: 'individual', precio: 120000, capacidad: 1, descripcion: 'Habitación individual cómoda y funcional', servicios: '["TV","WiFi","Baño privado","Aire acondicionado"]' },
      { numero: '102', tipo: 'individual', precio: 120000, capacidad: 1, descripcion: 'Habitación individual con vista interior', servicios: '["TV","WiFi","Baño privado"]' },
      { numero: '201', tipo: 'doble', precio: 180000, capacidad: 2, descripcion: 'Habitación doble ideal para parejas', servicios: '["TV","WiFi","Baño privado","Aire acondicionado","Mini bar"]' },
      { numero: '202', tipo: 'doble', precio: 180000, capacidad: 2, descripcion: 'Habitación doble con dos camas', servicios: '["TV","WiFi","Baño privado","Aire acondicionado"]' },
      { numero: '203', tipo: 'doble', precio: 200000, capacidad: 2, descripcion: 'Habitación doble superior', servicios: '["TV","WiFi","Baño privado","Aire acondicionado","Mini bar","Balcón"]' },
      { numero: '301', tipo: 'suite', precio: 350000, capacidad: 3, descripcion: 'Suite con sala de estar independiente', servicios: '["TV","WiFi","Baño privado","Aire acondicionado","Mini bar","Balcón","Jacuzzi"]' },
      { numero: '302', tipo: 'suite', precio: 400000, capacidad: 4, descripcion: 'Suite presidencial', servicios: '["TV","WiFi","Baño privado","Aire acondicionado","Mini bar","Balcón","Jacuzzi","Sala de estar"]' },
      { numero: '401', tipo: 'familiar', precio: 280000, capacidad: 5, descripcion: 'Habitación familiar amplia', servicios: '["TV","WiFi","Baño privado","Aire acondicionado","Cocina pequeña","Balcón"]' },
      { numero: '402', tipo: 'familiar', precio: 300000, capacidad: 6, descripcion: 'Habitación familiar con vista al mar', servicios: '["TV","WiFi","Baño privado","Aire acondicionado","Cocina","Balcón","Sala de estar"]' },
      { numero: '501', tipo: 'presidencial', precio: 600000, capacidad: 4, descripcion: 'Suite presidencial de lujo', servicios: '["TV","WiFi","Baño privado","Aire acondicionado","Mini bar","Balcón","Jacuzzi","Sala de estar","Mayordomo"]' },
    ];
    for (const r of roomTypes) {
      dbRun('INSERT INTO habitaciones (numero, tipo, precio_base, capacidad, descripcion, servicios) VALUES (?, ?, ?, ?, ?, ?)',
        [r.numero, r.tipo, r.precio, r.capacidad, r.descripcion, r.servicios]);
    }
  }

  const existingSeasons = dbGet('SELECT COUNT(*) as count FROM temporadas');
  if (existingSeasons.count === 0) {
    dbRun('INSERT INTO temporadas (nombre, fecha_inicio, fecha_fin, multiplicador) VALUES (?, ?, ?, ?)', ['Temporada Baja', '2026-01-15', '2026-03-31', 0.85]);
    dbRun('INSERT INTO temporadas (nombre, fecha_inicio, fecha_fin, multiplicador) VALUES (?, ?, ?, ?)', ['Temporada Alta', '2026-06-15', '2026-08-31', 1.25]);
    dbRun('INSERT INTO temporadas (nombre, fecha_inicio, fecha_fin, multiplicador) VALUES (?, ?, ?, ?)', ['Temporada Alta Dic', '2026-12-15', '2027-01-15', 1.50]);
    dbRun('INSERT INTO temporadas (nombre, fecha_inicio, fecha_fin, multiplicador) VALUES (?, ?, ?, ?)', ['Fin de Semana', '2026-01-01', '2026-12-31', 1.10]);
  }

  const existingPromos = dbGet('SELECT COUNT(*) as count FROM promociones');
  if (existingPromos.count === 0) {
    dbRun('INSERT INTO promociones (nombre, descripcion, descuento, tipo_descuento, codigo) VALUES (?, ?, ?, ?, ?)', ['Reserva Anticipada', '15% descuento reservando 30 días antes', 15, 'porcentaje', 'ANTICIPO15']);
    dbRun('INSERT INTO promociones (nombre, descripcion, descuento, tipo_descuento, codigo) VALUES (?, ?, ?, ?, ?)', ['Estancia Larga', '20% descuento en estancias de 7+ noches', 20, 'porcentaje', 'LARGA20']);
    dbRun('INSERT INTO promociones (nombre, descripcion, descuento, tipo_descuento, codigo) VALUES (?, ?, ?, ?, ?)', ['Temporada Baja', '10% descuento en temporada baja', 10, 'porcentaje', 'BAJA10']);
  }

  saveDb();
  console.log('Base de datos inicializada correctamente');
}

module.exports = { initialize, dbAll, dbGet, dbRun };
