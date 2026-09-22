/**
 * The two pictures on the mode chooser.
 *
 * A sentence explaining "one device" versus "two devices" is slower to read
 * than a drawing of a phone on its own next to a drawing of a phone talking to
 * a laptop, so the drawings carry the choice and the words confirm it.
 */

const BOARD_RINGS = [26, 20, 13, 6, 2.4];

function Board({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {BOARD_RINGS.map((r, index) => (
        <circle
          key={r}
          r={r}
          fill={index === BOARD_RINGS.length - 1 ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={1.4}
          opacity={index === 0 ? 1 : 0.55}
        />
      ))}
      {[0, 45, 90, 135].map((angle) => (
        <line
          key={angle}
          x1={-26 * Math.cos((angle * Math.PI) / 180)}
          y1={-26 * Math.sin((angle * Math.PI) / 180)}
          x2={26 * Math.cos((angle * Math.PI) / 180)}
          y2={26 * Math.sin((angle * Math.PI) / 180)}
          stroke="currentColor"
          strokeWidth={1}
          opacity={0.4}
        />
      ))}
      {/* A dart in the treble, so it reads as a board in use. */}
      <g transform="translate(6 -16) rotate(35)" stroke="var(--accent)" strokeWidth={2.2} strokeLinecap="round">
        <line x1={0} y1={0} x2={11} y2={0} />
        <path d="M11 -3 L16 0 L11 3" fill="none" />
      </g>
    </g>
  );
}

function Phone({ x, y, rotate = 0 }: { x: number; y: number; rotate?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <rect x={-13} y={-24} width={26} height={48} rx={5} fill="var(--bg-sunken)" stroke="currentColor" strokeWidth={1.6} />
      <rect x={-10} y={-19} width={20} height={34} rx={2} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.5} />
      <circle cy={-21} r={1.6} fill="var(--accent)" />
      <line x1={-4} y1={19} x2={4} y2={19} stroke="currentColor" strokeWidth={1.4} opacity={0.6} />
    </g>
  );
}

function Laptop({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-26} y={-20} width={52} height={34} rx={3} fill="var(--bg-sunken)" stroke="currentColor" strokeWidth={1.6} />
      <rect x={-21} y={-15} width={42} height={24} rx={1.5} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.45} />
      <path d="M-34 14 H34 l4 5 H-38 z" fill="var(--bg-sunken)" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
      {/* A score on the screen: this is the device doing the thinking. */}
      <text x={0} y={2} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--accent)">
        501
      </text>
    </g>
  );
}

/** The camera's field of view, drawn as a soft cone. */
function Sightline({ from, to }: { from: [number, number]; to: [number, number] }) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = 0.28;
  const length = Math.hypot(x2 - x1, y2 - y1);

  const edge = (offset: number) => [
    x1 + Math.cos(angle + offset) * length,
    y1 + Math.sin(angle + offset) * length,
  ];
  const [ax, ay] = edge(spread);
  const [bx, by] = edge(-spread);

  return (
    <path
      d={`M${x1} ${y1} L${ax} ${ay} L${bx} ${by} z`}
      fill="var(--accent)"
      opacity={0.12}
      stroke="var(--accent)"
      strokeWidth={0.8}
      strokeDasharray="3 3"
    />
  );
}

export function SoloModeArt() {
  return (
    <svg className="mode-art" viewBox="0 0 200 110" role="img" aria-label="One phone, watching the board and keeping score">
      <Board x={48} y={55} />
      <Sightline from={[136, 55]} to={[76, 55]} />
      <Phone x={148} y={55} rotate={-8} />
      <text x={148} y={104} textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.65}>
        camera + score
      </text>
    </svg>
  );
}

export function PairedModeArt() {
  return (
    <svg
      className="mode-art"
      viewBox="0 0 200 110"
      role="img"
      aria-label="A phone as the camera, sending video to a laptop that keeps score"
    >
      <Board x={26} y={52} scale={0.72} />
      <Sightline from={[72, 52]} to={[42, 52]} />
      <Phone x={82} y={52} rotate={-8} />

      {/* Waves: the phone is sending, the laptop is receiving. */}
      <g className="mode-waves" stroke="var(--accent)" fill="none" strokeLinecap="round" strokeWidth={1.8}>
        <path d="M100 52 a10 10 0 0 1 0 -14 a10 10 0 0 1 0 -14" opacity={0} transform="translate(0 14)" />
        <path className="wave wave-1" d="M100 44 a9 9 0 0 1 0 16" />
        <path className="wave wave-2" d="M107 39 a15 15 0 0 1 0 26" />
        <path className="wave wave-3" d="M114 34 a21 21 0 0 1 0 36" />
      </g>

      <Laptop x={158} y={50} />
      <text x={82} y={94} textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.65}>
        camera
      </text>
      <text x={158} y={94} textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.65}>
        score + vision
      </text>
    </svg>
  );
}
