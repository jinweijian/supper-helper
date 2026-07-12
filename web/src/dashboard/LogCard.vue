<script setup lang="ts">
import { computed } from 'vue';
import type { LogBlock } from './use-logs';
const props = defineProps<{ block: LogBlock; open: boolean }>();
const emit = defineEmits<{ toggle: [open: boolean] }>();
const detail = computed(() => props.block.detail === undefined ? props.block.body ?? '' : JSON.stringify(props.block.detail, null, 2));
function changed(event: Event): void { emit('toggle', (event.currentTarget as HTMLDetailsElement).open); }
</script>

<template>
  <details class="log-card" :class="block.severity || 'info'" :open="open" :data-log-id="block.id" @toggle="changed">
    <summary>
      <span class="log-title"><strong>{{ block.label || '执行过程' }} · {{ block.title || '诊断日志' }}</strong><small>{{ block.createdAt || '时间未记录' }} · {{ block.agentName || block.actor || 'system' }} · {{ block.phase || 'unknown' }}</small></span>
      <span class="log-severity">{{ block.severity || 'info' }}</span>
    </summary>
    <div v-if="block.tags?.length" class="log-tags"><span v-for="tag in block.tags" :key="tag">{{ tag }}</span></div>
    <pre v-if="block.command" class="log-command">{{ block.command }}</pre>
    <pre v-if="detail" class="log-detail">{{ detail }}</pre>
  </details>
</template>
