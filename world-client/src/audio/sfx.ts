/**
 * 程序化环境音效（sensory Phase 2）：零外部音频素材，纯 Web Audio 合成。
 *
 * 支持四类：雨声白噪声（带带通滤波）、神谕钟声（纯五度双音）、建造落成琶音、
 * 步态轻音。所有函数在 `AudioContext` 缺失（无头/SSR）或 `muted` 时**静默降级**
 * 返回 true，绝不抛未捕获异常——与「严禁无 AudioContext 抛异常」直接对应。
 * 随机性全部来自确定性线性同余伪随机（而非 `Math.random()`），保证同种子可复现。
 */

export class ProceduralSfxEngine {
  private readonly ctx: AudioContext | null;
  private rainSource: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;
  private muted = false;

  /** 无头/无 AudioContext 时传 null 即安全降级（不抛异常）。 */
  constructor(audioContext?: AudioContext | null) {
    this.ctx = audioContext ?? null;
  }

  /** 无 `AudioContext` 时为 true——调用方据此静默跳过音频。 */
  public isHeadlessNoop(): boolean {
    return this.ctx === null;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted && this.rainGain && this.ctx) {
      this.rainGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }

  /** 雨声白噪声环境音；无 ctx 或静音时降级返回 true。 */
  public setRainAmbience(active: boolean): boolean {
    if (!this.ctx || this.muted) return true;
    if (!active) {
      if (this.rainGain) this.rainGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
      return true;
    }
    if (!this.rainSource) {
      const sampleRate = this.ctx.sampleRate;
      const buffer = this.ctx.createBuffer(1, sampleRate * 2, sampleRate);
      const data = buffer.getChannelData(0);
      // 确定性线性同余生成 Pink Noise，避免 Math.random。
      let seed = 1337;
      let b0 = 0;
      let b1 = 0;
      for (let i = 0; i < data.length; i += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const white = (seed / 0xffffffff) * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        data[i] = (b0 + b1) * 0.25;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1100;
      filter.Q.value = 0.7;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.0;

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      src.start();

      this.rainSource = src;
      this.rainGain = gain;
    }
    this.rainGain?.gain.setTargetAtTime(0.08, this.ctx.currentTime, 0.2);
    return true;
  }

  /** 神谕钟声：C5 + G5 纯五度双音。无 ctx / 静音时降级返回 true。 */
  public playOracleChime(): boolean {
    if (!this.ctx || this.muted) return true;
    const now = this.ctx.currentTime;
    const freqs = [523.25, 783.99]; // C5 + G5
    for (const f of freqs) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.56);
    }
    return true;
  }

  /** 建造落成琶音：C-E-G-C。无 ctx / 静音时降级返回 true。 */
  public playBuildComplete(): boolean {
    if (!this.ctx || this.muted) return true;
    const now = this.ctx.currentTime;
    const ctx = this.ctx;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C-E-G-C 8-bit 琶音
    notes.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + idx * 0.065;
      osc.type = 'square';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.07, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    });
    return true;
  }

  /** 步态轻音：短促三角音带衰减。无 ctx / 静音时降级返回 true。 */
  public playFootstep(): boolean {
    if (!this.ctx || this.muted) return true;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.025);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.032);
    return true;
  }
}
