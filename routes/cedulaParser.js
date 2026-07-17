const MESES = {
  ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6,
  JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12
};

const ACENTOS = { 'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ñ': 'N' };
function stripAccents(s) {
  return s.toUpperCase().replace(/[ÁÉÍÓÚ]/g, c => ACENTOS[c] || c);
}

function cleanLines(text) {
  return text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// Construye 'YYYY-MM-DD' a partir de un día, un mes en texto (ENE, FEB, ...) y un año.
function fechaDesdeMesTexto(dia, mesTxt, anio) {
  const key = stripAccents(mesTxt.toUpperCase()).slice(0, 3);
  const mes = MESES[key];
  if (!mes || !dia || !anio) return '';
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

const LABELS_FRENTE = /^(NUMERO|APELLID|NOMBRE|FIRMA|REPUBLICA|IDENTIFICACION|CEDULA|PERSONAL)/;

// La cédula colombiana (formato laminado) imprime el VALOR primero y la
// ETIQUETA justo debajo (p.ej. "BAYEH VILLARREAL" seguido de "APELLIDOS"),
// excepto el número que va "NUMERO <valor>" en la misma línea.
function parseCedulaFrente(text) {
  const datos = { nombre: '', apellido: '', numero_cedula: '' };
  const lines = cleanLines(text);
  const upper = lines.map(l => l.toUpperCase());

  for (let i = 0; i < upper.length; i++) {
    if (/NUMERO/.test(upper[i])) {
      const rest = upper[i].replace(/.*NUMERO\s*[:\-]?\s*/, '');
      let m = rest.match(/\d[\d.\s]{5,14}\d/);
      if (!m && upper[i + 1]) m = upper[i + 1].match(/\d[\d.\s]{5,14}\d/);
      if (m) { datos.numero_cedula = m[0].replace(/[^\d]/g, ''); break; }
    }
  }
  if (!datos.numero_cedula) {
    const m = text.match(/\b(\d{1,3}(?:[.\s]\d{3}){1,3})\b/);
    if (m) datos.numero_cedula = m[1].replace(/[^\d]/g, '');
  }
  if (!datos.numero_cedula) {
    const m = text.match(/\b(\d{6,10})\b/);
    if (m) datos.numero_cedula = m[1];
  }

  function valorAntesDeEtiqueta(labelRegex) {
    for (let i = 0; i < upper.length; i++) {
      if (labelRegex.test(upper[i])) {
        for (let j = i - 1; j >= 0 && i - j <= 3; j--) {
          if (!LABELS_FRENTE.test(upper[j]) && /[A-ZÁÉÍÓÚÑ]{2,}/.test(upper[j])) {
            return lines[j];
          }
        }
      }
    }
    return '';
  }

  datos.apellido = valorAntesDeEtiqueta(/^APELLID/);
  datos.nombre = valorAntesDeEtiqueta(/^NOMBRE/);

  if (!datos.nombre || !datos.apellido) {
    // No se ancla la línea completa: el OCR suele dejar ruido pegado antes
    // o después del nombre real (p.ej. "HANNE JOSE po"), así que se toma
    // la corrida de palabras en mayúscula más larga dentro de la línea.
    const candidatas = [];
    for (let i = 0; i < upper.length; i++) {
      if (LABELS_FRENTE.test(upper[i])) continue;
      if (/COLOMBIA|IDENTIFICACION|PERSONAL|CIUDADANIA/.test(upper[i])) continue;
      const matches = upper[i].match(/[A-ZÁÉÍÓÚÑ]{3,}(?:\s+[A-ZÁÉÍÓÚÑ]{3,})+/g);
      if (matches) candidatas.push(matches.sort((a, b) => b.length - a.length)[0]);
    }
    const restantes = candidatas.filter(c => c !== datos.apellido.toUpperCase() && c !== datos.nombre.toUpperCase());
    if (!datos.apellido && restantes[0]) datos.apellido = restantes[0];
    if (!datos.nombre && restantes[1]) datos.nombre = restantes[1];
  }

  return datos;
}

// Reverso: aquí también manda "valor arriba, etiqueta abajo" salvo en
// "FECHA DE NACIMIENTO <valor>" que va en una sola línea. Las fechas se
// imprimen como "07-JUL-1994" (mes en texto), no numéricas.
function parseCedulaReverso(text) {
  const datos = {
    fecha_nacimiento: '', lugar_nacimiento: '', estatura: '',
    sexo: '', grupo_sanguineo: '', fecha_expedicion: '', lugar_expedicion: ''
  };
  const lines = cleanLines(text);
  const upper = lines.map(l => l.toUpperCase());
  const fullUpper = upper.join('\n');

  let m = fullUpper.match(/NACIMIENTO\D{0,10}(\d{1,2})[\s\-\/.]+([A-ZÑ]{3,9})[\s\-\/.]+(\d{4})/);
  if (m) datos.fecha_nacimiento = fechaDesdeMesTexto(m[1], m[2], m[3]);
  if (!datos.fecha_nacimiento) {
    m = fullUpper.match(/NACIMIENTO\D{0,10}(\d{2})[\s\-\/](\d{2})[\s\-\/](\d{4})/);
    if (m) datos.fecha_nacimiento = `${m[3]}-${m[2]}-${m[1]}`;
  }

  m = fullUpper.match(/(\d\.\d{2})\s+([ABO]{1,2}\s*[+\-])\s*([MF])\b/);
  if (m) {
    datos.estatura = m[1];
    datos.grupo_sanguineo = m[2].replace(/\s+/g, '');
    datos.sexo = m[3];
  } else {
    m = fullUpper.match(/(\d\.\d{2})\s*\n?\s*ESTATURA/);
    if (m) datos.estatura = m[1];
    m = fullUpper.match(/([ABO]{1,2}\s*[+\-])\s*\n?\s*G\.?\s*S\.?\s*RH/);
    if (m) datos.grupo_sanguineo = m[1].replace(/\s+/g, '');
    m = fullUpper.match(/\b([MF])\b\s*\n?\s*SEXO/);
    if (m) datos.sexo = m[1];
  }

  function extraerNombrePropio(linea) {
    // El fondo con textura del carné suele leerse como palabras sueltas de
    // 1-3 letras pegadas al nombre real; se descartan y se queda solo con
    // las palabras de 4+ letras (o entre paréntesis, para el departamento).
    const tokens = linea.match(/\(?[A-ZÁÉÍÓÚÑ]{4,}\)?/g);
    return tokens ? tokens.join(' ') : '';
  }

  for (let i = 0; i < upper.length; i++) {
    if (/LUGAR\s+DE\s+NACIMIENTO/.test(upper[i])) {
      const vals = [];
      for (let j = i - 1; j >= 0 && i - j <= 4; j--) {
        if (/NACIMIENTO.*\d{4}/.test(upper[j])) break;
        if (/^(ESTATURA|SEXO|G\.?\s*S\.?\s*RH)/.test(upper[j])) break;
        const limpio = extraerNombrePropio(upper[j]);
        if (limpio) vals.unshift(limpio);
      }
      datos.lugar_nacimiento = vals.join(' ').replace(/\s+/g, ' ').trim();
      break;
    }
  }

  for (let i = 0; i < upper.length; i++) {
    if (/FECHA\s+Y\s+LUGAR\s+DE\s+EXPEDICI/.test(upper[i])) {
      const prev = lines[i - 1] || '';
      const mm = prev.toUpperCase().match(/(\d{1,2})[\s\-\/.]+([A-ZÑ]{3,9})[\s\-\/.]+(\d{4})\s+([A-ZÁÉÍÓÚÑ\s]{2,40})/);
      if (mm) {
        datos.fecha_expedicion = fechaDesdeMesTexto(mm[1], mm[2], mm[3]);
        datos.lugar_expedicion = extraerNombrePropio(mm[4]);
      }
      break;
    }
  }
  if (!datos.fecha_expedicion) {
    m = fullUpper.match(/EXPEDICI[OÓ]N\D{0,10}(\d{1,2})[\s\-\/.]+([A-ZÑ]{3,9})[\s\-\/.]+(\d{4})/);
    if (m) datos.fecha_expedicion = fechaDesdeMesTexto(m[1], m[2], m[3]);
  }

  return datos;
}

// El PDF417 del reverso codifica un registro con campos de ancho fijo
// rellenos con bytes 0x00. `raw` debe ser la cadena obtenida a partir de
// los bytes crudos (ReadResult.bytes), no `ReadResult.text`: por defecto
// zxing-wasm devuelve el texto en modo "HRI", que reemplaza los bytes no
// imprimibles por mnemónicos legibles como "<NUL>" (texto real, no un
// carácter de control), lo cual rompe cualquier split por \x00.
function parseBarcodeRecord(raw) {
  const datos = {};
  const tokens = raw.split(/\x00+/).map(t => t.trim()).filter(Boolean);

  // El campo "PubDSK_..." (clave pública) precede siempre al número de
  // cédula en el registro; buscar el número antes de ese punto arriesga
  // capturar otro código de serie/control que aparece más temprano.
  const pubIdx = tokens.findIndex(t => /^Pub/i.test(t));
  const inicio = pubIdx >= 0 ? pubIdx + 1 : 0;

  for (let i = inicio; i < tokens.length; i++) {
    const m = tokens[i].match(/^(\d{6,10})([A-ZÁÉÍÓÚÑ]{2,})$/);
    if (m) {
      datos.numero_cedula = m[1];
      const nombres = [m[2]];
      for (let k = i + 1; k < tokens.length && nombres.length < 4; k++) {
        const t = tokens[k];
        if (/^[A-ZÁÉÍÓÚÑ\s]{2,30}$/.test(t)) nombres.push(t);
        else break;
      }
      if (nombres[0] || nombres[1]) datos.apellido = [nombres[0], nombres[1]].filter(Boolean).join(' ');
      if (nombres[2] || nombres[3]) datos.nombre = [nombres[2], nombres[3]].filter(Boolean).join(' ');
      break;
    }
  }

  // Si el recorte llegó truncado y no se ve el número pegado al apellido,
  // se busca el primer número "suelto" luego del marcador Pub (nunca antes).
  if (!datos.numero_cedula && pubIdx >= 0) {
    for (let i = inicio; i < tokens.length; i++) {
      if (/^\d{6,10}$/.test(tokens[i])) { datos.numero_cedula = tokens[i]; break; }
    }
  }

  const mm = raw.match(/([MF])(\d{8})/);
  if (mm) {
    datos.sexo = mm[1];
    const f = mm[2];
    const anio = f.slice(0, 4), mes = f.slice(4, 6), dia = f.slice(6, 8);
    if (mes >= '01' && mes <= '12' && dia >= '01' && dia <= '31') {
      datos.fecha_nacimiento = `${anio}-${mes}-${dia}`;
    }
  }

  return datos;
}

module.exports = { parseCedulaFrente, parseCedulaReverso, parseBarcodeRecord, fechaDesdeMesTexto, cleanLines };
