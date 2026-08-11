import type { App } from 'vue-demi'
import { VirtualScrollLoop } from './VirtualScrollLoop'

export interface InstallOptions {
  /** 自定义全局注册名，默认 'VirtualScrollLoop' */
  name?: string
}

/**
 * Vue 插件安装方法。
 * @param app  Vue3 的 app / Vue2.7 的 app（均含 component 方法）
 * @param options  { name?: string } 自定义全局注册名
 */
export function install(app: App, options: InstallOptions = {}): void {
  const name = options.name || 'VirtualScrollLoop'
  app.component(name, VirtualScrollLoop)
}

export * from './VirtualScrollLoop'
export { VirtualScrollLoop }

export default {
  install,
  VirtualScrollLoop,
}
