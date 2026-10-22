// Quita los saltos de línea de un valor que viene de la petición antes de
// escribirlo en el log, para que no pueda fabricar entradas falsas.
export default function sanitizeForLog(value) {
  return String(value).replace(/[\r\n]+/g, ' ');
}
