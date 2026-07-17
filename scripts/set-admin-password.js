const bcrypt = require('bcryptjs');
const { initialize, dbRun, dbGet } = require('../models/database');

(async () => {
  const nueva = process.argv[2];
  if (!nueva || nueva.length < 6) {
    console.error('Uso: node scripts/set-admin-password.js <nueva-contraseña (mínimo 6 caracteres)>');
    process.exit(1);
  }

  await initialize();

  const existing = dbGet('SELECT id FROM usuarios WHERE username = ?', ['admin']);
  if (!existing) {
    console.error('No existe el usuario "admin" en esta base de datos.');
    process.exit(1);
  }

  dbRun('UPDATE usuarios SET password = ? WHERE username = ?', [bcrypt.hashSync(nueva, 10), 'admin']);
  console.log('Contraseña de "admin" actualizada correctamente.');
})();
