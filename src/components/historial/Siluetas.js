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

function Esquina({ espejo, trasera }) {
  return (
    <g {...trazo} transform={espejo ? 'translate(400 0) scale(-1 1)' : undefined}>
      <path d={trasera
        ? 'M60 220 L70 150 Q80 120 120 112 L250 104 Q300 104 330 130 L360 175 L360 225 Z'
        : 'M40 225 L40 175 L70 130 Q100 104 150 104 L280 112 Q320 120 330 150 L340 220 Z'} />
      <circle cx={trasera ? 300 : 100} cy="228" r="32" />
    </g>
  );
}

function Llanta() {
  return (
    <g {...trazo}>
      <circle cx="200" cy="150" r="105" />
      <circle cx="200" cy="150" r="62" />
      <circle cx="200" cy="150" r="14" />
    </g>
  );
}

function Interior({ trasero }) {
  return (
    <g {...trazo}>
      <rect x="70" y="70" width="110" height="170" rx="24" />
      <rect x="220" y="70" width="110" height="170" rx="24" />
      {!trasero && <circle cx="125" cy="40" r="26" />}
    </g>
  );
}

function Maleta() {
  return (
    <g {...trazo}>
      <path d="M60 110 L340 110 L320 250 L80 250 Z" />
      <path d="M90 60 L310 60 L340 110 L60 110 Z" />
    </g>
  );
}

function Cedula() {
  return (
    <g {...trazo}>
      <rect x="40" y="55" width="320" height="200" rx="14" />
      <rect x="62" y="90" width="80" height="100" rx="6" />
    </g>
  );
}

const DIBUJO = {
  frente: <Frente />,
  trasera: <Trasera />,
  lateral_izquierdo: <Lateral />,
  lateral_derecho: <Lateral espejo />,
  tablero: <Tablero />,
  esquina_del_izq: <Esquina />,
  esquina_del_der: <Esquina espejo />,
  esquina_tra_izq: <Esquina trasera espejo />,
  esquina_tra_der: <Esquina trasera />,
  llanta_del_izq: <Llanta />,
  llanta_del_der: <Llanta />,
  llanta_tra_izq: <Llanta />,
  llanta_tra_der: <Llanta />,
  interior_delantero: <Interior />,
  interior_trasero: <Interior trasero />,
  maleta: <Maleta />,
  cedula_frente: <Cedula />,
  cedula_reverso: <Cedula />,
};

export default function Silueta({ toma }) {
  if (!DIBUJO[toma]) return null;
  return (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {DIBUJO[toma]}
    </svg>
  );
}
