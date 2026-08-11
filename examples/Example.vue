<template>
  <div class="demo">
    <h3>纵向 · 向上循环 · 海量数据</h3>
    <VirtualScrollLoop
      :data="bigList"
      direction="up"
      :speed="40"
      :item-size="44"
      :gap="8"
      :buffer="6"
      hover-pause
      style="border: 1px solid #eee; border-radius: 8px"
    >
      <template #default="{ item, index }">
        <div class="row">
          <span class="idx">#{{ index }}</span>
          <span>{{ item.text }}</span>
        </div>
      </template>
    </VirtualScrollLoop>

    <h3>横向 · 向左循环</h3>
    <VirtualScrollLoop
      :data="tags"
      direction="left"
      :speed="60"
      :item-size="120"
      :gap="12"
      :height="60"
      hover-pause
    >
      <template #default="{ item }">
        <div class="tag">{{ item }}</div>
      </template>
    </VirtualScrollLoop>

    <div class="controls">
      <button @click="ref1?.pause()">暂停</button>
      <button @click="ref1?.play()">播放</button>
      <button @click="ref1?.setSpeed(speed)">速度 {{ speed }}</button>
      <button @click="speed = speed + 20">加速 +20</button>
      <button @click="speed = Math.max(10, speed - 20)">减速 -20</button>
      <button @click="ref1?.scrollTo(500)">跳到第 500 项</button>
    </div>
  </div>
</template>

<script>
import { ref } from 'vue'
import { VirtualScrollLoop } from 'vue-virtual-scroll-loop'

export default {
  components: { VirtualScrollLoop },
  setup() {
    const ref1 = ref(null)
    const speed = ref(40)
    // 模拟 10000 条数据
    const bigList = Array.from({ length: 10000 }, (_, i) => ({
      id: i,
      text: '列表项 ' + i,
    }))
    const tags = ['Vue', 'React', 'Svelte', 'Angular', 'Solid', 'Qwik', 'Lit']
    return { ref1, speed, bigList, tags }
  },
}
</script>

<style scoped>
.demo { padding: 16px; }
.row { display: flex; align-items: center; gap: 12px; height: 100%; padding: 0 12px; }
.idx { color: #888; font-variant-numeric: tabular-nums; }
.tag {
  display: flex; align-items: center; justify-content: center; height: 100%;
  background: linear-gradient(135deg, #6a8dff, #9b6bff); color: #fff;
  border-radius: 10px; font-weight: 600;
}
.controls { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
.controls button { padding: 6px 12px; border-radius: 6px; border: 1px solid #ccc; cursor: pointer; }
</style>
