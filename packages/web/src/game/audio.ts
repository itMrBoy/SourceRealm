/**
 * 8-bit 音效:纯 Web Audio 实时合成,无外部音频资源。
 * 懒加载单例 AudioContext(首个用户手势触发的调用时创建),静音时全部 no-op。
 */
import { useStore } from '../store.js'

type Ctx = AudioContext

let ctx: Ctx | null = null

/** 获取(或惰性创建)AudioContext。在非浏览器/不支持环境返回 null。 */
function getCtx(): Ctx | null {
  if (ctx) return ctx
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  return ctx
}

function muted(): boolean {
  return useStore.getState().muted
}

/**
 * 单个振荡器音符。
 * @param freq 起始频率;若提供 endFreq 则在时长内指数滑到 endFreq
 */
function tone(
  type: OscillatorType,
  freq: number,
  start: number,
  duration: number,
  gainPeak = 0.08,
  endFreq?: number,
): void {
  const ac = getCtx()
  if (!ac) return
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), start + duration)
  }
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(gainPeak, start + Math.min(0.01, duration / 4))
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain).connect(ac.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

/** 在首个用户交互时恢复(unlock)被浏览器挂起的 AudioContext。 */
export function unlockAudio(): void {
  const ac = getCtx()
  if (ac && ac.state === 'suspended') void ac.resume()
}

/** 答对:短促上行方波叮。 */
export function playCorrect(): void {
  if (muted()) return
  const ac = getCtx()
  if (!ac) return
  const t = ac.currentTime
  tone('square', 660, t, 0.08)
  tone('square', 880, t + 0.07, 0.1)
}

/** 答错:低沉下行噗。 */
export function playWrong(): void {
  if (muted()) return
  const ac = getCtx()
  if (!ac) return
  const t = ac.currentTime
  tone('triangle', 220, t, 0.22, 0.1, 90)
}

/** 连击:音高随连击数升高。 */
export function playCombo(n: number): void {
  if (muted()) return
  const ac = getCtx()
  if (!ac) return
  const t = ac.currentTime
  const base = 520 + Math.min(n, 12) * 60
  tone('square', base, t, 0.08, 0.07)
  tone('square', base * 1.5, t + 0.05, 0.08, 0.07)
}

/** 通关:四音胜利琶音。 */
export function playLevelClear(): void {
  if (muted()) return
  const ac = getCtx()
  if (!ac) return
  const t = ac.currentTime
  const notes = [523.25, 659.25, 783.99, 1046.5] // C5 E5 G5 C6
  notes.forEach((f, i) => tone('square', f, t + i * 0.12, 0.16, 0.08))
}

/** 徽章:号角式 fanfare。 */
export function playBadge(): void {
  if (muted()) return
  const ac = getCtx()
  if (!ac) return
  const t = ac.currentTime
  tone('square', 392, t, 0.1, 0.08) // G4
  tone('square', 523.25, t + 0.09, 0.1, 0.08) // C5
  tone('square', 659.25, t + 0.18, 0.22, 0.09) // E5
  tone('triangle', 783.99, t + 0.18, 0.26, 0.05) // G5 层
}

/** 点击:轻微 tick。 */
export function playClick(): void {
  if (muted()) return
  const ac = getCtx()
  if (!ac) return
  const t = ac.currentTime
  tone('square', 880, t, 0.04, 0.05)
}
