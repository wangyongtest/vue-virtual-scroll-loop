import { mount } from '@vue/test-utils'
import { nextTick, h, ref } from 'vue'
import {
  flushRaf,
  clearRaf,
  triggerResize,
  triggerIntersection,
} from './setup'
import { VirtualScrollLoop, install } from '../src/index'

/** 设置根节点的 clientWidth / clientHeight（jsdom 默认返回 0） */
function setViewport(wrapper: any, clientWidth: number, clientHeight: number) {
  const el = wrapper.element as HTMLElement
  Object.defineProperty(el, 'clientWidth', {
    value: clientWidth,
    configurable: true,
  })
  Object.defineProperty(el, 'clientHeight', {
    value: clientHeight,
    configurable: true,
  })
}

/**
 * 手动推进 frames 帧。使用全局单调递增的时钟，避免多次 runFrames 调用时
 * 时间戳回退导致组件内 lastTime/lastFrame 计算出负 dt / 触发节流提前返回。
 */
let clock = 1000
function runFrames(frames: number, stepMs = 50) {
  for (let i = 0; i < frames; i++) {
    clock += stepMs
    flushRaf(clock)
  }
}

const makeData = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i, text: `item-${i}` }))

describe('VirtualScrollLoop', () => {
  afterEach(() => {
    clearRaf()
  })

  it('海量数据下只渲染极小的虚拟窗口，且节点数与数据量无关', async () => {
    const wrapper = mount(VirtualScrollLoop, {
      props: { data: makeData(10000), itemSize: 40, buffer: 5, height: 200 },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    await nextTick()

    const items = wrapper.findAll('.vsl-item')
    expect(items.length).toBeLessThan(40)
    expect(items.length).toBeGreaterThan(0)

    const wrapper2 = mount(VirtualScrollLoop, {
      props: { data: makeData(20000), itemSize: 40, buffer: 5, height: 200 },
    })
    setViewport(wrapper2, 300, 200)
    triggerResize()
    await nextTick()
    expect(wrapper2.findAll('.vsl-item').length).toBe(items.length)
  })

  it('根据方向生成正确的 translate3d 符号（up/down/left/right）', async () => {
    const data = makeData(50)
    const dirs = ['up', 'down', 'left', 'right'] as const
    for (const dir of dirs) {
      const wrapper = mount(VirtualScrollLoop, {
        props: { data, direction: dir, speed: 20, itemSize: 40, height: 200 },
      })
      setViewport(wrapper, 300, 200)
      triggerResize()
      runFrames(10) // 1 帧 dt=0 + 9 帧移动 => pos = 20*0.05*9 = 9
      await nextTick()
      const pos = wrapper.vm.getPosition()
      const transform = (wrapper.find('.vsl-inner').element as HTMLElement).style
        .transform
      expect(pos).toBeGreaterThan(0)
      // 用正则校验位移的「轴 + 符号」，容忍浮点小数
      if (dir === 'up') expect(transform).toMatch(/^translate3d\(0, -[\d.]+px, 0\)$/)
      if (dir === 'down') expect(transform).toMatch(/^translate3d\(0, [\d.]+px, 0\)$/)
      if (dir === 'left') expect(transform).toMatch(/^translate3d\(-[\d.]+px, 0, 0\)$/)
      if (dir === 'right') expect(transform).toMatch(/^translate3d\([\d.]+px, 0, 0\)$/)
      wrapper.unmount()
      clearRaf()
    }
  })

  it('循环模式下随时间推进位移（调速生效）', () => {
    const wrapper = mount(VirtualScrollLoop, {
      props: { data: makeData(50), speed: 20, itemSize: 40, height: 200 },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    const before = wrapper.vm.getPosition()
    runFrames(11) // 10 帧移动 => +10
    expect(wrapper.vm.getPosition()).toBeCloseTo(before + 10, 5)
  })

  it('循环模式下位移始终落在 [0, scrollLength) 内（无缝衔接）', () => {
    const wrapper = mount(VirtualScrollLoop, {
      props: { data: makeData(50), speed: 20, itemSize: 40, height: 200 },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    runFrames(2500) // 远超一个 scrollLength(=2000) 周期
    const pos = wrapper.vm.getPosition()
    expect(pos).toBeGreaterThanOrEqual(0)
    expect(pos).toBeLessThan(2000)
  })

  it('鼠标悬停时暂停滚动（hoverPause）', () => {
    const wrapper = mount(VirtualScrollLoop, {
      props: { data: makeData(50), speed: 20, itemSize: 40, height: 200 },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    runFrames(11) // pos 10
    const before = wrapper.vm.getPosition()
    wrapper.find('.vsl-root').trigger('mouseenter')
    runFrames(20)
    expect(wrapper.vm.getPosition()).toBe(before)
    wrapper.find('.vsl-root').trigger('mouseleave')
    runFrames(11) // 第 2 次 runFrames：首帧也带 dt=0.05 => 11 步
    expect(wrapper.vm.getPosition()).toBeCloseTo(before + 11, 5)
  })

  it('setSpeed 运行时调速', () => {
    const wrapper = mount(VirtualScrollLoop, {
      props: { data: makeData(50), speed: 20, itemSize: 40, height: 200 },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    runFrames(11) // pos 10
    wrapper.vm.setSpeed(40)
    expect(wrapper.vm.getSpeed()).toBe(40)
    runFrames(11) // 第 2 次 runFrames：11 帧 × 2px/帧 = +22
    expect(wrapper.vm.getPosition()).toBeCloseTo(32, 5)
  })

  it('scrollTo 将索引映射到正确位移', () => {
    const wrapper = mount(VirtualScrollLoop, {
      props: { data: makeData(50), speed: 20, itemSize: 40, height: 200 },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    wrapper.vm.scrollTo(5)
    expect(wrapper.vm.getPosition()).toBe(5 * 40) // 200
    wrapper.vm.scrollTo(12)
    expect(wrapper.vm.getPosition()).toBe(12 * 40) // 480
  })

  it('非循环 stop：到达末端后停止并派发 reach-end（仅一次）', () => {
    const data = makeData(10)
    const wrapper = mount(VirtualScrollLoop, {
      props: {
        data,
        loop: false,
        endBehavior: 'stop',
        speed: 20,
        itemSize: 40,
        height: 200,
      },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    // scrollLength=400, maxPos=200
    runFrames(300)
    expect(wrapper.vm.getPosition()).toBeCloseTo(200, 5)
    const ev = wrapper.emitted('reach-end')
    expect(ev).toBeTruthy()
    expect((ev as any[]).length).toBe(1)
    runFrames(50) // 不再移动
    expect(wrapper.vm.getPosition()).toBeCloseTo(200, 5)
  })

  it('非循环 reverse：在起止之间往返且不越界', () => {
    const data = makeData(10)
    const wrapper = mount(VirtualScrollLoop, {
      props: {
        data,
        loop: false,
        endBehavior: 'reverse',
        speed: 20,
        itemSize: 40,
        height: 200,
      },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    runFrames(500)
    const pos = wrapper.vm.getPosition()
    expect(pos).toBeGreaterThanOrEqual(0)
    expect(pos).toBeLessThanOrEqual(200)
    // reverse 模式在起止间往返、不越界（不会派发 reach-end/reach-start）
  })

  it('点击子项派发 item-click 并携带正确 payload', async () => {
    const data = makeData(20)
    const wrapper = mount(VirtualScrollLoop, {
      props: { data, itemSize: 40, height: 200 },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    await nextTick()
    await wrapper.find('.vsl-item').trigger('click')
    const ev = wrapper.emitted('item-click') as any[]
    expect(ev).toBeTruthy()
    const payload = ev[0][0]
    expect(payload).toHaveProperty('item')
    expect(payload).toHaveProperty('index')
    expect(payload.index).toBeGreaterThanOrEqual(0)
    expect(payload.index).toBeLessThan(20)
  })

  it('emitScroll 为真时派发 scroll 事件', () => {
    const wrapper = mount(VirtualScrollLoop, {
      props: {
        data: makeData(20),
        emitScroll: true,
        speed: 20,
        itemSize: 40,
        height: 200,
      },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    runFrames(20)
    expect(wrapper.emitted('scroll')).toBeTruthy()
  })

  it('emitScroll 在静止(暂停)时不派发 scroll 事件', () => {
    const wrapper = mount(VirtualScrollLoop, {
      props: {
        data: makeData(20),
        emitScroll: true,
        autoPlay: false, // 不自动播放 => pos 不变
        itemSize: 40,
        height: 200,
      },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    runFrames(20)
    expect(wrapper.emitted('scroll')).toBeFalsy()
  })

  it('空数据时 scrollTo 不破坏位移（不产生 NaN）', () => {
    const wrapper = mount(VirtualScrollLoop, {
      props: { data: [], itemSize: 40, height: 200 },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    wrapper.vm.scrollTo(3)
    expect(Number.isNaN(wrapper.vm.getPosition())).toBe(false)
    expect(wrapper.vm.getPosition()).toBe(0)
  })

  it('非循环且 visibleCount 大于数据量时：不误触发边界事件，pos 固定为 0', () => {
    const wrapper = mount(VirtualScrollLoop, {
      props: {
        data: makeData(3),
        loop: false,
        visibleCount: 10, // 视口请求 10 行，但只有 3 行数据
        itemSize: 40,
        height: 200,
        endBehavior: 'stop',
      },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    runFrames(50)
    expect(wrapper.vm.getPosition()).toBe(0)
    expect(wrapper.emitted('reach-end')).toBeFalsy()
    expect(wrapper.emitted('reach-start')).toBeFalsy()
  })

  it('离开视口时暂停（pauseWhenHidden / IntersectionObserver）', () => {
    const wrapper = mount(VirtualScrollLoop, {
      props: { data: makeData(50), speed: 20, itemSize: 40, height: 200 },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    runFrames(11) // pos 10
    const before = wrapper.vm.getPosition()
    triggerIntersection(false)
    runFrames(20)
    expect(wrapper.vm.getPosition()).toBe(before)
    triggerIntersection(true)
    runFrames(11) // 第 2 次 runFrames：11 步
    expect(wrapper.vm.getPosition()).toBeCloseTo(before + 11, 5)
  })

  it('默认插槽接收 item / index 作用域', async () => {
    const data = makeData(10)
    const wrapper = mount(VirtualScrollLoop, {
      props: { data, itemSize: 40, height: 200 },
      slots: {
        default: (slotProps: any) =>
          h('span', { class: 'custom' }, slotProps.item.text),
      },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    await nextTick()
    expect(wrapper.find('.custom').exists()).toBe(true)
  })

  it('visibleCount 显式控制可视窗口渲染条数（= visibleCount + 2*buffer + 1）', async () => {
    const wrapper = mount(VirtualScrollLoop, {
      props: {
        data: makeData(10000),
        itemSize: 40,
        buffer: 5,
        visibleCount: 3,
        height: 200,
      },
    })
    setViewport(wrapper, 300, 200)
    triggerResize()
    await nextTick()
    // 非 reverse 方向: end - start + 1 = visibleCount + 2*buffer + 1
    expect(wrapper.findAll('.vsl-item').length).toBe(3 + 2 * 5 + 1) // 14
    // 渲染条数由 visibleCount 决定，不受容器尺寸变化影响
    setViewport(wrapper, 1000, 800)
    triggerResize()
    await nextTick()
    expect(wrapper.findAll('.vsl-item').length).toBe(14)
  })

  it('rootRef 以 props 形式接收根 DOM 元素', async () => {
    const rootRef = ref<HTMLElement | null>(null)
    const wrapper = mount(VirtualScrollLoop, {
      props: { data: makeData(10), rootRef, itemSize: 40, height: 200 },
    })
    setViewport(wrapper, 300, 200)
    await nextTick()
    expect(rootRef.value).toBeTruthy()
    expect(rootRef.value).toBe(wrapper.element)
  })

  it('install 以默认名全局注册组件', () => {
    const app = {
      component(name: string, comp: any) {
        ;(this as any)._name = name
        ;(this as any)._comp = comp
      },
    } as any
    install(app)
    expect(app._name).toBe('VirtualScrollLoop')
    expect(app._comp).toBeDefined()
  })
})
