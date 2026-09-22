# 05 — Dual device: phone as camera, laptop as brain

## Why

In solo mode the phone decodes its own camera, runs the model and drives the UI.
That works — inference only fires on settle events — but a 90-minute session
still warms the phone and drains it. With a laptop in the room there is a better
split: the phone does what phones are good at (a camera with a hardware video
encoder) and nothing else.

## The split

| | Phone (camera role) | Laptop/desktop (hub role) |
|---|---|---|
| Camera | `getUserMedia`, back camera, 1080p if available | — |
| Encode | hardware H.264/VP8 via WebRTC | — |
| Inference | none | board pose + tip detection |
| Game state | none | the event log, stats, everything |
| Screen | dimmed, minimal, wake-lock on | the scoreboard |
| Caller audio | optional (phone may be closer to the player) | default |

## Transport: WebRTC for media, WebSocket for signalling only

Sending frames over a WebSocket — JPEG or raw — is the obvious-looking design and
the wrong one: it forces software encoding on the phone, which is precisely the
thing that heats it up. `RTCPeerConnection` uses the phone's hardware encoder and
adapts to the network for free.

- Video track: `degradationPreference: 'maintain-resolution'`, high
  `maxBitrate`, so the stream loses frame rate rather than detail under
  congestion. Detail is what the model needs; 30 fps is not.
- A `RTCDataChannel` alongside it carries control: torch on/off, resolution
  change, "send me a full-resolution still", battery/thermal reports, and
  round-trip latency probes.
- **Precision stills**: for a low-confidence read, the hub asks over the data
  channel for one full-resolution JPEG of the current frame. Video compression
  artefacts around a thin dart barrel are one of the plausible accuracy losses of
  the paired mode, and this removes it for the frames that matter.

## Pairing

1. Hub opens a session and gets a short room code; it shows a QR of
   `https://<origin>/cam#<room>-<key>`.
2. Phone scans it with its normal camera app, opens the URL — the same web app,
   same origin — and lands directly in camera role.
3. Both connect to a signalling relay over WSS, exchange SDP offer/answer and ICE
   candidates, then talk peer-to-peer. On a shared home network this is a direct
   LAN connection; a public STUN server covers the rest.
4. The relay is used only during the handshake. If it disappears afterwards, the
   game continues.

Both devices must load the **same HTTPS origin**: browsers refuse camera access
outside a secure context, so "just type the laptop's LAN IP" is not an option.
This is why the app is deployed to a public HTTPS origin even though it needs no
server for play.

### The signalling relay

A ~100-line Cloudflare Worker with a Durable Object per room: it accepts two
WebSocket clients, relays messages between them and forgets the room when both
leave. No accounts, no storage, free tier, and `services/pair/` in this
repository. The client talks to it through a `SignallingChannel` interface, so a
self-hosted Node relay or a public broker can be substituted; anyone
self-hosting the app can point at their own.

TURN is deliberately not provided. Same-network pairing does not need it, and
relaying video through a third party is not something this project will do
quietly. If a direct connection cannot be established, the app says so and
offers solo mode.

## Failure behaviour

| Failure | Behaviour |
|---|---|
| Phone loses Wi-Fi | Hub keeps the game, shows "camera offline", manual entry keeps working, phone reconnects to the same room automatically |
| Hub tab closed | Game state is already persisted per event; reopening resumes the match |
| Peer connection fails | Explicit message with the reason, plus a one-tap switch to solo mode on the phone |
| Phone gets a call / backgrounds | Video track pauses; the hub shows it, and the score cannot be silently missed |

## Extension this design already allows

The hub accepts N camera sources, not one. A second phone at a different angle is
the standard fix for the remaining occlusion cases (two views, two homographies,
agree on the tip in board coordinates). Out of scope for v1, but nothing in the
protocol assumes a single camera.
