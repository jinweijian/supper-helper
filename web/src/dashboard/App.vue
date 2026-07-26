<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AccessibleDrawer from '../shared/AccessibleDrawer.vue';
import ChatPanel from './ChatPanel.vue';
import InsightPanel from './InsightPanel.vue';
import SessionSidebar from './SessionSidebar.vue';
import SettingsForm from './SettingsForm.vue';
import LogList from './LogList.vue';
import { pendingUserMessageId, useChat } from './use-chat';
import { useKnowledge } from './use-knowledge';
import { useLogs } from './use-logs';
import { useSessions } from './use-sessions';
import { useSettings } from './use-settings';

const sessions = useSessions();
const chat = useChat();
const logs = useLogs();
const knowledge = useKnowledge();
const settings = useSettings();
const logsOpen = ref(false);
const settingsOpen = ref(false);
const logsOpener = ref<HTMLElement>();
const settingsOpener = ref<HTMLElement>();
const selectedPersona = ref('operations');
const bannerError = computed(() => sessions.error.value);
let disposed = false;

onMounted(async () => {
  window.addEventListener('popstate', onPopState);
  await sessions.initialize();
  if (disposed) return;
  const current = sessions.current.value;
  if (current?.userPersona) selectedPersona.value = current.userPersona;
  if (current) knowledge.loadLocalHealth(current.workspaceId || 'current').catch(() => undefined);
  const pending = current ? pendingUserMessageId(current) : undefined;
  if (current && pending) {
    chat.poll(current.id, pending, (session) => {
      if (!disposed && sessions.current.value?.id === session.id) sessions.current.value = session;
    }).then((settled) => {
      if (disposed) return;
      sessions.current.value = settled;
      return sessions.list();
    }).catch(() => undefined);
  }
});
onBeforeUnmount(() => {
  disposed = true;
  chat.cancel();
  window.removeEventListener('popstate', onPopState);
});

async function onPopState(): Promise<void> {
  if (disposed) return;
  chat.cancel();
  await sessions.initialize();
}

async function send(message: string, persona: string): Promise<void> {
  try {
    const current = sessions.current.value;
    const next = await chat.send({
      caseId: current?.id,
      workspaceId: current?.workspaceId || 'current',
      message,
      persona,
    }, (session) => { if (!sessions.current.value || sessions.current.value.id === session.id) sessions.current.value = session; });
    sessions.current.value = next;
    await sessions.list();
    if (!current) history.replaceState({}, '', `/sessions/${encodeURIComponent(next.id)}`);
  } catch { /* reactive inline feedback owns user feedback */ }
}

async function onRetry(): Promise<void> {
  const current = sessions.current.value;
  const retryable = chat.progress.value.session?.retryableTurn;
  if (!current || !retryable) return;
  try {
    const settled = await chat.retry(current.id, retryable.userMessageId, (session) => {
      if (!sessions.current.value || sessions.current.value.id === session.id) sessions.current.value = session;
    });
    sessions.current.value = settled;
    await sessions.list();
  } catch { /* reactive inline feedback owns user feedback */ }
}

async function openLogs(event: MouseEvent): Promise<void> {
  if (!sessions.current.value) return;
  logsOpener.value = event.currentTarget as HTMLElement;
  logsOpen.value = true;
  try { await logs.open(sessions.current.value.id); } catch { /* visible in drawer */ }
}

async function openSettings(event: MouseEvent): Promise<void> {
  settingsOpener.value = event.currentTarget as HTMLElement;
  settingsOpen.value = true;
  try { await settings.load(); } catch { /* visible in drawer */ }
}

function withCurrentKnowledge(action: 'check' | 'bind' | 'reindex'): void {
  const current = sessions.current.value;
  if (!current) return;
  const query = [...current.messages].reverse().find((item) => item.role === 'user')?.body || current.title;
  if (action === 'check') knowledge.probe(current.workspaceId || 'current', query).catch(() => undefined);
  else knowledge[action](current.workspaceId || 'current', query).catch(() => undefined);
}

async function openSession(id: string): Promise<void> {
  chat.cancel();
  await sessions.open(id);
  const current = sessions.current.value;
  if (current) await knowledge.loadLocalHealth(current.workspaceId || 'current').catch(() => undefined);
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="super helper 首页"><span class="brand-mark">H</span>super helper</a>
      <span class="lan-notice">可信内网模式 · 暂无鉴权</span>
      <button type="button" @click="openSettings">配置</button>
    </header>
    <p v-if="bannerError" class="global-error" role="alert">{{ bannerError }}</p>
    <div class="workspace-grid">
      <SessionSidebar
        :sessions="sessions.sessions.value"
        :active-id="sessions.current.value?.id"
        @open="openSession"
        @create="sessions.create(selectedPersona)"
        @action="sessions.action"
        @remove="sessions.remove"
      />
      <ChatPanel :session="sessions.current.value" :sending="chat.sending.value" :progress="chat.progress.value" :error="chat.error.value" :selected-persona="selectedPersona" @update-persona="selectedPersona = $event" @send="send" @retry="onRetry">
        <template #actions><button type="button" :disabled="!sessions.current.value" @click="openLogs">日志</button></template>
      </ChatPanel>
      <InsightPanel
        :session="sessions.current.value"
        :health="knowledge.health.value"
        :loading="knowledge.loading.value"
        :error="knowledge.error.value"
        @check="withCurrentKnowledge('check')"
        @bind="withCurrentKnowledge('bind')"
        @reindex="withCurrentKnowledge('reindex')"
      />
    </div>
    <AccessibleDrawer :open="logsOpen" title="诊断日志" :return-focus="logsOpener" @close="logsOpen = false">
      <p v-if="logs.error.value" class="error-banner">{{ logs.error.value }}</p>
      <button type="button" :disabled="logs.loading.value" @click="logs.refresh">刷新</button>
      <LogList :blocks="logs.blocks.value" :loading="logs.loading.value" />
    </AccessibleDrawer>
    <AccessibleDrawer :open="settingsOpen" title="配置" :return-focus="settingsOpener" @close="settingsOpen = false">
      <p v-if="settings.actions.load.running" role="status">正在加载配置…</p>
      <SettingsForm
        :settings="settings.value.value"
        :actions="settings.actions"
        @save-model="settings.saveModel"
        @save-embedding="settings.saveEmbedding"
        @save-rerank="settings.saveRerank"
        @save-claude="settings.saveClaude"
        @test-model="settings.testModel"
        @test-embedding="settings.testEmbedding"
        @test-rerank="settings.testRerank"
      />
    </AccessibleDrawer>
  </div>
</template>
