<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SessionSummaryDto } from '../shared/contracts';
import { useTheme } from './use-theme';

const props = defineProps<{ sessions: SessionSummaryDto[]; activeId?: string }>();
const emit = defineEmits<{
  open: [id: string];
  create: [];
  action: [id: string, action: 'pin' | 'unpin' | 'archive'];
  remove: [id: string];
}>();
const { theme, toggle: toggleTheme } = useTheme();
const query = ref('');
const filter = ref<'all' | 'active' | 'concluded' | 'need_input'>('all');
const activeStatuses = ['queued', 'ready_for_diagnosis', 'diagnosing'];
const statusLabels: Record<string, string> = { queued: '排队中', ready_for_diagnosis: '等待诊断', diagnosing: '诊断中', collecting_input: '新建', need_input: '待补充', partial: '证据不足', concluded: '已有结论' };
const visible = computed(() => props.sessions.filter((session) => {
  const text = `${session.title} ${session.lastMessage ?? ''}`.toLowerCase();
  const stateMatches = filter.value === 'all'
    || (filter.value === 'active' && activeStatuses.includes(session.status))
    || session.status === filter.value;
  return stateMatches && text.includes(query.value.toLowerCase());
}));
</script>

<template>
  <aside class="sessions-sidebar" aria-label="历史会话">
    <div class="sidebar-brand">
      <a class="brand" href="/" aria-label="super helper 首页"><span class="brand-mark">H</span>super helper</a>
      <span class="brand-badge">内网模式</span>
    </div>
    <div class="sidebar-heading">
      <h2>历史会话</h2>
      <button class="primary" type="button" @click="emit('create')">新建诊断</button>
    </div>
    <label class="sr-only" for="session-search">搜索会话</label>
    <div class="sidebar-search">
      <input id="session-search" v-model="query" placeholder="搜索 case 或结论" />
    </div>
    <div class="filter-row" aria-label="会话筛选">
      <button v-for="item in ['all', 'active', 'concluded', 'need_input'] as const" :key="item" type="button" :data-filter="item" :class="{ active: filter === item }" @click="filter = item">
        {{ { all: '全部', active: '处理中', concluded: '已有结论', need_input: '待补充' }[item] }}
      </button>
    </div>
    <div class="session-list">
      <p v-if="!visible.length" class="muted">暂无匹配会话</p>
      <article v-for="session in visible" :key="session.id" class="session-item" :class="{ active: session.id === activeId }">
        <button class="session-open" type="button" @click="emit('open', session.id)">
          <strong>{{ session.title }}</strong>
          <span>{{ statusLabels[session.status] || session.status }} · {{ session.lastMessage || '暂无消息' }}</span>
        </button>
        <details class="session-actions">
          <summary aria-label="更多选项">•••</summary>
          <button type="button" @click="emit('action', session.id, session.pinnedAt ? 'unpin' : 'pin')">{{ session.pinnedAt ? '取消置顶' : '置顶' }}</button>
          <button type="button" @click="emit('action', session.id, 'archive')">归档</button>
          <button type="button" class="danger-text" @click="emit('remove', session.id)">删除</button>
        </details>
      </article>
    </div>
    <div class="sidebar-footer">
      <button type="button" class="theme-switch" role="switch" :aria-checked="theme === 'dark'" :aria-label="theme === 'dark' ? '深色模式已开启，点击切换到浅色' : '浅色模式已开启，点击切换到深色'" @click="toggleTheme">
        <span class="theme-switch-icon" aria-hidden="true">{{ theme === 'dark' ? '☾' : '☀' }}</span>
        <span class="theme-switch-label">深色模式</span>
        <span class="theme-switch-track" aria-hidden="true"><span class="theme-switch-thumb" /></span>
      </button>
    </div>
  </aside>
</template>
