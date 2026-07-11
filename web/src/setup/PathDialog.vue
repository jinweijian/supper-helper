<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { apiJson } from '../shared/api';

const props = defineProps<{ open: boolean; initialPath: string; returnFocus?: HTMLElement | null }>();
const emit = defineEmits<{ close: []; select: [path: string] }>();
const path = ref('');
const entries = ref<Array<{ name: string; path: string }>>([]);
const error = ref('');
const closeButton = ref<HTMLButtonElement>();

watch(() => props.open, async (open, wasOpen) => {
  if (open) {
    path.value = props.initialPath;
    await browse(path.value);
    await nextTick();
    closeButton.value?.focus();
  } else if (wasOpen) props.returnFocus?.focus();
});

async function browse(target: string): Promise<void> {
  error.value = '';
  try {
    const query = target ? `?path=${encodeURIComponent(target)}` : '';
    const body = await apiJson<{ path: string; entries?: Array<{ name: string; path: string; type?: string }>; directories?: Array<{ name: string; path: string }> }>(fetch, `/api/fs/dirs${query}`);
    path.value = body.path;
    entries.value = (body.entries ?? body.directories ?? []).filter((entry) => !('type' in entry) || entry.type === 'directory');
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '目录读取失败'; }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @keydown.esc.prevent="emit('close')">
      <section class="path-dialog" role="dialog" aria-modal="true" aria-labelledby="path-title">
        <header><h2 id="path-title">选择目录</h2><button ref="closeButton" type="button" @click="emit('close')">关闭</button></header>
        <p class="path-value">{{ path || '/' }}</p>
        <p v-if="error" class="error-banner">{{ error }}</p>
        <div class="directory-list">
          <button v-for="entry in entries" :key="entry.path" type="button" @click="browse(entry.path)">{{ entry.name }}</button>
        </div>
        <footer><button type="button" @click="emit('close')">取消</button><button class="primary" type="button" @click="emit('select', path)">选定此目录</button></footer>
      </section>
    </div>
  </Teleport>
</template>
