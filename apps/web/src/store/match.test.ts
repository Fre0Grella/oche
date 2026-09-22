import { hit, parseHit } from '@oche/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { useMatchStore } from './match.js';

const config = {
  startScore: 501,
  inRule: 'straight' as const,
  outRule: 'double' as const,
  legsPerSet: 1,
  setsToWin: 1,
  players: [
    { id: 'ann', name: 'Ann' },
    { id: 'bob', name: 'Bob' },
  ],
};

describe('the match store', () => {
  beforeEach(() => {
    useMatchStore.setState({ match: null, snapshot: null, screen: 'setup' });
  });

  it('records darts, folds the match and moves to the game screen', () => {
    const store = useMatchStore.getState();
    store.startMatch(config);
    expect(useMatchStore.getState().screen).toBe('game');

    useMatchStore.getState().throwDart(hit(20, 'treble'), { pos: { x: 0, y: 103 } });
    useMatchStore.getState().throwDart(hit(20, 'treble'));
    useMatchStore.getState().throwDart(hit(1, 'single'));

    const snapshot = useMatchStore.getState().snapshot!;
    expect(snapshot.legs[0]!.remaining.ann).toBe(380);
    expect(snapshot.current!.playerId).toBe('bob');
    expect(useMatchStore.getState().match!.events).toHaveLength(3);

    // The position of the first dart survived into the log.
    const first = snapshot.legs[0]!.visits[0]!.darts[0]!;
    expect(first.pos).toEqual({ x: 0, y: 103 });
    expect(first.source).toBe('manual');
  });

  it('undoes the last dart', () => {
    const store = useMatchStore.getState();
    store.startMatch(config);
    useMatchStore.getState().throwDart(hit(20, 'treble'));
    useMatchStore.getState().undo();

    expect(useMatchStore.getState().match!.events).toHaveLength(0);
    expect(useMatchStore.getState().snapshot!.legs[0]!.remaining.ann).toBe(501);
  });

  it('corrects a dart without losing what was first recorded', () => {
    useMatchStore.getState().startMatch(config);
    useMatchStore.getState().throwDart(hit(20, 'treble'), { source: 'auto', confidence: 0.4 });

    const dartId = useMatchStore.getState().snapshot!.legs[0]!.visits[0]!.darts[0]!.id;
    useMatchStore.getState().correctDart(dartId, parseHit('S20')!);

    const dart = useMatchStore.getState().snapshot!.legs[0]!.visits[0]!.darts[0]!;
    expect(dart.hit.value).toBe(20);
    expect(dart.original?.hit.value).toBe(60);
    expect(dart.original?.source).toBe('auto');
    expect(useMatchStore.getState().snapshot!.legs[0]!.remaining.ann).toBe(481);
  });

  it('ignores darts once the match is won', () => {
    useMatchStore.getState().startMatch({ ...config, startScore: 40, players: [config.players[0]!] });
    useMatchStore.getState().throwDart(hit(20, 'double'));
    expect(useMatchStore.getState().snapshot!.winnerId).toBe('ann');

    useMatchStore.getState().throwDart(hit(20, 'treble'));
    expect(useMatchStore.getState().match!.events).toHaveLength(1);
  });
});
