<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { SessionDto } from '../shared/contracts';
import RichAnswer from './RichAnswer.vue';
import ChatProgressCard from './ChatProgressCard.vue';
import type { ChatProgressState } from './chat-progress';

const props = defineProps<{ session?: SessionDto; sending: boolean; progress?: ChatProgressState }>();
const emit = defineEmits<{ send: [message: string, persona: string] }>();
const message = ref('');
const persona = ref('operations');
const chat = ref<HTMLElement>();

watch(() => props.session?.messages.length, async () => {
  await nextTick();
  chat.value?.lastElementChild?.scrollIntoView({ block: 'end' });
});

function submit(): void {
  const body = message.value.trim();
  if (!body || props.sending) return;
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
        <p>{{ session ? `${session.workspaceId || 'current'} · ${session.status}` : '选择一个会话，或新建诊断' }}</p>
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
      <ChatProgressCard v-if="progress && ['running', 'interrupted'].includes(progress.state)" :progress="progress" />
    </section>
    <form class="composer" @submit.prevent="submit">
      <label class="sr-only" for="chat-input">输入问题</label>
      <textarea id="chat-input" v-model="message" :disabled="sending" placeholder="描述故障、回答追问，或输入：不清楚" @keydown="onKeydown" />
      <div class="composer-actions">
        <label>用户视角
          <select v-model="persona">
            <option value="operations">运营人员</option>
            <option value="support">技术支持</option>
            <option value="customer">客户</option>
            <option value="developer">开发人员</option>
          </select>
        </label>
        <button class="primary" type="submit" :disabled="sending || !message.trim()">发送</button>
      </div>
    </form>
  </main>
</template>
