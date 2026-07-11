<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SessionSummaryDto } from '../shared/contracts';

const props = defineProps<{ sessions: SessionSummaryDto[]; activeId?: string }>();
const emit = defineEmits<{
  open: [id: string];
  create: [];
  action: [id: string, action: 'pin' | 'unpin' | 'archive'];
  remove: [id: string];
}>();
const query = ref('');
const filter = ref<'all' | 'active' | 'concluded' | 'need_input'>('all');
const visible = computed(() => props.sessions.filter((session) => {
  const text = `${session.title} ${session.lastMessage ?? ''}`.toLowerCase();
  const stateMatches = filter.value === 'all'
    || (filter.value === 'active' && ['collecting_input', 'diagnosing'].includes(session.status))
    || session.status === filter.value;
  return stateMatches && text.includes(query.value.toLowerCase());
}));
</script>

<template>
  <aside class="sessions-sidebar" aria-label="历史会话">
    <div class="sidebar-heading">
      <h2>历史会话</h2>
      <button class="primary" type="button" @click="emit('create')">新建诊断</button>
    </div>
    <label class="sr-only" for="session-search">搜索会话</label>
    <input id="session-search" v-model="query" placeholder="搜索 case 或结论" />
    <div class="filter-row" aria-label="会话筛选">
      <button v-for="item in ['all', 'active', 'concluded', 'need_input'] as const" :key="item" type="button" :class="{ active: filter === item }" @click="filter = item">
        {{ { all: '全部', active: '处理中', concluded: '已有结论', need_input: '待补充' }[item] }}
      </button>
    </div>
    <div class="session-list">
      <p v-if="!visible.length" class="muted">暂无匹配会话</p>
      <article v-for="session in visible" :key="session.id" class="session-item" :class="{ active: session.id === activeId }">
        <button class="session-open" type="button" @click="emit('open', session.id)">
          <strong>{{ session.title }}</strong>
          <span>{{ session.status }} · {{ session.lastMessage || '暂无消息' }}</span>
        </button>
        <details class="session-actions">
          <summary aria-label="更多选项">•••</summary>
          <button type="button" @click="emit('action', session.id, session.pinnedAt ? 'unpin' : 'pin')">{{ session.pinnedAt ? '取消置顶' : '置顶' }}</button>
          <button type="button" @click="emit('action', session.id, 'archive')">归档</button>
          <button type="button" class="danger-text" @click="emit('remove', session.id)">删除</button>
        </details>
      </article>
    </div>
  </aside>
</template>
