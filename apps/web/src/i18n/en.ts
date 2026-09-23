import type { Hit } from '@oche/core';

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
    /** A single dart, the way a caller names one. */
    hit: (h: Hit): string => {
      switch (h.ring) {
        case 'miss':
          return 'No score';
        case 'bull':
          return 'Bullseye';
        case 'outerBull':
          return 'Twenty-five';
        case 'treble':
          return `Treble ${numberToWords(h.sector)}`;
        case 'double':
          return `Double ${numberToWords(h.sector)}`;
        default:
          return numberToWords(h.sector);
      }
    },
  },
  landing: {
    lede: 'Darts, scored properly. Tap the board or let the camera read it, hear the score called out, and get the statistics that only come from knowing where every dart landed.',
    cta: 'Play darts',
    resume: 'Carry on with your match',
    statusTitle: 'Where this is up to',
    status:
      'Scoring, the caller, checkouts and statistics all work today. The camera autoscorer does not score for you yet: the app photographs your throws and you mark where the darts landed, which is how its training set is being built. Nothing is uploaded.',
    points: [
      {
        title: 'Score without arithmetic',
        body: 'X01 from 301 to 1001, straight/double/treble/master in and out, legs and sets, up to eight players. Every dart can be undone.',
      },
      {
        title: 'Never look at the screen',
        body: 'The score is called out loud, and the checkout is on the board in front of you.',
      },
      {
        title: 'Statistics worth having',
        body: 'Averages, first nine, checkout percentage and darts per leg — plus heatmaps and grouping, because every dart records where it landed.',
      },
      {
        title: 'Your board, your device',
        body: 'It runs in the browser, works offline, and keeps everything on your phone or laptop.',
      },
    ],
    foot: 'Free and open source.',
    source: 'Source on GitHub',
  },
  mode: {
    title: 'How are you playing?',
    subtitle: 'You can change your mind later — this only decides which device does the work.',
    back: 'Back',
    joinAsCamera: 'This phone is the camera',
    solo: {
      title: 'One phone',
      body: 'The phone does everything: it watches the board, keeps the score and calls it out.',
      points: ['Nothing to pair', 'Works anywhere', 'The phone warms up over a long session'],
      action: 'Use one device',
    },
    paired: {
      title: 'Phone + computer',
      body: 'The phone is only a camera. It sends what it sees to the computer, which does the thinking and shows the scoreboard.',
      points: [
        'The phone stays cool: no thinking, dimmed screen',
        'A big scoreboard you can read from the oche',
        'Video goes straight between the two — never over the internet',
      ],
      action: 'Pair two devices',
    },
  },
  pair: {
    title: 'Pair your phone',
    subtitle: 'Two codes, no accounts, no internet: the phone and this computer introduce themselves by showing each other a picture.',
    steps: [
      'On your phone, open this same site and choose "This phone is the camera".',
      'This computer shows a code; point the phone at it.',
      'The phone then shows a code back; hold it up to this computer’s webcam.',
    ],
    start: 'Show the pairing code',
    showToPhone: 'Point the phone at this code',
    scannedIt: 'Done — now read the phone’s code',
    holdUpPhone: 'Hold the phone’s screen up to this webcam',
    scanningHint: 'Looking for the phone’s code…',
    scanning: 'Looking for a code…',
    startingCamera: 'Starting the camera…',
    connecting: 'Connecting…',
    connected: 'Paired. The phone is sending video to this computer.',
    setUpCamera: 'Set up the board view',
    straightToGame: 'Straight to a match',
    failed: 'That did not connect. Both devices need to be on the same Wi-Fi.',
    retry: 'Try again',
    back: 'Back',
    backToCode: 'Show the code again',
    qrLabelHub: 'Pairing code for the phone to scan',
  },
  camera: {
    title: 'Camera mode',
    subtitle: 'Point this phone at your computer’s pairing code.',
    liveSubtitle: 'Leave the phone where it is. The computer is doing the rest.',
    scanHint: 'Point at the code on your computer',
    showToLaptop: 'Now hold this up to your computer’s webcam',
    qrLabel: 'Pairing answer for the computer to scan',
    waiting: 'Waiting for the computer to read it…',
    connected: 'Connected — sending video',
    battery: 'Battery',
    keepHere: 'Keep this screen open. The phone is not scoring or calling: it is only the camera.',
    stop: 'Stop being the camera',
    back: 'Back',
    failed: 'Could not connect to the computer.',
    retry: 'Scan again',
  },
  coach: {
    ready: 'Board found — you can play.',
    notCalibrated: 'Tap "Find the board" and drag the four markers onto it.',
    moved: 'The camera has moved. Find the board again.',
    offFrame: 'The board is cut off — turn the camera',
    offCentre: 'Board is off to one side — point a little',
    tooSmall: 'The board looks small. Move the camera closer, about a metre away.',
    tooClose: 'Too close — leave some room around the board for a dart that misses.',
    tooFlat: 'Almost straight on. Move the camera to one side or below, so a dart sticking out is visible.',
    tooSteep: 'Very steep angle — the far side of the board is squashed. Come round towards the front.',
    dark: 'Too dark. Put a lamp on the board.',
    washedOut: 'Very bright — the board is washing out.',
    glare: 'A reflection on the board. Move the light or the camera a little.',
    blurry: 'Blurry. Steady the camera and wipe the lens.',
    directions: {
      left: 'left.',
      right: 'right.',
      up: 'up.',
      down: 'down.',
    },
    fill: 'fill',
    angle: 'angle',
    light: 'light',
    detail: 'detail',
  },
  capture: {
    title: 'Camera setup',
    subtitle: 'Set the camera up once here. After that it works during a normal game.',
    trySubtitle: 'Throw a dart. I photograph the board, you tap the dart, and I call the score back — and that throw becomes a training sample.',
    tryIt: 'Try it — throw some darts',
    tryHelp:
      'If the score I call back is wrong, the camera is not where the app thinks it is: go back and find the board again. Every dart you mark is saved as a labelled photograph, which is what the autoscorer will be trained on.',
    throwOne: 'Throw a dart — I am watching the board',
    tapTheDart: 'Got it. Tap the dart in the picture',
    tapAnother: 'Saved. Tap another if two went in',
    markedCount: '{n} marked this session',
    undo: 'Undo that one',
    doneTrying: 'Done',
    steps: [
      'Stand the phone about a metre from the board, a little off to one side — not straight on, so the darts stick out towards the camera.',
      'Start the camera, tap "Find the board" and drag the four markers onto the outer edge of the double ring. The green board is drawn from your markers: nudge until it sits on the real wires.',
      'Tap "Try it" and throw a few darts. Tap each one in the photograph and the app calls the score back: if it is right, the camera is set up properly — and each dart you mark is one labelled training sample.',
    ],
    stepsTitle: 'Three steps, once',
    start: 'Start camera',
    phoneCamera: 'Phone camera',
    stop: 'Stop camera',
    calibrate: 'Find the board',
    recalibrate: 'Find the board again',
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
    captureNow: 'Photograph now',
    practice: 'Practice capture',
    practiceHelp: 'Throwing without a game? Photograph and label here. During a game this happens for you.',
    waiting: 'Watching the board',
    moving: 'Movement',
    captured: 'Captured',
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
    readout: 'motion/change',
    autoNote:
      'Automatic capture is triggered by the board changing while nothing is moving. The two numbers in the corner are what it measures — motion, then the strongest change since the last photograph. The thresholds have not been set against a real board yet, so if nothing fires, use Capture now and tell me what those numbers read.',
    backlog: 'Paused: there are frames waiting to be labelled. Label or clear them to carry on capturing.',
    back: 'Back',
  },
  report: {
    button: 'Report',
    markVisit: 'Mark where they landed',
    preview: 'Preview',
    title: 'Where did it actually land?',
    help: 'Drag each marker onto the real tip. The score follows the marker, and the frame is kept for training.',
    noFrame: 'No camera frame for this visit — turn the camera on to report a miss-read.',
    save: 'Save report',
    saved: 'Saved for training — the score was already right.',
    cancel: 'Cancel',
    camera: 'Camera',
    cameraOn: 'Camera on',
    cameraOff: 'Camera off',
    scoreChanged: 'Score corrected to {score}',
  },
  stats: {
    title: 'Statistics',
    subtitle: '{matches} matches, {darts} darts.',
    empty: 'Play a leg and this fills up. Every dart you enter is counted, and every one you place on the board is measured.',
    nothingInRange: 'Nothing thrown in this period.',
    back: 'Back',
    ranges: {
      session: 'Today',
      month: 'Last 30 days',
      all: 'All time',
    },

    scoring: 'Scoring',
    average: '3-dart average',
    averageNote:
      'Points scored ÷ darts thrown × 3, over whole legs. Darts in a busted visit count, and the bust scores nothing — the standard definition, and why a bust hurts twice.',
    first9: 'First 9',
    first9Note: 'The same average over the first three visits of each leg: scoring power, separated from finishing.',
    checkout: 'Checkout',
    checkoutNote:
      'Doubles hit ÷ darts thrown at a double, where a dart counts as at a double when one dart could have closed the leg from the score in front of it.',
    dartsPerLeg: 'Darts per leg',
    dartsPerLegNote: 'Counted over legs won, because a leg you lost has no length.',
    fromDarts: 'from {n} darts',
    fromLegs: 'over {n} legs',
    ofAttempts: '{hits} of {n}',
    legsWon: '{n} legs won',
    bestLeg: 'Best leg',
    highestOut: 'Highest out',
    tons: '100+',
    bestVisit: 'Best visit',
    busts: 'Busts',

    form: 'Form',
    careerAverage: 'average',
    formNote: 'One point per session, oldest first. {n} sessions so far.',

    shape: 'Shape of your scoring',

    doubles: 'Doubles',
    noDoubles: 'No darts at a double yet.',
    doublesSummary: 'Best: {best} at {bestPercent}%. Weakest: {worst} at {worstPercent}%.',
    doublesNote:
      'Which double a dart was aimed at is taken from the score in front of you — 32 means D16. Only doubles with at least five darts are called best or weakest.',
    bull: 'Bull',

    where: 'Where your darts land',
    whereLabel: 'Heatmap of where the darts landed',
    fewer: 'fewer',
    more: 'more',
    groupSentence:
      'Your group measures about {along} mm up and down the sector and {across} mm across it, over {n} darts.',
    goingAt: 'When you go at the {sector}',
    offBoard: 'Off the board',
    tappedNote:
      '{n} of these positions were tapped on the board rather than read by a camera, so they are as precise as your thumb was.',

    aim: 'Where you should aim',
    aimLabel: 'Expected score for every aiming point',
    perDart: '{max} per dart',
    aimSentenceSame:
      'With a spread like yours the treble 20 is still the right place to aim: {expected} points a dart, which is {average} for three.',
    aimSentenceOther:
      'With a spread like yours, aim at {target} instead: {expected} points a dart against {treble} at the treble 20 — {gain} more every dart, or {perThree} a visit.',
    aimNote:
      'From Tibshirani, Price & Taylor, “A statistician plays darts” (2011): a throw is a Gaussian around where you aimed, so the expected score of aiming anywhere is the board convolved with your own spread. The spread is estimated from the darts you threw at your most-used number, assuming that is what you were going at.',
    aimPending: 'Needs {need} darts with a position; there are {have}. Keep tapping the board where they land.',
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
