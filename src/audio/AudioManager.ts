import { eventBus } from '../core/EventBus'
import type { AudioPlayPayload, SfxName } from '../Data/Types'

const VOLUME_KEY = 'rts.volume'
const MUTED_KEY = 'rts.muted'

/** Tiny synthesized soundscape (no external audio files needed for the MVP). */
export class AudioManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private volume: number
  private muted: boolean

  constructor() {
    this.volume = readNumber(VOLUME_KEY, 0.65)
    this.muted = readBoolean(MUTED_KEY, false)
    eventBus.on('audioPlay', this.onPlay)
  }

  unlock(): void {
    this.ensureContext()
    if (this.ctx?.state === 'suspended') {
      void this.ctx.resume()
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    writeBoolean(MUTED_KEY, muted)
    this.applyVolume()
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    writeNumber(VOLUME_KEY, this.volume)
    this.applyVolume()
  }

  getMuted(): boolean {
    return this.muted
  }

  getVolume(): number {
    return this.volume
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted)
    return this.muted
  }

  play(sfx: SfxName, volumeScale = 1): void {
    if (this.muted || this.volume <= 0) return
    const ctx = this.ensureContext()
    if (!ctx) return
    if (ctx.state === 'suspended') void ctx.resume()
    switch (sfx) {
      case 'detectorBeep':
        this.beep(1320, 0.055, 0.14 * volumeScale)
        break
      case 'explosion':
        this.noise(0.7, 320, 0.9 * volumeScale)
        this.tone(52, 0.55, 0.5 * volumeScale, 'sine', 0.7)
        break
      case 'gunshotRifle':
        this.noise(0.09, 1400, 0.32 * volumeScale)
        this.tone(150, 0.06, 0.2 * volumeScale, 'square')
        break
      case 'gunshotMg':
        this.noise(0.055, 2100, 0.22 * volumeScale)
        this.tone(105, 0.04, 0.14 * volumeScale, 'square')
        break
      case 'boltAction':
        this.tone(1800, 0.03, 0.12 * volumeScale, 'square')
        this.tone(900, 0.03, 0.1 * volumeScale, 'square', 0.06)
        break
      case 'mineClick':
        this.beep(2100, 0.03, 0.22 * volumeScale)
        this.beep(1500, 0.04, 0.18 * volumeScale, 0.06)
        break
      case 'victory':
        this.victory()
        break
    }
  }

  dispose(): void {
    eventBus.off('audioPlay', this.onPlay)
    if (this.ctx) {
      void this.ctx.close()
      this.ctx = null
      this.master = null
      this.noiseBuffer = null
    }
  }

  private onPlay = (payload: AudioPlayPayload): void => {
    this.play(payload.sfx, payload.volume ?? 1)
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.connect(this.ctx.destination)
    this.applyVolume()

    const sampleRate = this.ctx.sampleRate
    const buffer = this.ctx.createBuffer(1, Math.floor(sampleRate * 0.8), sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
    this.noiseBuffer = buffer
    return this.ctx
  }

  private applyVolume(): void {
    if (!this.master || !this.ctx) return
    const value = this.muted ? 0 : this.volume
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.015)
  }

  private tone(
    frequency: number,
    duration: number,
    gain: number,
    type: OscillatorType = 'sine',
    delay = 0,
  ): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const start = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const envelope = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(frequency, start)
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + 0.008)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    osc.connect(envelope)
    envelope.connect(master)
    osc.start(start)
    osc.stop(start + duration + 0.02)
  }

  private beep(frequency: number, duration: number, gain: number, delay = 0): void {
    this.tone(frequency, duration, gain, 'sine', delay)
  }

  private noise(duration: number, cutoff: number, gain: number): void {
    const ctx = this.ctx
    const master = this.master
    const buffer = this.noiseBuffer
    if (!ctx || !master || !buffer) return
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(cutoff * 2.2, ctx.currentTime)
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * 0.6), ctx.currentTime + duration)
    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(Math.max(0.0001, gain), ctx.currentTime)
    envelope.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)
    source.connect(filter)
    filter.connect(envelope)
    envelope.connect(master)
    source.start()
    source.stop(ctx.currentTime + duration + 0.02)
  }

  private victory(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((frequency, index) => {
      this.tone(frequency, 0.28, 0.18, 'triangle', index * 0.13)
    })
  }
}

function readNumber(key: string, fallback: number): number {
  try {
    const value = localStorage.getItem(key)
    if (value === null) return fallback
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback
  } catch {
    return fallback
  }
}

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // Storage can be disabled; audio still works for this run.
  }
}

function writeBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // Storage can be disabled; audio still works for this run.
  }
}
