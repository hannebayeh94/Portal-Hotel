const express = require('express');
const bcrypt = require('bcryptjs');
const { dbGet, dbRun } = require('../models/database');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null, isProd: process.env.NODE_ENV === 'production' });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = dbGet('SELECT * FROM usuarios WHERE username = ?', [username]);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { error: 'Usuario o contraseña incorrectos', isProd: process.env.NODE_ENV === 'production' });
  }
  req.session.user = { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol };
  res.redirect('/');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

router.get('/perfil', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('perfil', { error: null, success: null });
});

router.post('/perfil/cambiar-password', (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  const { password_actual, nueva_password, confirmar_password } = req.body;

  if (!password_actual || !nueva_password || !confirmar_password) {
    return res.render('perfil', { error: 'Todos los campos son obligatorios', success: null });
  }

  if (nueva_password.length < 6) {
    return res.render('perfil', { error: 'La nueva contraseña debe tener al menos 6 caracteres', success: null });
  }

  if (nueva_password !== confirmar_password) {
    return res.render('perfil', { error: 'La nueva contraseña y la confirmación no coinciden', success: null });
  }

  const user = dbGet('SELECT * FROM usuarios WHERE id = ?', [req.session.user.id]);
  if (!user || !bcrypt.compareSync(password_actual, user.password)) {
    return res.render('perfil', { error: 'La contraseña actual es incorrecta', success: null });
  }

  const hashed = bcrypt.hashSync(nueva_password, 10);
  dbRun('UPDATE usuarios SET password = ? WHERE id = ?', [hashed, req.session.user.id]);

  res.render('perfil', { error: null, success: 'Contraseña actualizada exitosamente' });
});

module.exports = router;
