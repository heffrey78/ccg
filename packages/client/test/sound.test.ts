import { describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '@ccg/core';
import { BEAT_MS } from '../src/ui/play/playback.js';
import { CUES, EVENT_CUES, Sound, cueOf, digest, type CreateContext } from '../src/ui/sound.js';

const event = (type: string): GameEvent => ({ type }) as GameEvent;

/** Enough of Web Audio to count what gets started. */
function fakeAudio(state: AudioContextState = 'running') {
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const started: number[] = [];
  const source = () => ({ connect: vi.fn(), start: (at: number) => started.push(at), stop: vi.fn(), type: '', frequency: param(), buffer: null });
  const master = { gain: param(), connect: vi.fn() };
  let gains = 0;
  const context = {
    decodeAudioData: vi.fn(async (bytes: ArrayBuffer) => {
      if (bytes.byteLength === 0) throw new Error('not audio');
      return { fromFile: true } as unknown as AudioBuffer;
    }),
    state,
    currentTime: 10,
    sampleRate: 8000,
    destination: {},
    createGain: () => (gains++ === 0 ? master : { gain: param(), connect: vi.fn() }),
    createOscillator: source,
    createBufferSource: source,
    createBiquadFilter: () => ({ type: '', frequency: param(), connect: vi.fn() }),
    createBuffer: () => ({ getChannelData: () => new Float32Array(4) }),
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    suspend: vi.fn(async () => {
      context.state = 'suspended';
    }),
  };
  const create = vi.fn(() => context as unknown as AudioContext);
  return { context, create: create as CreateContext & typeof create, started, master };
}

describe('cues', () => {
  it('maps events that make a noise, and only those', () => {
    expect(cueOf(event('DamageDealt'))).toBe('hit');
    expect(cueOf(event('UnitDied'))).toBe('death');
    expect(cueOf(event('PhaseStarted'))).toBeNull();
  });

  it('only uses events playback animates, so sound and motion stay together', () => {
    for (const type of Object.keys(EVENT_CUES)) expect(BEAT_MS[type], type).toBeDefined();
  });

  it('digests a step to its first few different cues', () => {
    const step = ['PhaseStarted', 'DamageDealt', 'DamageDealt', 'BlockGained', 'Healed', 'UnitDied'].map(event);
    expect(digest(step)).toEqual(['hit', 'block', 'heal']);
    expect(digest([event('PhaseStarted')])).toEqual([]);
  });
});

describe('Sound', () => {
  it('plays every cue', () => {
    const audio = fakeAudio();
    const sound = new Sound(audio.create);
    sound.setVolume(1);
    for (const cue of CUES) {
      audio.started.length = 0;
      sound.play(cue);
      expect(audio.started.length, cue).toBeGreaterThan(0);
    }
  });

  it('at volume 0 plays nothing and never creates audio', () => {
    const audio = fakeAudio();
    const sound = new Sound(audio.create);
    sound.setVolume(0);
    sound.play('hit');
    expect(audio.create).not.toHaveBeenCalled();
  });

  it('sets the master gain from the volume, before and after audio exists', () => {
    const audio = fakeAudio();
    const sound = new Sound(audio.create);
    sound.setVolume(0.5);
    sound.play('card');
    expect(audio.master.gain.value).toBe(0.5);
    sound.setVolume(0.25);
    expect(audio.master.gain.value).toBe(0.25);
  });

  it('drops a cue until audio is allowed, rather than saving them all up', () => {
    const audio = fakeAudio('suspended');
    const sound = new Sound(audio.create);
    sound.setVolume(1);
    sound.play('hit');
    expect(audio.started).toEqual([]);
    expect(audio.context.resume).toHaveBeenCalled();
  });

  it('spaces a digest out', () => {
    const audio = fakeAudio();
    const sound = new Sound(audio.create);
    sound.setVolume(1);
    sound.playDigest(['card', 'move']);
    expect(audio.started).toHaveLength(2);
    expect(audio.started[1]).toBeGreaterThan(audio.started[0] as number);
  });

  it('is silent while hidden, and comes back', () => {
    const audio = fakeAudio();
    const sound = new Sound(audio.create);
    sound.setVolume(1);
    sound.play('card');
    sound.setHidden(true);
    expect(audio.context.suspend).toHaveBeenCalled();
    audio.started.length = 0;
    sound.play('card');
    expect(audio.started).toEqual([]);
    sound.setHidden(false);
    sound.play('card');
    expect(audio.started.length).toBeGreaterThan(0);
  });

  describe('a game\'s own sounds', () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve));
    const playedBuffers = (audio: ReturnType<typeof fakeAudio>) => {
      const buffers: unknown[] = [];
      const create = audio.context.createBufferSource;
      audio.context.createBufferSource = () => {
        const source = create();
        Object.defineProperty(source, 'buffer', { set: (b) => buffers.push(b) });
        return source;
      };
      return buffers;
    };

    it('replace the cues they name, and the others stay built in', async () => {
      const audio = fakeAudio();
      const buffers = playedBuffers(audio);
      const sound = new Sound(audio.create, async () => new ArrayBuffer(8));
      sound.setVolume(1);
      sound.setSounds({ hit: 'blob:hit' });
      sound.play('card');
      await settle();
      sound.play('hit');
      expect(buffers).toEqual([{ fromFile: true }]);
      sound.play('heal');
      expect(buffers).toHaveLength(1);
    });

    it('wait for audio before loading, and need none at volume 0', async () => {
      const audio = fakeAudio();
      const fetchFile = vi.fn(async () => new ArrayBuffer(8));
      const sound = new Sound(audio.create, fetchFile);
      sound.setSounds({ hit: 'blob:hit' });
      sound.play('hit');
      await settle();
      expect(fetchFile).not.toHaveBeenCalled();
      sound.setVolume(1);
      sound.play('card');
      expect(fetchFile).toHaveBeenCalledWith('blob:hit');
    });

    it('fall back to the built-in sound when a file is broken or missing', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      for (const fetchFile of [async () => new ArrayBuffer(0), async () => Promise.reject(new Error('404'))]) {
        const audio = fakeAudio();
        const sound = new Sound(audio.create, fetchFile);
        sound.setVolume(1);
        sound.setSounds({ hit: 'blob:hit' });
        sound.play('card');
        await settle();
        audio.started.length = 0;
        sound.play('hit');
        expect(audio.started.length).toBeGreaterThan(0);
      }
      expect(warn).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    });

    it('are dropped when another game starts', async () => {
      const audio = fakeAudio();
      const buffers = playedBuffers(audio);
      const sound = new Sound(audio.create, async () => new ArrayBuffer(8));
      sound.setVolume(1);
      sound.play('card');
      sound.setSounds({ heal: 'blob:heal' });
      await settle();
      sound.setSounds({});
      sound.play('heal');
      expect(buffers).toEqual([]);
    });
  });

  it('survives no audio and broken audio', () => {
    const none = new Sound(() => null);
    none.setVolume(1);
    expect(() => none.play('hit')).not.toThrow();
    const broken = new Sound(() => {
      throw new Error('no device');
    });
    broken.setVolume(1);
    expect(() => broken.play('hit')).not.toThrow();
  });

  it('unlocks on a gesture and follows visibility until detached', () => {
    const audio = fakeAudio('suspended');
    const sound = new Sound(audio.create);
    sound.setVolume(1);
    const target = Object.assign(new EventTarget(), { hidden: false }) as unknown as Document;
    const detach = sound.attach(target);
    target.dispatchEvent(new Event('pointerdown'));
    expect(audio.context.resume).toHaveBeenCalledOnce();
    (target as unknown as { hidden: boolean }).hidden = true;
    target.dispatchEvent(new Event('visibilitychange'));
    expect(audio.context.suspend).toHaveBeenCalledOnce();
    detach();
    target.dispatchEvent(new Event('visibilitychange'));
    expect(audio.context.suspend).toHaveBeenCalledOnce();
  });
});
