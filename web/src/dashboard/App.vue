<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import AccessibleDrawer from '../shared/AccessibleDrawer.vue';
import ChatPanel from './ChatPanel.vue';
import InsightPanel from './InsightPanel.vue';
import SessionSidebar from './SessionSidebar.vue';
import SettingsForm from './SettingsForm.vue';
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

onMounted(async () => {
  await sessions.initialize();
  const current = sessions.current.value;
  const pending = current ? pendingUserMessageId(current) : undefined;
  if (current && pending) {
    chat.poll(current.id, pending).then((settled) => {
      sessions.current.value = settled;
      return sessions.list();
    }).catch(() => undefined);
  }
  window.addEventListener('popstate', onPopState);
});
onBeforeUnmount(() => window.removeEventListener('popstate', onPopState));

async function onPopState(): Promise<void> {
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
    });
    sessions.current.value = next;
    await sessions.list();
    if (!current) history.replaceState({}, '', `/sessions/${encodeURIComponent(next.id)}`);
  } catch { /* reactive error banner owns user feedback */ }
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
  knowledge[action](current.workspaceId || 'current', current.title).catch(() => undefined);
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="super helper 首页"><span class="brand-mark">H</span>super helper</a>
      <span class="lan-notice">可信内网模式 · 暂无鉴权</span>
      <button type="button" @click="openSettings">配置</button>
    </header>
    <p v-if="sessions.error || chat.error.value" class="global-error" role="alert">{{ sessions.error || chat.error.value }}</p>
    <div class="workspace-grid">
      <SessionSidebar
        :sessions="sessions.sessions.value"
        :active-id="sessions.current.value?.id"
        @open="sessions.open"
        @create="sessions.create"
        @action="sessions.action"
        @remove="sessions.remove"
      />
      <ChatPanel :session="sessions.current.value" :sending="chat.sending.value" @send="send">
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
      <div class="log-list">
        <article v-for="(block, index) in logs.blocks.value" :key="index">
          <h3>{{ block.title || `日志 ${index + 1}` }}</h3>
          <pre>{{ block.command || block.body || JSON.stringify(block, null, 2) }}</pre>
        </article>
      </div>
    </AccessibleDrawer>
    <AccessibleDrawer :open="settingsOpen" title="配置" :return-focus="settingsOpener" @close="settingsOpen = false">
      <p v-if="settings.loading.value" role="status">正在加载配置…</p>
      <SettingsForm
        v-else
        :settings="settings.value.value"
        :status="settings.status.value"
        :error="settings.error.value"
        :loading="settings.loading.value"
        @save-model="settings.saveModel"
        @test-model="settings.testModel"
        @test-embedding="settings.testEmbedding"
        @test-rerank="settings.testRerank"
      />
    </AccessibleDrawer>
  </div>
</template>
