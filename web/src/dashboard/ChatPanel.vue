<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { SessionDto } from '../shared/contracts';
import RichAnswer from './RichAnswer.vue';
import ChatProgressCard from './ChatProgressCard.vue';
import type { ChatProgressState } from './chat-progress';

const props = defineProps<{ session?: SessionDto; sending: boolean; progress?: ChatProgressState; error?: string; selectedPersona?: string }>();
const emit = defineEmits<{ send: [message: string, persona: string]; updatePersona: [persona: string]; retry: [] }>();
const message = ref('');
const persona = computed({ get: () => props.selectedPersona || props.session?.userPersona || 'operations', set: (value: string) => emit('updatePersona', value) });
const chat = ref<HTMLElement>();
const blockedReason = computed(() => props.session?.archivedAt ? '这个会话已归档，只能阅读，不能继续追问。' : props.session?.contextUsage?.available === false ? '上下文窗口已满，请新建诊断后继续。' : '');
const inlineError = computed(() => props.progress?.state === 'interrupted' ? '' : props.error || '');
const statusLabels: Record<string, string> = { queued: '排队中', ready_for_diagnosis: '等待诊断', diagnosing: '诊断中', collecting_input: '新建', need_input: '待补充', partial: '证据不足', concluded: '已有结论' };
const isEmpty = computed(() => !props.session?.messages.length);

watch(() => props.session?.messages.length, async () => {
  await nextTick();
  chat.value?.lastElementChild?.scrollIntoView({ block: 'end' });
});

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return '几秒前';
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function submit(): void {
  const body = message.value.trim();
  if (!body || props.sending || blockedReason.value) return;
  emit('send', body, persona.value);
  message.value = '';
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <main class="chat-column" :class="{ 'is-empty': isEmpty }">
    <header class="case-header">
      <div>
        <h1>{{ session?.title || '新对话' }}</h1>
        <p>{{ session ? `${session.workspaceId || 'current'} · ${statusLabels[session.status] || session.status}` : '选择一个会话，或新建诊断' }}</p>
      </div>
      <div class="case-header-actions"><slot name="actions" /></div>
    </header>
    <section ref="chat" class="chat" aria-live="polite">
      <div v-if="isEmpty" class="empty-state">
        <h2><span class="empty-logo" aria-hidden="true">H</span>描述你遇到的问题</h2>
        <p>helper agent 会先审核上下文，再决定追问或执行只读排查。</p>
      </div>
      <article v-for="item in session?.messages || []" :key="item.id" class="message" :class="item.role">
        <header><strong>{{ item.role === 'user' ? '你' : 'helper' }}</strong><time v-if="item.createdAt">{{ relativeTime(item.createdAt) }}</time></header>
        <pre v-if="item.role === 'user'">{{ item.body }}</pre>
        <RichAnswer v-else :text="item.body" />
      </article>
      <ChatProgressCard v-if="progress && ['running', 'interrupted', 'reconnecting'].includes(progress.state)" :progress="progress" @retry="emit('retry')" />
    </section>
    <form class="composer" @submit.prevent="submit">
      <label class="sr-only" for="chat-input">输入问题</label>
      <p v-if="inlineError" class="error-banner" role="alert">{{ inlineError }}</p>
      <p v-if="blockedReason" class="warning-banner">{{ blockedReason }}</p>
      <textarea id="chat-input" v-model="message" :disabled="sending || !!blockedReason" :placeholder="blockedReason || '描述故障、回答追问，或输入：不清楚'" @keydown="onKeydown" />
      <div class="composer-actions">
        <label>用户视角
          <select v-model="persona">
            <option value="operations">运营人员</option>
            <option value="support">技术支持</option>
            <option value="customer">客户</option>
            <option value="developer">开发人员</option>
          </select>
        </label>
        <button class="primary" type="submit" :disabled="sending || !!blockedReason || !message.trim()">发送</button>
      </div>
    </form>
  </main>
</template>
