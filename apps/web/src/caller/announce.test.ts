import { parseHit, reduceMatch, dartEvent, type MatchEvent, type X01Config } from '@oche/core';
import { describe, expect, it } from 'vitest';

import { announce } from './announce.js';

const config: X01Config = {
  startScore: 501,
  inRule: 'straight',
  outRule: 'double',
  legsPerSet: 1,
  setsToWin: 1,
  players: [
    { id: 'ann', name: 'Ann' },
    { id: 'bob', name: 'Bob' },
  ],
};

function darts(...notation: string[]): MatchEvent[] {
  return notation.map((text, index) =>
    dartEvent(parseHit(text)!, { id: `d${index}`, ts: 1_700_000_000_000 + index }),
  );
}

/** Announces the transition caused by the last dart of `notation`. */
function say(notation: string[], cfg: X01Config = config): string[] {
  const events = darts(...notation);
  const before = reduceMatch(cfg, events.slice(0, -1));
  const after = reduceMatch(cfg, events);
  return announce(before, after);
}

describe('announce', () => {
  it('says nothing in the middle of a visit', () => {
    expect(say(['T20'])).toEqual([]);
    expect(say(['T20', 'T20'])).toEqual([]);
  });

  // 501 − 180 = 321: too far out to be worth saying, so it hands over instead.
  it('calls the visit total in caller words, then the next player', () => {
    expect(say(['T20', 'T20', 'T20'])).toEqual(['one hundred and eighty', 'Bob to throw']);
    expect(say(['S5', 'S1', 'MISS'])).toEqual(['six', 'Bob to throw']);
    expect(say(['MISS', 'MISS', 'MISS'])).toEqual(['No score', 'Bob to throw']);
  });

  it('tells the player who threw what they are left on, not the opponent', () => {
    const cfg = { ...config, startScore: 170 };
    expect(say(['T20', 'T20', 'S10'], cfg)).toEqual(['one hundred and thirty', 'Ann requires forty']);
  });

  it('calls game shot on a leg, and game set and match on the last one', () => {
    const cfg = { ...config, startScore: 40, legsPerSet: 2 };
    expect(say(['D20'], cfg)).toEqual(['Game shot!']);

    const matchCfg = { ...config, startScore: 40 };
    expect(say(['D20'], matchCfg)).toEqual(['Game, set and match!']);
  });

  it('calls no score for a bust and repeats what the thrower still needs', () => {
    const cfg = { ...config, startScore: 20 };
    expect(say(['S19'], cfg)).toEqual(['No score', 'Ann requires twenty']);
  });
});
