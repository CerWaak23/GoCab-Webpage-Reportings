/**
 * Siluetas que se superponen a la cámara para encuadrar cada toma igual
 * siempre (R8): así las fotos de distintas fechas se pueden comparar.
 */
const trazo = { fill: 'none', stroke: 'white', strokeWidth: 3, strokeDasharray: '10 7', strokeLinejoin: 'round', strokeLinecap: 'round', opacity: 0.85 };

function Frente() {
  return (
    <g {...trazo}>
      <path d="M70 230 L80 150 Q90 115 130 108 L270 108 Q310 115 320 150 L330 230 Z" />
      <path d="M110 150 L120 118 L280 118 L290 150 Z" />
      <rect x="95" y="185" width="50" height="22" rx="8" />
      <rect x="255" y="185" width="50" height="22" rx="8" />
      <rect x="160" y="200" width="80" height="18" rx="3" />
      <path d="M85 230 L85 262 L125 262 L125 230 M275 230 L275 262 L315 262 L315 230" />
    </g>
  );
}

function Trasera() {
  return (
    <g {...trazo}>
      <path d="M70 230 L78 160 Q88 118 130 110 L270 110 Q312 118 322 160 L330 230 Z" />
      <path d="M115 158 L125 122 L275 122 L285 158 Z" />
      <rect x="88" y="178" width="58" height="26" rx="6" />
      <rect x="254" y="178" width="58" height="26" rx="6" />
      <rect x="165" y="196" width="70" height="20" rx="3" />
      <path d="M85 230 L85 262 L125 262 L125 230 M275 230 L275 262 L315 262 L315 230" />
    </g>
  );
}

function Lateral({ espejo }) {
  return (
    <g {...trazo} transform={espejo ? 'translate(400 0) scale(-1 1)' : undefined}>
      <path d="M20 205 L28 170 Q40 150 80 145 L130 110 Q150 98 185 98 L265 98 Q295 100 318 125 L345 148 Q378 155 382 180 L382 205 Z" />
      <path d="M140 145 L165 112 L220 112 L220 145 Z M232 145 L232 112 L280 112 Q300 118 318 145 Z" />
      <circle cx="98" cy="210" r="30" />
      <circle cx="310" cy="210" r="30" />
    </g>
  );
}

function Tablero() {
  return (
    <g {...trazo}>
      <rect x="50" y="80" width="300" height="150" rx="40" />
      <circle cx="140" cy="155" r="48" />
      <circle cx="260" cy="155" r="48" />
      <rect x="170" y="205" width="60" height="18" rx="4" />
    </g>
  );
}

const DIBUJO = {
  frente: <Frente />,
  trasera: <Trasera />,
  lateral_izquierdo: <Lateral />,
  lateral_derecho: <Lateral espejo />,
  tablero: <Tablero />,
};

export default function Silueta({ toma }) {
  if (!DIBUJO[toma]) return null;
  return (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {DIBUJO[toma]}
    </svg>
  );
}
