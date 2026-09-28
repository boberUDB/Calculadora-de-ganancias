// Doña Fresa en SVG ligero (original). Colores desde variables CSS para ambos temas.
export const mascotSVG = (title = 'Doña Fresa') => `
<svg class="mascot" viewBox="0 0 120 132" role="img" aria-label="${title}">
  <g class="m-legs" stroke="var(--cacao-line)" stroke-width="5" stroke-linecap="round" fill="none">
    <path d="M50 116 L47 128"/><path d="M70 116 L73 128"/>
  </g>
  <g class="m-arm-l" stroke="var(--cacao-line)" stroke-width="5" stroke-linecap="round" fill="none"><path d="M18 70 Q8 76 7 86"/></g>
  <g class="m-arm-r" stroke="var(--cacao-line)" stroke-width="5" stroke-linecap="round" fill="none"><path d="M102 70 Q112 64 114 54"/></g>
  <path class="m-body" d="M60 24C92 20 112 40 106 67C100 96 79 117 60 121C41 117 20 96 14 67C8 40 28 20 60 24Z" fill="var(--berry-body)"/>
  <path d="M26 40C30 32 38 28 46 27" stroke="#fff" stroke-opacity=".35" stroke-width="4" stroke-linecap="round" fill="none"/>
  <g fill="var(--seed)">
    <ellipse cx="30" cy="58" rx="1.6" ry="2.4"/><ellipse cx="92" cy="56" rx="1.6" ry="2.4"/>
    <ellipse cx="24" cy="76" rx="1.6" ry="2.4"/><ellipse cx="97" cy="78" rx="1.6" ry="2.4"/>
    <ellipse cx="44" cy="36" rx="1.6" ry="2.4"/><ellipse cx="78" cy="36" rx="1.6" ry="2.4"/>
    <ellipse cx="30" cy="94" rx="1.6" ry="2.4"/><ellipse cx="90" cy="96" rx="1.6" ry="2.4"/>
  </g>
  <path d="M60 26C52 12 40 12 34 18C44 18 50 22 54 27C44 24 36 28 32 34C44 30 52 30 60 30C68 30 76 30 88 34C84 28 76 24 66 27C70 22 76 18 86 18C80 12 68 12 60 26Z" fill="var(--leaf)"/>
  <path d="M60 26 L61 10" stroke="var(--leaf-dark)" stroke-width="3" stroke-linecap="round"/>
  <g class="m-face">
    <path d="M40 46 Q45 43 50 46M70 46 Q75 43 80 46" stroke="var(--cacao-line)" stroke-width="2.4" stroke-linecap="round" fill="none"/>
    <ellipse cx="45" cy="55" rx="5" ry="6" fill="var(--eye)"/><ellipse cx="75" cy="55" rx="5" ry="6" fill="var(--eye)"/>
    <circle cx="46.8" cy="52.8" r="1.7" fill="#fff"/><circle cx="76.8" cy="52.8" r="1.7" fill="#fff"/>
    <ellipse class="m-blush" cx="34" cy="64" rx="5" ry="3" fill="#fff" fill-opacity=".28"/>
    <ellipse class="m-blush" cx="86" cy="64" rx="5" ry="3" fill="#fff" fill-opacity=".28"/>
    <path class="m-mouth" d="M53 64 Q60 70 67 64" stroke="var(--cacao-line)" stroke-width="2.6" stroke-linecap="round" fill="none"/>
  </g>
  <path d="M36 76 Q60 70 84 76 L81 104 Q60 114 39 104Z" fill="var(--apron)"/>
  <path d="M36 76 L30 66M84 76 L90 66" stroke="var(--apron)" stroke-width="3.5" stroke-linecap="round"/>
  <rect x="50" y="87" width="20" height="13" rx="4" fill="var(--pocket)"/>
  <path d="M50 91 H70" stroke="var(--apron)" stroke-width="1.5" stroke-opacity=".7"/>
</svg>`;
