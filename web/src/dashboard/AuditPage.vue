<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SessionDto } from '../shared/contracts';
import { safeRunView } from './dashboard-view-model';

const props = defineProps<{ session: SessionDto; health?: Record<string, unknown>; loading: boolean; error: string }>();
const emit = defineEmits<{ back: []; openLogs: [event: MouseEvent]; check: []; bind: []; reindex: [] }>();
const tab = ref<'progress' | 'evidence' | 'health'>('progress');
const safeRun = computed(() => safeRunView(props.session));
const statusLabels: Record<string, string> = { queued: '排队中', ready_for_diagnosis: '等待诊断', diagnosing: '诊断中', collecting_input: '新建', need_input: '待补充', partial: '证据不足', concluded: '已有结论' };
const statusLabel = computed(() => statusLabels[props.session.status] || props.session.status);
const stagePercent = computed(() => ({ collecting_input: 8, queued: 18, ready_for_diagnosis: 24, diagnosing: 60, need_input: 80, partial: 80, concluded: 100 }[props.session.status] ?? 8));
const steps = ['理解问题', '知识路由', '检索证据', '证据判断', '生成答复'];
</script>

<template>
  <div class="audit-page">
    <header class="audit-header">
      <button type="button" class="audit-back" @click="emit('back')">← 返回对话</button>
      <h1>诊断详情</h1>
      <div class="audit-header-actions">
        <button type="button" @click="emit('openLogs', $event)">日志</button>
      </div>
    </header>
    <div class="audit-body">
      <div class="tab-row audit-tabs" role="tablist">
        <button v-for="item in ['progress', 'evidence', 'health'] as const" :key="item" type="button" role="tab" :aria-selected="tab === item" :class="{ active: tab === item }" @click="tab = item">
          {{ { progress: '进度', evidence: '证据', health: '知识健康' }[item] }}
        </button>
      </div>

      <section v-if="tab === 'progress'" class="audit-card">
        <h2>当前状态</h2>
        <p><span class="status-pill" :data-status="session.status">{{ statusLabel }}</span></p>
        <div class="case-step-rail"><span v-for="(step, index) in steps" :key="step" :class="{ done: stagePercent >= (index + 1) * 20, current: stagePercent < (index + 1) * 20 && stagePercent >= index * 20 }">{{ step }}</span></div>
        <div v-if="session.contextUsage" class="context-meter"><span class="progress-track"><span :style="{ width: `${Math.min(100, session.contextUsage.percent || 0)}%` }" /></span><small>上下文：约 {{ session.contextUsage.estimatedTokens || 0 }} / {{ session.contextUsage.limitTokens || 0 }} tokens（{{ session.contextUsage.percent || 0 }}%）</small></div>
        <template v-if="session.agentActivity?.length">
          <h2>Agent 活动</h2>
          <ul class="audit-activity">
            <li v-for="(activity, index) in session.agentActivity" :key="index">
              <strong>{{ activity.agentName || activity.agentId || 'agent' }}</strong>
              <span>{{ activity.label || activity.phase }}</span>
              <p>{{ activity.summary }}</p>
            </li>
          </ul>
        </template>
      </section>

      <section v-else-if="tab === 'evidence'" class="audit-card">
        <h2>最近运行证据</h2>
        <div v-if="safeRun.claims.length" class="evidence-list"><article v-for="claim in safeRun.claims" :key="claim.id"><strong>{{ claim.type }}</strong><p>{{ claim.text }}</p></article></div>
        <div v-if="safeRun.evidence.length" class="evidence-list"><details v-for="item in safeRun.evidence" :key="item.id"><summary>{{ item.summary }}</summary><p>{{ item.source }} · {{ item.confidence }}</p></details></div>
        <p v-for="item in safeRun.missingInfo" :key="item" class="muted">仍需确认：{{ item }}</p>
        <p v-if="!safeRun.claims.length && !safeRun.evidence.length && !safeRun.missingInfo.length" class="muted">暂无可展示的证据。</p>
      </section>

      <section v-else class="audit-card">
        <h2>知识库状态</h2>
        <p v-if="error" class="error-banner">{{ error }}</p>
        <div v-if="health || session.knowledgeHealth" class="health-grid">
          <article v-for="(value, key) in (health || session.knowledgeHealth)" :key="key"><span>{{ key }}</span><strong>{{ typeof value === 'object' ? (value as any)?.status || '已加载' : value }}</strong></article>
        </div>
        <p v-else class="muted">正在等待当前服务的本地知识健康状态。</p>
        <div class="stack-actions">
          <button type="button" :disabled="loading" @click="emit('check')">测试检索</button>
          <button type="button" :disabled="loading" @click="emit('bind')">绑定知识库</button>
          <button type="button" :disabled="loading" @click="emit('reindex')">重建索引</button>
        </div>
      </section>
    </div>
  </div>
</template>
