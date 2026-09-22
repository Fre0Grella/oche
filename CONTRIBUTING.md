# Contributing

## Ground rules

1. **Read [`docs/08-licensing-and-data.md`](docs/08-licensing-and-data.md) before
   importing anything** — code, weights, datasets or images. Several of the
   obvious sources for a darts autoscorer are non-commercial or unlicensed, and a
   single careless copy would make this project unusable.
2. **No model weights in git.** Weights are release artefacts with a model card;
   `.gitignore` blocks `*.pt` and `*.onnx` on purpose.
3. **The game must work without the camera.** Any change that makes manual
   scoring depend on the vision path is a bug, not a feature.
4. **Dart coordinates are not optional.** If you add a way to enter a score, it
   records a position where one exists, because the statistics depend on it.

## Working on it

```bash
npm install
npm test          # packages/core: geometry, X01 rules, checkout routes
npm run typecheck
npm run dev       # the app
```

`packages/core` is pure TypeScript: no DOM, no I/O, no framework. Anything that
can live there, should, because that is the part with tests.

New rules, board maths or statistics come with tests. Vision work comes with
measured numbers — see the evaluation gate in
[`docs/03-autoscorer.md`](docs/03-autoscorer.md); "it looked right on my board"
is not a result.

## Licence of contributions

The project is AGPL-3.0. By opening a pull request you agree that your
contribution may be distributed under that licence and, at the copyright
holder's discretion, under other licence terms as well — this keeps a future
native app or a differently-licensed distribution possible. If you are not
comfortable with that, open an issue instead and we will find another way.
