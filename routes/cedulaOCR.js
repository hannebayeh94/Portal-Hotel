const Jimp = require('jimp');
const { createWorker } = require('tesseract.js');
const { parseCedulaFrente, parseCedulaReverso, parseBarcodeRecord } = require('./cedulaParser');

const KEYWORDS = [
  'REPUBLICA', 'COLOMBIA', 'IDENTIFICACION', 'CEDULA', 'CIUDADANIA', 'NUMERO',
  'APELLID', 'NOMBRE', 'FIRMA', 'FECHA', 'NACIMIENTO', 'LUGAR', 'ESTATURA',
  'SEXO', 'EXPEDICION', 'REGISTRADOR', 'NACIONAL', 'INDICE', 'DERECHO', 'GRUPO'
];

function contarHits(text) {
  const upper = text.toUpperCase();
  let hits = 0;
  for (const kw of KEYWORDS) {
    if (upper.includes(kw)) hits++;
  }
  return hits;
}

function puntuarTexto(text, confidence) {
  return (confidence || 0) + contarHits(text) * 20;
}

// El reconocimiento es el cuello de botella: no hace falta pasar de ~1600px
// de ancho para una cédula y bajar la resolución reduce mucho el tiempo.
const OCR_MAX_WIDTH = 1600;

function escalarParaOCR(clon) {
  const scale = OCR_MAX_WIDTH / clon.bitmap.width;
  if (scale > 1) clon.resize(OCR_MAX_WIDTH, Math.round(clon.bitmap.height * scale));
  return clon;
}

// Un binarizado duro (umbral global) puede verse bien a simple vista pero
// termina borrando trazos finos bajo el laminado/reflejos y empeora la
// confianza de Tesseract, que ya trae su propio binarizado adaptativo
// (Leptonica). Se prueban ambos enfoques y se usa el que mejor puntúe.
function preprocesarLiviano(img) {
  const clon = escalarParaOCR(img.clone());
  clon.greyscale().contrast(0.3).normalize();
  return clon;
}

function preprocesarBinarizado(img) {
  const clon = escalarParaOCR(img.clone());
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
  let mejor = { angle: 0, score: -1, text: '', confidence: 0, hits: 0 };
  for (const angle of [0, 90, 180, 270]) {
    const prueba = img.clone();
    if (angle) prueba.rotate(angle);
    prueba.resize(800, Jimp.AUTO).greyscale().contrast(0.5);
    const buffer = await prueba.getBufferAsync(Jimp.MIME_PNG);
    const { data } = await worker.recognize(buffer);
    const hits = contarHits(data.text);
    const score = puntuarTexto(data.text, data.confidence);
    if (score > mejor.score) mejor = { angle, score, text: data.text, confidence: data.confidence, hits };
    // Si ya se leen varias palabras clave, la orientación es la correcta:
    // no vale la pena seguir probando rotaciones.
    if (hits >= 4) break;
  }
  return mejor;
}

// El PDF417 del reverso suele quedar en la franja inferior de la tarjeta; se
// prueba la imagen completa y varios recortes proporcionales a distintas
// escalas, sin depender de coordenadas fijas de una foto en particular.
const INTENTOS_BARCODE = [
  { crop: null, scale: 1 },
  { crop: null, scale: 2 },
  { crop: [0.55, 0.30], scale: 3 },
  { crop: [0.55, 0.30], scale: 2 },
  { crop: [0.45, 0.40], scale: 3 },
  { crop: [0.60, 0.25], scale: 3 },
  { crop: [0, 1], scale: 3 }
];

// Pasada corta para encontrar la orientación: solo los recortes que en la
// práctica resuelven el código del reverso. Así no se barre todo el listado
// por cada rotación.
const INTENTOS_BARCODE_RAPIDOS = [
  { crop: [0.55, 0.30], scale: 3 },
  { crop: [0.55, 0.30], scale: 2 },
  { crop: [0.45, 0.40], scale: 3 }
];

const CAMPOS_BARCODE = ['numero_cedula', 'nombre', 'apellido', 'sexo', 'fecha_nacimiento'];

let lectorBarcode;
function getLectorBarcode() {
  if (lectorBarcode === undefined) {
    try {
      lectorBarcode = require('zxing-wasm/reader').readBarcodes;
    } catch (e) {
      lectorBarcode = null;
    }
  }
  return lectorBarcode;
}

async function intentarIntentosBarcode(img, intentos) {
  const readBarcodes = getLectorBarcode();
  if (!readBarcodes) return null;

  const w = img.bitmap.width, h = img.bitmap.height;
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
      const puntaje = CAMPOS_BARCODE.filter(c => datos[c]).length;
      if (puntaje > mejorPuntaje) {
        mejorPuntaje = puntaje;
        mejor = { raw, datos };
      }
      if (puntaje === CAMPOS_BARCODE.length) break; // registro completo
    } catch (e) {
      // se sigue intentando con el siguiente recorte
    }
  }

  return mejorPuntaje > 0 ? mejor : null;
}

function decodificarBarcode(img) {
  return intentarIntentosBarcode(img, INTENTOS_BARCODE);
}

// Prueba el código en las 4 orientaciones. Si acierta, además de los datos
// nos dice cuánto hay que girar la imagen para dejarla derecha.
async function decodificarBarcodeConOrientacion(img) {
  for (const angle of [0, 90, 270, 180]) {
    const work = img.clone();
    if (angle) work.rotate(angle);
    const encontrado = await intentarIntentosBarcode(work, INTENTOS_BARCODE_RAPIDOS);
    if (encontrado) return { ...encontrado, angle };
  }
  return null;
}

function contarCampos(datos) {
  return Object.values(datos).filter(v => v && String(v).trim()).length;
}

const CAMPOS_BARCODE_CLAVE = ['numero_cedula', 'nombre', 'apellido'];

// Con estos tres campos ya se puede registrar al huésped; si el PDF417 los
// trae, no vale la pena gastar tiempo en Tesseract.
function barcodeCompleto(datos) {
  return CAMPOS_BARCODE_CLAVE.every(c => datos[c] && String(datos[c]).trim());
}

// Un solo worker de Tesseract para todo el proceso: antes se creaba (y se
// descargaba el idioma) en cada escaneo, que es lo que más demoraba.
let workerPromise = null;
let colaOCR = Promise.resolve();

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('spa').catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

// Serializa el uso del worker: se reutiliza entre peticiones, pero solo un
// reconocimiento a la vez, que es como Tesseract.js está pensado.
function conWorker(fn) {
  const tarea = colaOCR.then(async () => fn(await getWorker()));
  colaOCR = tarea.then(
    () => undefined,
    async () => {
      // Si el worker falló, se descarta para recrearlo en la próxima petición.
      if (workerPromise) {
        try { await (await workerPromise).terminate(); } catch (e) { /* ya estaba caído */ }
        workerPromise = null;
      }
    }
  );
  return tarea;
}

// lado: 'frente' | 'reverso'
async function extraerDatosCedula(imagePath, lado) {
  const original = await Jimp.read(imagePath);

  // Reverso: primero intentamos orientar la tarjeta y leer el código de
  // barras. Si viene completo, se devuelve de inmediato sin Tesseract.
  let barcodeOrientado = null;
  if (lado === 'reverso') {
    barcodeOrientado = await decodificarBarcodeConOrientacion(original);
    if (barcodeOrientado && barcodeCompleto(barcodeOrientado.datos)) {
      return {
        success: true,
        engine: 'barcode',
        datos: barcodeOrientado.datos,
        text: '',
        confidence: 100,
        rotacionDetectada: barcodeOrientado.angle
      };
    }
  }

  return conWorker(async (worker) => {
    // Si el código de barras ya nos dio la orientación, no hace falta gastar
    // 4 reconocimientos de Tesseract en detectarla.
    let rotacion;
    let barcode = null;
    if (barcodeOrientado) {
      rotacion = { angle: barcodeOrientado.angle, confidence: 100, hits: 0 };
      barcode = { datos: barcodeOrientado.datos };
    } else {
      rotacion = await detectarRotacion(worker, original);
    }

    const upright = original.clone();
    if (rotacion.angle) upright.rotate(rotacion.angle);

    if (lado === 'reverso' && !barcode) {
      barcode = await decodificarBarcode(upright);
      if (barcode && barcodeCompleto(barcode.datos)) {
        const filled = contarCampos(barcode.datos);
        return {
          success: filled >= 2,
          engine: 'barcode',
          datos: barcode.datos,
          text: '',
          confidence: 100,
          rotacionDetectada: rotacion.angle
        };
      }
    }

    const candidatosFinal = [preprocesarLiviano(upright), preprocesarBinarizado(upright)];
    let data = null;
    for (const candidato of candidatosFinal) {
      const buffer = await candidato.getBufferAsync(Jimp.MIME_PNG);
      const resultado = await worker.recognize(buffer);
      const score = puntuarTexto(resultado.data.text, resultado.data.confidence);
      if (!data || score > data._score) { data = resultado.data; data._score = score; }
      // Si el primer preprocesado ya lee varias palabras clave, el
      // binarizado duro no va a mejorar el resultado.
      if (contarHits(resultado.data.text) >= 4) break;
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
  });
}

module.exports = { extraerDatosCedula };
