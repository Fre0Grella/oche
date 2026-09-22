/**
 * The peer connection between the laptop and the phone.
 *
 * Deliberately plain: no STUN, no TURN, no signalling server. Without ICE
 * servers a browser gathers only host candidates — the addresses it has on the
 * local network — so the connection either goes directly across the Wi-Fi (or
 * the hotspot) or it does not happen at all. That is exactly the promise of
 * this mode: the video never leaves your network, and none of it needs the
 * internet.
 *
 * Because the whole handshake travels as a picture, there is no trickle: each
 * side waits for ICE gathering to finish and puts everything in one code.
 */

import { encodePayload, decodePayload, expectRole, type PairingRole } from './payload.js';

export type PairState = 'new' | 'waiting' | 'connecting' | 'connected' | 'failed' | 'closed';

export interface ControlMessage {
  type: 'status' | 'bye';
  battery?: number;
  charging?: boolean;
  width?: number;
  height?: number;
}

/** How long to wait for a browser to finish listing its local addresses. */
const ICE_TIMEOUT_MS = 3000;

/**
 * Offer two codecs, not eleven.
 *
 * Chrome offers nine H.264 profile variants by default, each with its own
 * rtpmap, fmtp and five feedback lines. That is most of the offer, and all of
 * it has to fit in a QR code. One constrained-baseline H.264 (what phones
 * encode in hardware, and what iOS insists on) plus VP8 as a fallback covers
 * every device this app runs on.
 */
function preferHardwareCodecs(transceiver: RTCRtpTransceiver): void {
  const capabilities = RTCRtpReceiver.getCapabilities?.('video');
  if (!capabilities || !transceiver.setCodecPreferences) return;

  const is = (codec: RTCRtpCodec, name: string) => codec.mimeType.toLowerCase().endsWith(name);
  const fmtp = (codec: RTCRtpCodec) => codec.sdpFmtpLine ?? '';

  const h264 =
    capabilities.codecs.find(
      (codec) =>
        is(codec, 'h264') &&
        fmtp(codec).includes('packetization-mode=1') &&
        fmtp(codec).includes('profile-level-id=42e01f'),
    ) ??
    capabilities.codecs.find((codec) => is(codec, 'h264') && fmtp(codec).includes('packetization-mode=1')) ??
    capabilities.codecs.find((codec) => is(codec, 'h264'));

  const vp8 = capabilities.codecs.find((codec) => is(codec, 'vp8'));
  const rtx = capabilities.codecs.find((codec) => is(codec, 'rtx'));

  const chosen = [h264, vp8, rtx].filter((codec): codec is RTCRtpCodec => codec !== undefined);
  if (chosen.length > 0) transceiver.setCodecPreferences(chosen);
}

async function waitForIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return;

  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    // A browser that is slow to enumerate interfaces should not stall pairing:
    // whatever addresses it has by now are the ones that will work anyway.
    const timer = setTimeout(done, ICE_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export class PairingConnection {
  readonly pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private currentState: PairState = 'new';

  onState: ((state: PairState) => void) | null = null;
  onStream: ((stream: MediaStream) => void) | null = null;
  onMessage: ((message: ControlMessage) => void) | null = null;

  constructor(readonly role: PairingRole) {
    // max-bundle puts the video and the control channel on one transport, so
    // the offer lists its local addresses once instead of once per section —
    // which halves the size of the code that has to fit in a picture.
    this.pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });

    this.pc.addEventListener('connectionstatechange', () => {
      const state = this.pc.connectionState;
      if (state === 'connected') this.setState('connected');
      else if (state === 'failed') this.setState('failed');
      else if (state === 'disconnected') this.setState('connecting');
      else if (state === 'closed') this.setState('closed');
    });

    this.pc.addEventListener('track', (event) => {
      const [stream] = event.streams;
      this.onStream?.(stream ?? new MediaStream([event.track]));
    });

    this.pc.addEventListener('datachannel', (event) => {
      this.attachChannel(event.channel);
    });
  }

  get state(): PairState {
    return this.currentState;
  }

  private setState(state: PairState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.onState?.(state);
  }

  private attachChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.addEventListener('message', (event) => {
      try {
        this.onMessage?.(JSON.parse(String(event.data)) as ControlMessage);
      } catch {
        // A malformed control message is not worth breaking a game over.
      }
    });
  }

  /** Control messages: battery, resolution, goodbye. Never scores. */
  send(message: ControlMessage): void {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(message));
  }

  close(): void {
    this.send({ type: 'bye' });
    this.channel?.close();
    this.pc.close();
    this.setState('closed');
  }

  /** The laptop's side: make an offer to show as a QR. */
  static async host(): Promise<{ connection: PairingConnection; code: string }> {
    const connection = new PairingConnection('hub');
    connection.attachChannel(connection.pc.createDataChannel('control', { ordered: true }));

    const transceiver = connection.pc.addTransceiver('video', { direction: 'recvonly' });
    preferHardwareCodecs(transceiver);

    const offer = await connection.pc.createOffer();
    await connection.pc.setLocalDescription(offer);
    await waitForIce(connection.pc);
    connection.setState('waiting');

    const code = await encodePayload({
      v: 1,
      role: 'hub',
      sdp: connection.pc.localDescription?.sdp ?? offer.sdp ?? '',
    });
    return { connection, code };
  }

  /** The laptop's side: take the phone's answer and connect. */
  async accept(code: string): Promise<void> {
    const payload = await decodePayload(code);
    expectRole(payload, 'camera');
    this.setState('connecting');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
  }

  /** The phone's side: read the laptop's offer, send video, answer. */
  static async join(
    code: string,
    stream: MediaStream,
  ): Promise<{ connection: PairingConnection; code: string }> {
    const payload = await decodePayload(code);
    expectRole(payload, 'hub');

    const connection = new PairingConnection('camera');
    connection.setState('connecting');
    await connection.pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });

    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('the camera gave us no video to send');

    const transceiver = connection.pc.getTransceivers().find((t) => t.receiver.track.kind === 'video');
    if (transceiver) {
      await transceiver.sender.replaceTrack(track);
      transceiver.direction = 'sendonly';
    } else {
      connection.pc.addTrack(track, stream);
    }

    const answer = await connection.pc.createAnswer();
    await connection.pc.setLocalDescription(answer);
    await waitForIce(connection.pc);

    const answerCode = await encodePayload({
      v: 1,
      role: 'camera',
      sdp: connection.pc.localDescription?.sdp ?? answer.sdp ?? '',
    });
    return { connection, code: answerCode };
  }
}
