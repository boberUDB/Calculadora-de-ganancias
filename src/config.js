// Configuración comercial en un solo lugar.
// Mientras `status` no sea 'disponible' Y no haya `checkoutUrl` real, la web muestra "Kit en preparación"
// y no ofrece compra, descarga ni registro de correos.
export const KIT = {
  name: 'Kit Ponle precio a tus postres',
  includes: ['Hoja de pedidos y anticipos', 'Cotización editable', 'Guía breve de uso'],
  price: 15,
  currency: 'USD',
  status: 'preparacion', // 'preparacion' | 'disponible' | 'oculto'
  checkoutUrl: '', // enlace HTTPS del checkout externo autorizado (Gumroad, Hotmart, Lemon Squeezy, etc.)
};

// URL pública que se comparte. Vacío = la dirección actual sin parámetros.
export const SITE_URL = 'https://boberudb.github.io/Calculadora-de-ganancias/';

export const kitIsLive = () => KIT.status === 'disponible' && /^https:\/\//.test(KIT.checkoutUrl);
