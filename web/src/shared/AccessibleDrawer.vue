<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  title: string;
  returnFocus?: HTMLElement | null;
}>();
const emit = defineEmits<{ close: [] }>();
const closeButton = ref<HTMLButtonElement>();

watch(() => props.open, async (open, wasOpen) => {
  if (open) {
    await nextTick();
    closeButton.value?.focus();
  } else if (wasOpen) {
    props.returnFocus?.focus();
  }
}, { immediate: true });

function onKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === 'Escape') {
    event.preventDefault();
    emit('close');
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="drawer-backdrop">
      <section class="drawer-panel" role="dialog" aria-modal="true" :aria-label="title">
        <header class="drawer-header">
          <h2>{{ title }}</h2>
          <button ref="closeButton" type="button" data-close-drawer @click="$emit('close')">关闭</button>
        </header>
        <slot />
      </section>
    </div>
  </Teleport>
</template>
