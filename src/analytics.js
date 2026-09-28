// Eventos de analítica desacoplados y SIN proveedor por defecto.
// Para conectar uno, define window.dfTrack = (name, props) => {...} antes de cargar app.js.
// Nunca se envían ingredientes, costos ni nombres de recetas. Abrir el checkout NO es una compra.
export function track(name, props = {}) {
  try {
    if (typeof window !== 'undefined' && typeof window.dfTrack === 'function') window.dfTrack(name, props);
  } catch { /* la analítica nunca rompe la calculadora */ }
}
