const Jimp = require('jimp');
const { createWorker } = require('tesseract.js');
const { parseCedulaFrente, parseCedulaReverso, parseBarcodeRecord } = require('./cedulaParser');

const KEYWORDS = [
  'REPUBLICA', 'COLOMBIA', 'IDENTIFICACION', 'CEDULA', 'CIUDADANIA', 'NUMERO',
  'APELLID', 'NOMBRE', 'FIRMA', 'FECHA', 'NACIMIENTO', 'LUGAR', 'ESTATURA',
  'SEXO', 'EXPEDICION', 'REGISTRADOR', 'NACIONAL', 'INDICE', 'DERECHO', 'GRUPO'
];

function puntuarTexto(text, confidence) {
  const upper = text.toUpperCase();
  let hits = 0;
  for (const kw of KEYWORDS) {
    if (upper.includes(kw)) hits++;
  }
  return (confidence || 0) + hits * 20;
}

function escalarA2000(clon) {
  const scale = 2000 / clon.bitmap.width;
  if (scale > 1) clon.resize(2000, Math.round(clon.bitmap.height * scale));
  return clon;
}

// Un binarizado duro (umbral global) puede verse bien a simple vista pero
// termina borrando trazos finos bajo el laminado/reflejos y empeora la
// confianza de Tesseract, que ya trae su propio binarizado adaptativo
// (Leptonica). Se prueban ambos enfoques y se usa el que mejor puntúe.
function preprocesarLiviano(img) {
  const clon = escalarA2000(img.clone());
  clon.greyscale().contrast(0.3).normalize();
  return clon;
}

function preprocesarBinarizado(img) {
  const clon = escalarA2000(img.clone());
  clon.greyscale().contrast(0.9).normalize();

  let sum = 0, count = 0;
  clon.scan(0, 0, clon.bitmap.width, clon.bitmap.height, function (x, y, idx) {
    sum += this.bitmap.data[idx];
    count++;
  });
  const avg = sum / count;
  const threshold = Math.min(avg + 20, 180);

  let whitePixels = 0;
  clon.scan(0, 0, clon.bitmap.width, clon.bitmap.height, function (x, y, idx) {
    const gray = this.bitmap.data[idx];
    const val = gray > threshold ? 255 : 0;
    this.bitmap.data[idx] = val;
    this.bitmap.data[idx + 1] = val;
    this.bitmap.data[idx + 2] = val;
    if (val === 255) whitePixels++;
  });

  const totalPixels = clon.bitmap.width * clon.bitmap.height;
  if (whitePixels / totalPixels < 0.3) clon.invert();

  return clon;
}

// Las fotos reales llegan giradas 90/180/270 con bastante frecuencia
// (cédula fotografiada en horizontal con el celular en vertical). Se
// prueban las 4 rotaciones a baja resolución y se elige la que produce
// más coincidencias de palabras clave del documento + mejor confianza.
async function detectarRotacion(worker, img) {
  let mejor = { angle: 0, score: -1, text: '', confidence: 0 };
  for (const angle of [0, 90, 180, 270]) {
    const prueba = img.clone();
    if (angle) prueba.rotate(angle);
    prueba.resize(800, Jimp.AUTO).greyscale().contrast(0.5);
    const buffer = await prueba.getBufferAsync(Jimp.MIME_PNG);
    const { data } = await worker.recognize(buffer);
    const score = puntuarTexto(data.text, data.confidence);
    if (score > mejor.score) mejor = { angle, score, text: data.text, confidence: data.confidence };
  }
  return mejor;
}

// Intenta decodificar el código PDF417 del reverso. La franja del código
// suele quedar en el tercio inferior de la tarjeta; se prueba la imagen
// completa y varios recortes proporcionales a distintas escalas, sin
// depender de coordenadas fijas de una foto en particular.
async function decodificarBarcode(img) {
  let readBarcodes;
  try {
    readBarcodes = require('zxing-wasm/reader').readBarcodes;
  } catch (e) {
    return null;
  }

  const w = img.bitmap.width, h = img.bitmap.height;
  const intentos = [
    { crop: null, scale: 1 },
    { crop: null, scale: 2 },
    { crop: [0.55, 0.30], scale: 3 },
    { crop: [0.55, 0.30], scale: 2 },
    { crop: [0.45, 0.40], scale: 3 },
    { crop: [0.60, 0.25], scale: 3 },
    { crop: [0, 1], scale: 3 }
  ];

  const CAMPOS_CLAVE = ['numero_cedula', 'nombre', 'apellido', 'sexo', 'fecha_nacimiento'];
  let mejor = null;
  let mejorPuntaje = -1;

  for (const intento of intentos) {
    try {
      let work = img.clone();
      if (intento.crop) {
        const [y0f, hf] = intento.crop;
        work = work.crop(0, Math.round(h * y0f), w, Math.round(h * hf));
      }
      if (intento.scale !== 1) work = work.scale(intento.scale, Jimp.RESIZE_BICUBIC);
      const buffer = await work.getBufferAsync(Jimp.MIME_PNG);
      const results = await readBarcodes(new Uint8Array(buffer), {
        formats: ['PDF417'], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: false
      });
      const valido = results.find(r => r.isValid && r.bytes && r.bytes.length > 20);
      if (!valido) continue;

      // bytes crudos, no `text` (que por defecto viene en modo "HRI" y
      // sustituye los bytes 0x00 por el texto literal "<NUL>").
      const raw = Buffer.from(valido.bytes).toString('latin1');
      const datos = parseBarcodeRecord(raw);
      const puntaje = CAMPOS_CLAVE.filter(c => datos[c]).length;
      if (puntaje > mejorPuntaje) {
        mejorPuntaje = puntaje;
        mejor = { raw, datos };
      }
      if (puntaje === CAMPOS_CLAVE.length) break; // registro completo, no hace falta seguir probando recortes
    } catch (e) {
      // se sigue intentando con el siguiente recorte
    }
  }

  return mejorPuntaje > 0 ? mejor : null;
}

function contarCampos(datos) {
  return Object.values(datos).filter(v => v && String(v).trim()).length;
}

// lado: 'frente' | 'reverso'
async function extraerDatosCedula(imagePath, lado) {
  const original = await Jimp.read(imagePath);
  const worker = await createWorker('spa');

  try {
    const rotacion = await detectarRotacion(worker, original);
    const upright = original.clone();
    if (rotacion.angle) upright.rotate(rotacion.angle);

    let barcode = null;
    if (lado === 'reverso') {
      barcode = await decodificarBarcode(upright);
    }

    const candidatosFinal = [preprocesarLiviano(upright), preprocesarBinarizado(upright)];
    let data = null;
    for (const candidato of candidatosFinal) {
      const buffer = await candidato.getBufferAsync(Jimp.MIME_PNG);
      const resultado = await worker.recognize(buffer);
      const score = puntuarTexto(resultado.data.text, resultado.data.confidence);
      if (!data || score > data._score) { data = resultado.data; data._score = score; }
    }

    const ocrDatos = lado === 'reverso' ? parseCedulaReverso(data.text) : parseCedulaFrente(data.text);
    const datos = { ...ocrDatos, ...(barcode ? barcode.datos : {}) };

    const filled = contarCampos(datos);
    const engine = barcode ? (filled > Object.keys(barcode.datos).length ? 'barcode+tesseract' : 'barcode') : 'tesseract';

    return {
      success: filled >= 2,
      engine,
      datos,
      text: data.text,
      confidence: Math.round(data.confidence),
      rotacionDetectada: rotacion.angle,
      warning: barcode ? undefined :
        (data.confidence < 60 ? 'La calidad del OCR es baja. Verifique y corrija los datos manualmente.' :
         filled < 2 ? 'No se pudo extraer suficiente información de la imagen. Ingrese los datos manualmente.' : undefined)
    };
  } finally {
    await worker.terminate();
  }
}

module.exports = { extraerDatosCedula };
