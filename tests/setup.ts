// 测试环境基础设施：
// - 用可控的 requestAnimationFrame 捕获回调，便于在测试中手动推进帧
// - mock ResizeObserver / IntersectionObserver（jsdom 未实现）

let rafCallbacks: FrameRequestCallback[] = []
let rafSeq = 0

const g = globalThis as any

g.requestAnimationFrame = (cb: FrameRequestCallback): number => {
  rafSeq += 1
  rafCallbacks.push(cb)
  return rafSeq
}
g.cancelAnimationFrame = (): void => {
  rafCallbacks = []
}

/** 执行当前已排队的 rAF 回调一次（传入时间戳模拟帧） */
export function flushRaf(timestamp: number): void {
  const cbs = rafCallbacks
  rafCallbacks = []
  cbs.forEach((cb) => cb(timestamp))
}

/** 清空待执行的 rAF 队列 */
export function clearRaf(): void {
  rafCallbacks = []
}

let roCb: (() => void) | null = null
class MockResizeObserver {
  constructor(cb: () => void) {
    roCb = cb
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    roCb = null
  }
}
g.ResizeObserver = MockResizeObserver

let ioCb: ((entries: any[]) => void) | null = null
class MockIntersectionObserver {
  constructor(cb: (entries: any[]) => void) {
    ioCb = cb
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    ioCb = null
  }
}
g.IntersectionObserver = MockIntersectionObserver

/** 触发 ResizeObserver 回调，重测容器尺寸 */
export function triggerResize(): void {
  if (roCb) roCb()
}

/** 触发 IntersectionObserver 回调，控制可见性 */
export function triggerIntersection(isVisible: boolean): void {
  if (ioCb) ioCb([{ isIntersecting: isVisible }])
}
