/**
 * The game store: an event log in, a folded snapshot out.
 *
 * The store never computes a rule. It appends events, asks `@oche/core` what
 * the match looks like now, persists, and tells the caller what to say. That
 * split is why the rules have tests and the UI does not need them.
 */

import {
  reduceMatch,
  type DartCorrectedEvent,
  type DartSource,
  type Hit,
  type MatchEvent,
  type MatchSnapshot,
  type Point,
  type X01Config,
} from '@oche/core';
import { create } from 'zustand';

import { announce } from '../caller/announce.js';
import { caller } from '../caller/caller.js';
import {
  DEFAULT_SETTINGS,
  deleteMatch as deleteStoredMatch,
  deleteProfile as deleteStoredProfile,
  listMatches,
  listProfiles,
  loadSettings,
  putMatch,
  putProfile,
  saveSetting,
  type Profile,
  type Settings,
  type StoredMatch,
} from '../storage/db.js';

import type { PairingConnection } from '../pairing/session.js';
import { hashForScreen, type Screen } from '../route.js';

export type { Screen };

/** Solo: the phone does everything. Paired: a phone films, a laptop thinks. */
export type PlayMode = 'solo' | 'paired';

export interface ThrowOptions {
  pos?: Point;
  source?: DartSource;
  confidence?: number;
  frameRef?: string;
}

interface MatchState {
  ready: boolean;
  screen: Screen;
  settings: Settings;
  match: StoredMatch | null;
  snapshot: MatchSnapshot | null;
  history: StoredMatch[];

  profiles: Profile[];
  mode: PlayMode;
  /** The paired phone, when there is one. Never persisted: it is a live socket. */
  pairing: PairingConnection | null;
  /** The video coming from the paired phone. */
  remoteStream: MediaStream | null;

  init: (screen?: Screen) => Promise<void>;
  setScreen: (screen: Screen) => void;
  startMatch: (config: X01Config) => void;
  resumeMatch: (id: string) => Promise<void>;
  removeMatch: (id: string) => Promise<void>;
  refreshHistory: () => Promise<void>;

  throwDart: (hit: Hit, options?: ThrowOptions) => void;
  correctDart: (dartId: string, hit: Hit, pos?: Point) => void;
  undo: () => void;

  toggleCaller: () => void;
  setEntryMode: (mode: Settings['entryMode']) => void;
  saveCalibration: (calibration: Settings['calibration']) => void;
  setKeepFrames: (on: boolean) => void;

  createProfile: (name: string) => Promise<Profile>;
  renameProfile: (id: string, name: string) => Promise<void>;
  removeProfile: (id: string) => Promise<void>;
  setMode: (mode: PlayMode) => void;
  setPairing: (pairing: PairingConnection, stream: MediaStream) => void;
  clearPairing: () => void;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export const useMatchStore = create<MatchState>((set, get) => {
  /** Applies a new event list: folds it, persists it, and calls the score. */
  const commit = (events: MatchEvent[], options: { speak?: boolean } = {}) => {
    const state = get();
    if (!state.match) return;

    const previous = state.snapshot;
    const snapshot = reduceMatch(state.match.config, events);
    const match: StoredMatch = {
      ...state.match,
      events,
      updatedAt: Date.now(),
      finished: snapshot.winnerId !== null,
    };

    set({ match, snapshot });
    void putMatch(match);

    if (options.speak !== false && state.settings.callerEnabled) {
      const phrases = announce(previous, snapshot);
      if (phrases.length > 0) caller().sequence(phrases);
    }
  };

  return {
    ready: false,
    screen: 'landing',
    settings: DEFAULT_SETTINGS,
    match: null,
    snapshot: null,
    history: [],
    profiles: [],
    mode: 'solo',
    pairing: null,
    remoteStream: null,

    async init(screen) {
      const [settings, matches, profiles] = await Promise.all([
        loadSettings(),
        listMatches(),
        listProfiles(),
      ]);
      const unfinished = matches.find((m) => !m.finished && m.events.length > 0);

      // A match in progress is resumed, but the landing page still comes first
      // unless the address says otherwise: arriving at oche should explain what
      // it is before it drops you into someone else's half-finished leg.
      const resolved: Screen = screen ?? 'landing';
      set({
        ready: true,
        settings,
        history: matches,
        profiles,
        match: unfinished ?? null,
        snapshot: unfinished ? reduceMatch(unfinished.config, unfinished.events) : null,
        screen: resolved === 'game' && !unfinished ? 'setup' : resolved,
      });
    },

    setScreen(screen) {
      set({ screen });
      if (typeof location !== 'undefined') {
        const hash = hashForScreen(screen);
        if (location.hash !== hash) history.pushState(null, '', hash);
      }
      if (screen === 'history') void get().refreshHistory();
    },

    startMatch(config) {
      // Playing marks a profile as used, which is what orders the picker.
      const now = Date.now();
      const played = get().profiles.map((profile) =>
        config.players.some((player) => player.id === profile.id && !player.temporary)
          ? { ...profile, lastPlayedAt: now }
          : profile,
      );
      set({ profiles: played });
      for (const profile of played) {
        if (profile.lastPlayedAt === now) void putProfile(profile);
      }

      const match: StoredMatch = {
        id: newId(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        config,
        events: [],
        finished: false,
      };
      set({ match, snapshot: reduceMatch(config, []), screen: 'game' });
      void putMatch(match);
    },

    async resumeMatch(id) {
      const match = get().history.find((m) => m.id === id);
      if (!match) return;
      set({ match, snapshot: reduceMatch(match.config, match.events), screen: 'game' });
    },

    async removeMatch(id) {
      await deleteStoredMatch(id);
      const current = get().match;
      if (current?.id === id) set({ match: null, snapshot: null });
      await get().refreshHistory();
    },

    async refreshHistory() {
      set({ history: await listMatches() });
    },

    throwDart(hit, options = {}) {
      const { match, snapshot } = get();
      if (!match || !snapshot || snapshot.current === null) return;

      const event: MatchEvent = {
        type: 'dart.thrown',
        id: newId(),
        ts: Date.now(),
        hit,
        source: options.source ?? 'manual',
        ...(options.pos ? { pos: options.pos } : {}),
        ...(options.confidence !== undefined ? { confidence: options.confidence } : {}),
        ...(options.frameRef ? { frameRef: options.frameRef } : {}),
      };

      commit([...match.events, event]);
    },

    correctDart(dartId, hit, pos) {
      const { match } = get();
      if (!match) return;

      const correction: DartCorrectedEvent = {
        type: 'dart.corrected',
        id: newId(),
        ts: Date.now(),
        target: dartId,
        hit,
        source: 'manual',
        ...(pos ? { pos } : {}),
      };

      commit([...match.events, correction], { speak: false });
    },

    undo() {
      const { match } = get();
      if (!match || match.events.length === 0) return;
      caller().cancel();
      commit(match.events.slice(0, -1), { speak: false });
    },

    toggleCaller() {
      const callerEnabled = !get().settings.callerEnabled;
      set({ settings: { ...get().settings, callerEnabled } });
      void saveSetting('callerEnabled', callerEnabled);
      if (!callerEnabled) caller().cancel();
    },

    setEntryMode(entryMode) {
      set({ settings: { ...get().settings, entryMode } });
      void saveSetting('entryMode', entryMode);
    },

    saveCalibration(calibration) {
      set({ settings: { ...get().settings, calibration } });
      void saveSetting('calibration', calibration);
    },

    setKeepFrames(keepFrames) {
      set({ settings: { ...get().settings, keepFrames } });
      void saveSetting('keepFrames', keepFrames);
    },

    async createProfile(name) {
      // The id comes from the name once, at creation, and never changes again:
      // renaming someone must not orphan their history.
      const trimmed = name.trim() || 'Player';
      const base = trimmed.toLowerCase().replace(/\s+/g, ' ');
      const taken = new Set(get().profiles.map((profile) => profile.id));
      let id = base;
      let suffix = 2;
      while (taken.has(id)) id = `${base} ${suffix++}`;

      const profile: Profile = { id, name: trimmed, createdAt: Date.now(), lastPlayedAt: null };
      await putProfile(profile);
      set({ profiles: [profile, ...get().profiles] });
      return profile;
    },

    async renameProfile(id, name) {
      const trimmed = name.trim();
      if (!trimmed) return;
      const profiles = get().profiles.map((profile) =>
        profile.id === id ? { ...profile, name: trimmed } : profile,
      );
      set({ profiles });
      const changed = profiles.find((profile) => profile.id === id);
      if (changed) await putProfile(changed);
    },

    async removeProfile(id) {
      await deleteStoredProfile(id);
      set({ profiles: get().profiles.filter((profile) => profile.id !== id) });
    },

    setMode(mode) {
      set({ mode });
      if (mode === 'solo') get().clearPairing();
    },

    setPairing(pairing, remoteStream) {
      set({ pairing, remoteStream, mode: 'paired' });
    },

    clearPairing() {
      const { pairing } = get();
      pairing?.close();
      set({ pairing: null, remoteStream: null });
    },
  };
});
