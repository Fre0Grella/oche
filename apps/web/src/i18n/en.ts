/**
 * English strings, including the caller's vocabulary.
 *
 * Phrases are data, not concatenated code: "one hundred and eighty" and
 * "centottanta" are not the same shape, so a locale owns its whole sentence.
 */

const UNITS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

/** 0–180 in the words a caller uses: "one hundred and eighty", not "180". */
export function numberToWords(value: number): string {
  if (value < 0) return String(value);
  if (value < 20) return UNITS[value]!;
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)]!;
    const unit = value % 10;
    return unit === 0 ? tens : `${tens}-${UNITS[unit]!}`;
  }
  const hundreds = `${UNITS[Math.floor(value / 100)]!} hundred`;
  const rest = value % 100;
  return rest === 0 ? hundreds : `${hundreds} and ${numberToWords(rest)}`;
}

export const en = {
  locale: 'en',
  app: {
    name: 'oche',
    tagline: 'Darts scoring, calling and statistics.',
  },
  setup: {
    title: 'New match',
    players: 'Players',
    addPlayer: 'Add player',
    removePlayer: 'Remove',
    playerName: 'Name',
    startScore: 'Start score',
    inRule: 'Opening rule',
    outRule: 'Closing rule',
    legsPerSet: 'Legs per set',
    setsToWin: 'Sets to win',
    start: 'Start match',
    rules: {
      straight: 'Straight — anything counts',
      double: 'Double',
      treble: 'Treble (triple)',
      master: 'Master — double or treble',
    },
    history: 'Past matches',
  },
  game: {
    darts: 'Darts',
    visit: 'This visit',
    average: 'Avg',
    first9: 'First 9',
    checkout: 'Checkout',
    checkoutPercent: 'Checkout %',
    legs: 'Legs',
    sets: 'Sets',
    undo: 'Undo',
    miss: 'Miss',
    bull: 'Bull',
    outerBull: '25',
    single: 'Single',
    double: 'Double',
    treble: 'Treble',
    board: 'Board',
    keypad: 'Keypad',
    caller: 'Caller',
    callerOn: 'Caller on',
    callerOff: 'Caller off',
    toThrow: 'to throw',
    busted: 'No score',
    youRequire: 'requires',
    legWon: 'Leg to {name}',
    setWon: 'Set to {name}',
    matchWon: '{name} wins the match',
    newMatch: 'New match',
    sourceNote: 'Tap the board where the dart landed — the position is what makes the statistics work.',
    chartNote: 'One conventional route of several valid ones.',
  },
  caller: {
    noScore: 'No score',
    bust: 'No score',
    requires: (name: string, remaining: number) =>
      `${name} requires ${numberToWords(remaining)}`,
    visit: (total: number) => (total === 0 ? 'No score' : numberToWords(total)),
    gameShot: 'Game shot!',
    setShot: 'Game and the set!',
    matchShot: 'Game, set and match!',
    toThrow: (name: string) => `${name} to throw`,
    correction: (total: number) => `Correction, ${numberToWords(total)}`,
  },
  capture: {
    title: 'Capture lab',
    subtitle: 'Photograph your board and mark where the darts landed. This is the training set.',
    start: 'Start camera',
    stop: 'Stop camera',
    calibrate: 'Calibrate',
    recalibrate: 'Recalibrate',
    calibrateTitle: 'Where is the board?',
    calibrateHelp:
      'Drag each marker onto the outer edge of the double ring, on the centre line of that number. The green board is drawn from your four points — nudge until it sits on the real wires.',
    calibrateSave: 'Use this calibration',
    calibrateCancel: 'Cancel',
    calibrateError: 'Fit',
    calibrateStale:
      'This calibration was made at {old}, the camera is running at {now}. Recalibrate before capturing.',
    landmarkTop: '20',
    landmarkRight: '6',
    landmarkBottom: '3',
    landmarkLeft: '11',
    landmarkHintTop: 'Outer edge of the double, centre of the 20',
    landmarkHintRight: 'Outer edge of the double, centre of the 6',
    landmarkHintBottom: 'Outer edge of the double, centre of the 3',
    landmarkHintLeft: 'Outer edge of the double, centre of the 11',
    autoCapture: 'Capture on settle',
    captureNow: 'Capture now',
    waiting: 'Watching the board',
    moving: 'Movement',
    captured: 'Captured',
    label: 'Mark the darts',
    labelHelp: 'Tap each dart tip. Drag to adjust. The score is read from where you put it.',
    labelSave: 'Save labels',
    labelSkip: 'Skip',
    labelDelete: 'Delete frame',
    labelEmpty: 'No darts in this frame',
    queue: '{n} to label',
    noCalibration: 'Calibrate first, so a tap on the photo means something.',
    noCamera: 'This browser will not give the page a camera. On iOS that means Safari, and the page must be served over HTTPS.',
    frames: 'Frames',
    labelled: 'labelled',
    export: 'Export zip',
    exportEmpty: 'Nothing to export yet',
    deleteAll: 'Delete all frames',
    deleteAllConfirm: 'Tap again to delete everything',
    storage: '{mb} MB on this device',
    privacy: 'Frames stay on this device. Nothing is uploaded.',
    backlog: 'Paused: there are frames waiting to be labelled. Label or clear them to carry on capturing.',
    back: 'Back',
  },
  report: {
    button: 'Report',
    title: 'Where did it actually land?',
    help: 'Drag each marker onto the real tip. The score follows the marker, and the frame is kept for training.',
    noFrame: 'No camera frame for this visit — turn the camera on to report a miss-read.',
    save: 'Save report',
    cancel: 'Cancel',
    camera: 'Camera',
    cameraOn: 'Camera on',
    cameraOff: 'Camera off',
    scoreChanged: 'Score corrected to {score}',
  },
  history: {
    title: 'Past matches',
    empty: 'No matches yet.',
    resume: 'Resume',
    back: 'Back',
    delete: 'Delete',
    finished: 'finished',
    inProgress: 'in progress',
  },
} as const;

export type Strings = typeof en;
