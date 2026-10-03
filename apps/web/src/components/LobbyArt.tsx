/**
 * The pictures behind the lobby's menu, one per entry.
 *
 * Drawn in the app's own hand — lines in the text colour, the board's red and
 * green where something points at the board or flows from it — so they sit
 * with the mode chooser's drawings rather than looking bought in. They are
 * decoration: the menu's words carry the meaning, and every picture is hidden
 * from screen readers by the lobby.
 *
 * Movement is small and slow (a board turning, bars settling, waves), and all
 * of it stops under prefers-reduced-motion (see the lobby's styles).
 */

import { Dartboard } from './Dartboard.js';
import { PairedModeArt, SoloModeArt } from './ModeArt.js';

export type LobbyArtKind = 'resume' | 'newGame' | 'pairAgain' | 'camera' | 'review' | 'history' | 'stats' | 'leave';

const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** A scoreboard mid-leg: the player to throw on a finish, the route in green. */
function Resume() {
  return (
    <svg className="lobby-art-svg" viewBox="0 0 400 300">
      <rect x={40} y={40} width={150} height={150} rx={14} {...LINE} stroke="var(--accent)" />
      <rect x={210} y={40} width={150} height={150} rx={14} {...LINE} opacity={0.45} />
      <text x={115} y={140} textAnchor="middle" fontSize={72} fontWeight={700} fill="currentColor">
        40
      </text>
      <text x={285} y={140} textAnchor="middle" fontSize={72} fontWeight={700} fill="currentColor" opacity={0.45}>
        87
      </text>
      <text x={115} y={174} textAnchor="middle" fontSize={20} fontWeight={650} fill="var(--checkout)">
        D20
      </text>
      <g className="lobby-art-pulse">
        <rect x={40} y={222} width={56} height={40} rx={8} {...LINE} />
        <rect x={110} y={222} width={56} height={40} rx={8} {...LINE} opacity={0.4} />
        <rect x={180} y={222} width={56} height={40} rx={8} {...LINE} opacity={0.4} />
      </g>
      <text x={68} y={249} textAnchor="middle" fontSize={18} fontWeight={650} fill="currentColor">
        T20
      </text>
    </svg>
  );
}

/** A photograph of the board from the side, with its darts marked. */
function Review() {
  return (
    <svg className="lobby-art-svg" viewBox="0 0 400 300">
      <rect x={30} y={30} width={340} height={240} rx={14} {...LINE} opacity={0.6} />
      <ellipse cx={200} cy={150} rx={120} ry={80} {...LINE} opacity={0.5} />
      <ellipse cx={200} cy={150} rx={78} ry={52} {...LINE} opacity={0.35} />
      <ellipse cx={200} cy={150} rx={14} ry={9} fill="var(--board-red)" opacity={0.8} />
      {/* Darts, flights towards the camera; the marks sit on the tips. */}
      <g stroke="currentColor" strokeWidth={3} strokeLinecap="round" opacity={0.7}>
        <line x1={170} y1={112} x2={118} y2={70} />
        <line x1={238} y1={160} x2={300} y2={118} />
      </g>
      <path d="M118 70 l-16 -4 l8 -10 z M300 118 l16 -2 l-8 -12 z" fill="var(--red-400)" />
      <g className="lobby-art-pulse" fill="none" strokeWidth={3}>
        <circle cx={170} cy={112} r={11} stroke="var(--accent)" />
        <circle cx={238} cy={160} r={11} stroke="var(--green-300)" strokeDasharray="5 4" />
      </g>
    </svg>
  );
}

/** Past matches, one under the other. */
function History() {
  const rows = [0, 1, 2, 3];
  return (
    <svg className="lobby-art-svg" viewBox="0 0 400 300">
      {rows.map((row) => (
        <g key={row} transform={`translate(40 ${36 + row * 60})`} opacity={1 - row * 0.2}>
          <rect width={320} height={46} rx={10} {...LINE} />
          <line x1={20} y1={18} x2={150} y2={18} {...LINE} strokeWidth={4} />
          <line x1={20} y1={32} x2={100} y2={32} {...LINE} strokeWidth={2} opacity={0.5} />
          <circle cx={292} cy={23} r={9} fill={row === 0 ? 'var(--green-400)' : 'none'} stroke="currentColor" strokeWidth={2} />
        </g>
      ))}
    </svg>
  );
}

/** Where the darts land, and how the scores fall. */
function Stats() {
  const bars = [46, 80, 128, 104, 62, 30];
  return (
    <svg className="lobby-art-svg" viewBox="0 0 400 300">
      <line x1={30} y1={250} x2={220} y2={250} {...LINE} opacity={0.5} />
      {bars.map((h, i) => (
        <rect
          key={i}
          className="lobby-art-bar"
          style={{ animationDelay: `${i * 80}ms` }}
          x={40 + i * 30}
          y={250 - h}
          width={20}
          height={h}
          rx={4}
          fill={i === 2 ? 'var(--green-400)' : 'currentColor'}
          opacity={i === 2 ? 1 : 0.4}
        />
      ))}
      <g transform="translate(305 150)">
        <circle r={72} {...LINE} opacity={0.5} />
        <circle r={46} {...LINE} opacity={0.35} />
        <circle r={10} {...LINE} opacity={0.35} />
        {[
          [-6, -52, 9],
          [4, -58, 7],
          [-14, -44, 6],
          [24, 20, 5],
          [-40, 30, 4],
        ].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill={i < 3 ? 'var(--red-400)' : 'var(--green-300)'} opacity={0.85} />
        ))}
      </g>
    </svg>
  );
}

/** A door, open, and the way out. */
function Leave() {
  return (
    <svg className="lobby-art-svg" viewBox="0 0 400 300">
      <path d="M150 40 h120 v220 h-120" {...LINE} opacity={0.5} />
      <path d="M150 40 l70 24 v176 l-70 20 z" {...LINE} />
      <circle cx={205} cy={152} r={4} fill="currentColor" />
      <g className="lobby-art-drift" {...LINE} stroke="var(--red-400)" strokeWidth={4}>
        <line x1={250} y1={150} x2={340} y2={150} />
        <path d="M318 128 l24 22 l-24 22" />
      </g>
    </svg>
  );
}

export function LobbyArt({ kind }: { kind: LobbyArtKind }) {
  switch (kind) {
    case 'resume':
      return <Resume />;
    case 'newGame':
      return (
        <div className="lobby-art-board">
          <Dartboard decorative />
        </div>
      );
    case 'pairAgain':
      return <PairedModeArt />;
    case 'camera':
      return <SoloModeArt />;
    case 'review':
      return <Review />;
    case 'history':
      return <History />;
    case 'stats':
      return <Stats />;
    case 'leave':
      return <Leave />;
  }
}
