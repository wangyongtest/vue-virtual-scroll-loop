import {
  defineComponent,
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
  h,
  type CSSProperties,
  type PropType,
  type Ref,
} from 'vue-demi'

/**
 * 将数值尺寸转为带 px 的字符串；非数值原样返回。
 */
function toSize(v: string | number | null | undefined): string | undefined {
  if (v == null) return undefined
  if (typeof v === 'number') return v + 'px'
  return v
}

export type ScrollDirection = 'up' | 'down' | 'left' | 'right'
export type EndBehavior = 'stop' | 'reverse'
export type ItemKeyFn = (item: any, index: number, idx: number) => string | number
export type RootRef =
  | Ref<HTMLElement | null>
  | ((el: HTMLElement | null) => void)
  | null

export interface ItemClickPayload {
  item: any
  index: number
  event: MouseEvent
}

export interface ScrollPayload {
  position: number
  direction: ScrollDirection
}

export interface VirtualScrollLoopInstance {
  play(): void
  pause(): void
  toggle(): void
  stop(): void
  reset(): void
  setSpeed(v: number): void
  scrollTo(index: number): void
  getPosition(): number
  getSpeed(): number
}

interface VslItem {
  idx: number
  key: string | number
  data: any
  dataIndex: number
  pos: number
}

/**
 * VirtualScrollLoop —— 高性能无限循环滚动列表（虚拟 DOM）。
 *
 * 特性：
 *  - 四向滚动：up / down（纵向）、left / right（横向）
 *  - 海量数据：仅渲染视口内 + 缓冲区项（虚拟列表）
 *  - 无限循环：内容周期性重复，位移取模实现无缝衔接
 *  - 调速：speed（px/s）+ setSpeed()，支持运行时动态调整
 *  - 悬停暂停（hoverPause）、离屏暂停（pauseWhenHidden）
 *  - 滚轮手动滚动（interactive）
 *  - 可视窗口条数：visibleCount 显式控制渲染条数（默认按容器尺寸自动计算）
 *  - 根节点外传：rootRef 以 props 形式接收根 DOM 元素（替代内部 $refs）
 *  - 高度可定制：尺寸、间距、缓冲、帧率、循环/非循环、边界行为等
 */
export const VirtualScrollLoop = defineComponent({
  name: 'VirtualScrollLoop',
  props: {
    /** 数据源（数组，支持海量数据） */
    data: { type: Array as PropType<any[]>, default: () => [] as any[] },
    /** 滚动方向：up/down 纵向，left/right 横向 */
    direction: {
      type: String as PropType<ScrollDirection>,
      default: 'up' as ScrollDirection,
      validator: (v: string) => ['up', 'down', 'left', 'right'].includes(v),
    },
    /** 滚动速度，单位 px/秒 */
    speed: { type: Number, default: 30 },
    /** 单项尺寸：纵向为高度，横向为宽度（px） */
    itemSize: { type: Number, default: 40 },
    /** 项与项之间的间距（px） */
    gap: { type: Number, default: 0 },
    /** 视口外额外渲染的缓冲项数（防止快速滚动露白） */
    buffer: { type: Number, default: 5 },
    /** 是否循环（无限滚动）。false 时为普通虚拟列表，到边界按 endBehavior 处理 */
    loop: { type: Boolean, default: true },
    /** 是否自动播放 */
    autoPlay: { type: Boolean, default: true },
    /** 鼠标悬停时暂停滚动 */
    hoverPause: { type: Boolean, default: true },
    /** 单项 key 提取：字符串字段名或函数 (item, index, idx) => key */
    itemKey: {
      type: [String, Function] as PropType<string | ItemKeyFn | null>,
      default: null,
    },
    /** 容器宽度（数字按 px，或 '100%' 等 CSS 值） */
    width: { type: [String, Number] as PropType<string | number>, default: '100%' },
    /** 容器高度 */
    height: { type: [String, Number] as PropType<string | number>, default: 200 },
    /** 帧率上限（默认 60） */
    fps: { type: Number, default: 60 },
    /** 非循环模式下到达边界的行为：stop 停止 | reverse 反向 */
    endBehavior: {
      type: String as PropType<EndBehavior>,
      default: 'stop' as EndBehavior,
      validator: (v: string) => ['stop', 'reverse'].includes(v),
    },
    /** 容器离开视口（IntersectionObserver）时暂停，节省性能 */
    pauseWhenHidden: { type: Boolean, default: true },
    /** 悬停时允许通过鼠标滚轮手动滚动 */
    interactive: { type: Boolean, default: false },
    /** 根节点自定义 class */
    rootClass: { type: [String, Array, Object] as PropType<any>, default: '' },
    /** 单项自定义 class */
    itemClass: { type: [String, Array, Object] as PropType<any>, default: '' },
    /** 是否派发 scroll 事件（节流 100ms） */
    emitScroll: { type: Boolean, default: false },
    /**
     * 可视窗口同时渲染的数据条数。
     * - 0（默认）：按容器实测尺寸自动计算（视口可见数 = 容器尺寸 / 单项步长）
     * - > 0：强制渲染 visibleCount 条（外加 buffer 缓冲），渲染窗口不再依赖容器尺寸测量
     */
    visibleCount: { type: Number, default: 0 },
    /**
     * 根节点 ref（以 props 形式传入，替代内部 $refs）。
     * 可传 Vue Ref 或 (el) => void 回调，组件挂载后会将根 DOM 元素写入。
     * 默认 null：组件自行管理内部 ref。
     */
    rootRef: {
      type: [Function, Object] as PropType<RootRef>,
      default: null,
    },
  },
  emits: [
    'item-click',
    'reach-start',
    'reach-end',
    'scroll',
    'mouseenter',
    'mouseleave',
  ],
  setup(props, { slots, emit, expose }) {
    const root = ref<HTMLElement | null>(null)
    const pos = ref(0) // 当前位移（px），循环模式下范围 [0, scrollLength)
    const viewportSize = ref(0) // 沿滚动轴的容器实测尺寸
    const playing = ref(props.autoPlay)
    const hovering = ref(false)
    const visible = ref(true)
    const speedRef = ref(props.speed)
    const dirSign = ref(1) // 仅非循环 reverse 模式使用

    let rafId: number | null = null
    let lastTime = 0
    let lastFrame = 0
    let lastEmit = 0
    let lastEmittedPos = 0
    let ro: any = null
    let io: any = null

    const isHorizontal = computed(
      () => props.direction === 'left' || props.direction === 'right'
    )
    const isReverse = computed(
      () => props.direction === 'down' || props.direction === 'right'
    )
    const total = computed(() => (props.data ? props.data.length : 0))
    const step = computed(() => Math.max(1, props.itemSize + props.gap))
    const scrollLength = computed(() => Math.max(1, total.value * step.value))
    // 内容是否溢出可视窗口（即是否需要滚动）：内容总长度 > 视口跨度才有滚动空间
    const isScrollable = computed(
      () => scrollLength.value > viewportSpan.value
    )

    // 视口沿滚动轴的有效跨度：
    //   - visibleCount > 0 时优先使用「可见条数 × 步长」，渲染窗口与容器实测尺寸解耦
    //   - 否则回退到容器实测尺寸（默认值 0 的自动行为）
    const viewportSpan = computed(() =>
      props.visibleCount && props.visibleCount > 0
        ? props.visibleCount * step.value
        : viewportSize.value
    )

    // 重复份数：保证任意时刻视口 + 缓冲都能被填满（小数组时自动增加份数）
    const repeatCount = computed(() => {
      if (!props.loop) return 1
      const needed = viewportSpan.value + props.buffer * step.value
      return Math.max(2, Math.ceil(needed / scrollLength.value) + 1)
    })
    const listLength = computed(() =>
      Math.max(1, repeatCount.value * total.value)
    )

    // 计算当前需要渲染的逻辑索引区间 [start, end]
    const visibleRange = computed(() => {
      const v = viewportSpan.value
      const p = pos.value
      const s = step.value
      const b = props.buffer * s
      if (isReverse.value) {
        const start = Math.floor((-p - b) / s)
        const end = Math.ceil((-p + v + b) / s)
        return { start, end }
      }
      const start = Math.floor((p - b) / s)
      const end = Math.ceil((p + v + b) / s)
      return { start, end }
    })

    function resolveKey(item: any, dataIndex: number, idx: number): string | number {
      if (typeof props.itemKey === 'function') {
        return (props.itemKey as ItemKeyFn)(item, dataIndex, idx)
      }
      if (typeof props.itemKey === 'string') {
        return item && item[props.itemKey] != null ? item[props.itemKey] : idx
      }
      return idx
    }

    // 虚拟列表：仅输出视口内 + 缓冲区的项
    const items = computed<VslItem[]>(() => {
      const out: VslItem[] = []
      if (total.value === 0) return out
      const { start, end } = visibleRange.value
      const L = listLength.value
      for (let idx = start; idx <= end; idx++) {
        const eff = ((idx % L) + L) % L // 归一化到 [0, L)
        const dataIndex = eff % total.value
        out.push({
          idx,
          key: resolveKey(props.data[dataIndex], dataIndex, idx),
          data: props.data[dataIndex],
          dataIndex,
          pos: idx * step.value, // 沿滚动轴的绝对坐标
        })
      }
      return out
    })

    const translate = computed(() => (isReverse.value ? pos.value : -pos.value))

    /** 将根 DOM 元素同步给外部传入的 rootRef（Vue Ref 或 回调） */
    function syncRootRef(el: HTMLElement | null) {
      const r = props.rootRef
      if (!r) return
      if (typeof r === 'function') (r as (el: HTMLElement | null) => void)(el)
      else if (r && typeof r === 'object' && 'value' in r) {
        ;(r as Ref<HTMLElement | null>).value = el
      }
    }
    watch(root, syncRootRef)
    // 容器尺寸变化不影响：rootRef 始终指向根 DOM 元素

    function measure() {
      if (!root.value) return
      viewportSize.value = isHorizontal.value
        ? root.value.clientWidth
        : root.value.clientHeight
    }

    function frame(now: number) {
      rafId = requestAnimationFrame(frame)
      if (!lastTime) lastTime = now
      const dt = (now - lastTime) / 1000
      lastTime = now

      const interval = 1000 / (props.fps || 60)
      if (now - lastFrame < interval - 1) return
      lastFrame = now

      const shouldRun =
        playing.value && !hovering.value && visible.value && total.value > 0

      if (shouldRun) {
        const delta = speedRef.value * dt * (props.loop ? 1 : dirSign.value)
        let next = pos.value + delta
        if (props.loop) {
          // 取模实现无缝循环
          next =
            ((next % scrollLength.value) + scrollLength.value) %
            scrollLength.value
        } else {
          const maxPos = Math.max(0, scrollLength.value - viewportSpan.value)
          if (!isScrollable.value) {
            // 内容不足以填满可视窗口（如 visibleCount 大于数据量）：无需滚动，固定 pos=0
            next = 0
          } else if (next >= maxPos) {
            next = maxPos
            if (props.endBehavior === 'reverse') dirSign.value = -1
            else {
              playing.value = false
              emit('reach-end')
            }
          } else if (next <= 0 && dirSign.value < 0) {
            // 仅在「反向回弹至起点」时判定越界；初始静止于起点不触发停止
            next = 0
            if (props.endBehavior === 'reverse') dirSign.value = 1
            else {
              playing.value = false
              emit('reach-start')
            }
          }
        }
        pos.value = next
      }

      if (
        props.emitScroll &&
        now - lastEmit > 100 &&
        pos.value !== lastEmittedPos
      ) {
        lastEmit = now
        lastEmittedPos = pos.value
        emit('scroll', { position: pos.value, direction: props.direction })
      }
    }

    // ---- 交互事件 ----
    function onEnter(e: MouseEvent) {
      hovering.value = true
      emit('mouseenter', e)
    }
    function onLeave(e: MouseEvent) {
      hovering.value = false
      emit('mouseleave', e)
    }
    function onWheel(e: WheelEvent) {
      if (!props.interactive) return
      const d = isHorizontal.value ? e.deltaX || e.deltaY : e.deltaY
      if (props.loop) {
        pos.value =
          ((pos.value + d) % scrollLength.value + scrollLength.value) %
          scrollLength.value
      } else {
        const maxPos = Math.max(0, scrollLength.value - viewportSpan.value)
        pos.value = Math.min(maxPos, Math.max(0, pos.value + d))
      }
    }

    // ---- 对外方法 ----
    function play() {
      playing.value = true
      lastTime = 0
    }
    function pause() {
      playing.value = false
    }
    function toggle() {
      playing.value ? pause() : play()
    }
    function stop() {
      playing.value = false
      pos.value = 0
    }
    function reset() {
      pos.value = 0
      dirSign.value = 1
      playing.value = props.autoPlay
      lastTime = 0
    }
    function setSpeed(v: number) {
      if (typeof v === 'number') speedRef.value = v
    }
    function scrollTo(index: number) {
      if (total.value === 0) return
      const i = ((index % total.value) + total.value) % total.value
      const target = i * step.value
      const maxPos = Math.max(0, scrollLength.value - viewportSpan.value)
      pos.value = props.loop ? target % scrollLength.value : Math.min(target, maxPos)
    }
    function getPosition() {
      return pos.value
    }
    function getSpeed() {
      return speedRef.value
    }

    expose<VirtualScrollLoopInstance>({
      play,
      pause,
      toggle,
      stop,
      reset,
      setSpeed,
      scrollTo,
      getPosition,
      getSpeed,
      root,
    } as VirtualScrollLoopInstance)

    // ---- 响应式 ----
    watch(
      () => props.speed,
      (v) => {
        if (typeof v === 'number') speedRef.value = v
      }
    )
    watch(
      () => props.data,
      () => {
        if (props.loop) {
          pos.value = pos.value % scrollLength.value
        } else {
          const maxPos = Math.max(0, scrollLength.value - viewportSpan.value)
          if (pos.value > maxPos) pos.value = maxPos
        }
      }
    )
    watch(
      () => props.direction,
      () => {
        lastTime = 0 // 避免切换方向时的瞬时跳变
      }
    )

    onMounted(() => {
      measure()
      nextTick(measure)
      syncRootRef(root.value)
      if (typeof ResizeObserver !== 'undefined' && root.value) {
        ro = new ResizeObserver(() => measure())
        ro.observe(root.value)
      }
      if (
        props.pauseWhenHidden &&
        typeof IntersectionObserver !== 'undefined' &&
        root.value
      ) {
        io = new IntersectionObserver(
          (entries) => {
            visible.value = entries[0] ? entries[0].isIntersecting : true
          },
          { threshold: 0 }
        )
        io.observe(root.value)
      }
      rafId = requestAnimationFrame(frame)
    })

    onBeforeUnmount(() => {
      if (rafId) cancelAnimationFrame(rafId)
      if (ro) ro.disconnect()
      if (io) io.disconnect()
    })

    // ---- 渲染 ----
    return () => {
      const isH = isHorizontal.value
      const t = translate.value
      const transform = isH
        ? 'translate3d(' + t + 'px, 0, 0)'
        : 'translate3d(0, ' + t + 'px, 0)'
      const innerStyle: CSSProperties = {
        position: 'absolute',
        top: '0',
        left: '0',
        willChange: 'transform',
        transform,
      }
      const nodeChildren = items.value.map((it) => {
        const style: CSSProperties = { position: 'absolute', boxSizing: 'border-box' }
        if (isH) {
          style.left = it.pos + 'px'
          style.top = '0'
          style.width = props.itemSize + 'px'
          style.height = '100%'
        } else {
          style.top = it.pos + 'px'
          style.left = '0'
          style.height = props.itemSize + 'px'
          style.width = '100%'
        }
        return h(
          'div',
          {
            key: it.key,
            class: ['vsl-item', props.itemClass],
            style,
            onClick: ($event: MouseEvent) =>
              emit('item-click', {
                item: it.data,
                index: it.dataIndex,
                event: $event,
              }),
          },
          slots.default
            ? slots.default({
                item: it.data,
                index: it.dataIndex,
                key: it.key,
              })
            : String(it.data == null ? '' : it.data)
        )
      })

      const rootStyle: CSSProperties = {
        position: 'relative',
        overflow: 'hidden',
        width: toSize(props.width),
        height: toSize(props.height),
      }

      return h(
        'div',
        {
          ref: root,
          class: ['vsl-root', props.rootClass],
          style: rootStyle,
          onMouseenter: onEnter,
          onMouseleave: onLeave,
          onWheel: onWheel,
        },
        [h('div', { class: 'vsl-inner', style: innerStyle }, nodeChildren)]
      )
    }
  },
})

export default VirtualScrollLoop
