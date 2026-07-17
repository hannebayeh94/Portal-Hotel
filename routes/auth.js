const express = require('express');
const bcrypt = require('bcryptjs');
const { dbGet } = require('../models/database');
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

module.exports = router;
