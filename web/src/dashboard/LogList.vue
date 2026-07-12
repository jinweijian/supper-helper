<script setup lang="ts">
import { ref } from 'vue';
import LogCard from './LogCard.vue';
import type { LogBlock } from './use-logs';
const props = defineProps<{ blocks: LogBlock[]; loading: boolean }>();
const expanded = ref(new Set(props.blocks.slice(0, 3).map((item, index) => item.id || `index-${index}`)));
function idOf(block: LogBlock, index: number): string { return block.id || `index-${index}`; }
function setOpen(id: string, open: boolean): void {
  const next = new Set(expanded.value);
  if (open) next.add(id); else next.delete(id);
  expanded.value = next;
}
function expandAll(): void { expanded.value = new Set(props.blocks.map(idOf)); }
function collapseAll(): void { expanded.value = new Set(); }
</script>

<template>
  <div class="log-list-wrap">
    <div class="log-controls"><span>{{ blocks.length }} 条日志</span><button data-testid="expand-all-logs" type="button" :disabled="loading || !blocks.length" @click="expandAll">全部展开</button><button data-testid="collapse-all-logs" type="button" :disabled="loading || !blocks.length" @click="collapseAll">全部收起</button></div>
    <p v-if="!blocks.length" class="muted">还没有诊断日志。</p>
    <div v-else class="log-list"><LogCard v-for="(block, index) in blocks" :key="idOf(block, index)" :block="block" :open="expanded.has(idOf(block, index))" @toggle="setOpen(idOf(block, index), $event)" /></div>
  </div>
</template>
