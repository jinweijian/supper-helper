import { ref, type Ref } from 'vue';

export type ThemeName = 'light' | 'dark';

const STORAGE_KEY = 'super-helper-theme';
const theme: Ref<ThemeName> = ref(readCurrent());
let initialized = false;

function readStored(): ThemeName | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : undefined;
  } catch {
    return undefined;
  }
}

function systemMedia(): MediaQueryList | undefined {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : undefined;
}

function readSystem(): ThemeName {
  return systemMedia()?.matches ? 'light' : 'dark';
}

function readCurrent(): ThemeName {
  return readStored() ?? readSystem();
}

function apply(value: ThemeName): void {
  theme.value = value;
  document.documentElement.dataset.theme = value;
}

/**
 * 模块级单例主题管理。
 * 优先级：localStorage 手动选择 > 系统偏好（含运行时跟随，仅未手动选择时）。
 */
export function useTheme() {
  if (!initialized) {
    initialized = true;
    apply(readCurrent());
    systemMedia()?.addEventListener('change', (event) => {
      if (!readStored()) apply(event.matches ? 'light' : 'dark');
    });
  }

  function toggle(): void {
    const next: ThemeName = theme.value === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage unavailable */ }
    apply(next);
  }

  return { theme, toggle };
}
