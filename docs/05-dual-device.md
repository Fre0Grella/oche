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
| Encode | hardware H.264 via WebRTC | — |
| Inference | none | board pose + tip detection |
| Game state | none | the event log, stats, everything |
| Screen | dimmed, minimal, wake-lock on | the scoreboard |
| Caller audio | — | yes |

## Pairing: two pictures, no server

The obvious design is a signalling server: both devices connect to it, swap
connection details, then talk directly. It is also the design that puts a third
party in the middle of a feature whose whole point is that the devices are in
the same room — and it stops working on a hotspot with no internet.

So the handshake travels as **QR codes**, in both directions:

1. The laptop makes an offer and draws it as a QR code.
2. The phone reads it with its camera, starts its own camera, and answers.
3. The phone draws its answer as a QR code.
4. The laptop reads it with its webcam.
5. The two connect directly across the local network.

Nothing in that sequence touches the internet, an account or a server, and both
devices need a camera anyway — the phone to film the board, the laptop to read
one code. It works on a home network, on a phone hotspot with no data, and on a
router that blocks everything outbound.

### Making an SDP fit in a picture

A Chrome offer is about 4 kB. Drawn as a QR that is a wall of noise no webcam
can resolve, so `pairing/payload.ts` trims it to what a one-hop local connection
needs, and the result is gzipped and base64url'd. Measured on a machine with
four network interfaces: **1505 → 801 characters** for an offer, 878 for an
answer, which is a version-24 code at the lowest error correction. A device with
a single Wi-Fi interface produces less.

What goes, and why it is safe — both ends run the same code, so every cut is
symmetric:

| Removed | Reason |
|---|---|
| Eight of nine H.264 profiles | `setCodecPreferences` keeps constrained-baseline H.264 (hardware on phones, required by iOS) plus VP8 and RTX. Each dropped profile takes an rtpmap, an fmtp and five feedback lines with it |
| TCP ICE candidates | They exist to get through firewalls; on a local network UDP is what connects |
| Non-host candidates | No STUN or TURN is configured, so there are none — and one appearing is not a route this feature wants |
| All but two addresses | Ranked: home Wi-Fi ranges first, VPN overlays and container bridges last |
| `generation`, `network-id`, `network-cost`, candidate foundations | ICE does not need them to connect two devices across a room, and these lines compress worst |
| Header extensions, `goog-remb`, `ccm fir`, `rtcp-xr` | Negotiable extras and bandwidth estimators for the open internet |
| Session id, stream UUIDs | Renumbered to `i1`, `i2`: they only have to be consistent within one description |

`bundlePolicy: 'max-bundle'` puts the video and the control channel on one
transport, so the addresses are listed once rather than once per section.

The QR round-trip is tested without a camera: the payload is encoded, drawn,
rasterised, and read back with the same decoder the app uses.

## The connection itself

`new RTCPeerConnection({ iceServers: [] })`. No STUN, no TURN, by design: with
no ICE servers a browser gathers only the addresses it holds on the local
network, so the connection either goes directly across the Wi-Fi or it does not
happen at all. The video never leaves the network, and there is no third party
to trust, to pay, or to be down.

Because the handshake is one picture rather than a channel, there is no trickle
ICE: each side waits for gathering to finish (3 s cap) and puts everything in
its code.

Alongside the video track, an `RTCDataChannel` carries control messages: the
phone reports its battery and resolution, and says goodbye when it stops. Scores
never travel over it — the hub owns the game.

## What was measured

End to end in a browser, hub and camera in one page, fake camera device:

```
hub code    801 characters      camera code   878 characters
hub state   connected           camera state  connected
track       received            frames        3 → 33 over 1.5 s
```

## Failure behaviour

| Failure | Behaviour |
|---|---|
| Phone loses Wi-Fi | Hub keeps the game and says the camera is offline; manual entry keeps working |
| Hub tab closed | Game state is persisted per event; reopening resumes the match |
| Handshake fails | The app says so and offers to show the code again — it does not sit on a spinner |
| Phone backgrounded or called | The video track pauses and the hub can see that it has |

## Bluetooth, and why not

Asked for, and worth writing down: a browser cannot act as a Bluetooth
peripheral — no browser implements the peripheral role — iOS Safari has no Web
Bluetooth at all, and BLE carries about 1–2 Mbps in theory and a fraction of
that in practice, against the 20–40 Mbps a useful video stream wants. It fails
on availability, on platform and on bandwidth.

## Extension this design allows

The hub can accept more than one camera. A second phone at a different angle is
the standard fix for the occlusion cases a single view cannot solve. Not in v1,
but nothing in the protocol assumes one camera.
