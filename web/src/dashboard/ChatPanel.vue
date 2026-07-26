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
const stagePercent = computed(() => ({ collecting_input: 8, queued: 18, ready_for_diagnosis: 24, diagnosing: 60, need_input: 80, partial: 80, concluded: 100 }[props.session?.status ?? 'collecting_input'] ?? 8));

watch(() => props.session?.messages.length, async () => {
  await nextTick();
  chat.value?.lastElementChild?.scrollIntoView({ block: 'end' });
});

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
  <main class="chat-column">
    <header class="case-header">
      <div>
        <h1>{{ session?.title || '新对话' }}</h1>
        <p>{{ session ? `${session.workspaceId || 'current'} · ${statusLabels[session.status] || session.status}` : '选择一个会话，或新建诊断' }}</p>
        <div v-if="session" class="case-step-rail"><span v-for="(step, index) in ['理解问题', '知识路由', '检索证据', '证据判断', '生成答复']" :key="step" :class="{ done: stagePercent >= (index + 1) * 20, current: stagePercent < (index + 1) * 20 && stagePercent >= index * 20 }">{{ step }}</span></div>
        <div v-if="session?.contextUsage" class="context-meter"><span class="progress-track"><span :style="{ width: `${Math.min(100, session.contextUsage.percent || 0)}%` }" /></span><small>上下文：约 {{ session.contextUsage.estimatedTokens || 0 }} / {{ session.contextUsage.limitTokens || 0 }} tokens（{{ session.contextUsage.percent || 0 }}%）</small></div>
      </div>
      <slot name="actions" />
    </header>
    <section ref="chat" class="chat" aria-live="polite">
      <div v-if="!session?.messages.length" class="empty-state">
        <h2>描述你遇到的问题</h2>
        <p>helper agent 会先审核上下文，再决定追问或执行只读排查。</p>
      </div>
      <article v-for="item in session?.messages || []" :key="item.id" class="message" :class="item.role">
        <span>{{ item.role === 'user' ? '你' : 'helper' }}</span>
        <pre v-if="item.role === 'user'">{{ item.body }}</pre>
        <RichAnswer v-else :text="item.body" />
      </article>
      <ChatProgressCard v-if="progress && ['running', 'interrupted', 'reconnecting'].includes(progress.state)" :progress="progress" @retry="emit('retry')" />
    </section>
    <form class="composer" @submit.prevent="submit">
      <label class="sr-only" for="chat-input">输入问题</label>
      <p v-if="blockedReason" class="warning-banner">{{ blockedReason }}</p>
      <p v-if="inlineError" class="error-banner" role="alert">{{ inlineError }}</p>
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
