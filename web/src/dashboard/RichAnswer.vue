<script setup lang="ts">
import { computed } from 'vue';

type Inline = { kind: 'text' | 'strong' | 'code'; text: string };
type Block = { kind: 'paragraph' | 'heading' | 'code'; inline?: Inline[]; text?: string } | { kind: 'list'; items: string[] };
const props = defineProps<{ text: string }>();
const blocks = computed(() => parseBlocks(props.text));

function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const result: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) { index += 1; continue; }
    if (line.startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith('```')) code.push(lines[index++]!);
      index += 1;
      result.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*] /.test(lines[index]!)) items.push(lines[index++]!.replace(/^[-*] /, ''));
      result.push({ kind: 'list', items });
      continue;
    }
    if (/^#{1,3} /.test(line)) result.push({ kind: 'heading', inline: parseInline(line.replace(/^#{1,3} /, '')) });
    else result.push({ kind: 'paragraph', inline: parseInline(line) });
    index += 1;
  }
  return result;
}

function parseInline(text: string): Inline[] {
  const tokens: Inline[] = [];
  const matcher = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;
  for (const match of text.matchAll(matcher)) {
    if (match.index! > cursor) tokens.push({ kind: 'text', text: text.slice(cursor, match.index) });
    const value = match[0];
    tokens.push(value.startsWith('**') ? { kind: 'strong', text: value.slice(2, -2) } : { kind: 'code', text: value.slice(1, -1) });
    cursor = match.index! + value.length;
  }
  if (cursor < text.length) tokens.push({ kind: 'text', text: text.slice(cursor) });
  return tokens.length ? tokens : [{ kind: 'text', text }];
}
</script>

<template>
  <div class="rich-answer">
    <template v-for="(block, index) in blocks" :key="index">
      <ul v-if="block.kind === 'list'">
        <li v-for="item in block.items" :key="item">
          <template v-for="(token, tokenIndex) in parseInline(item)" :key="tokenIndex"><strong v-if="token.kind === 'strong'">{{ token.text }}</strong><code v-else-if="token.kind === 'code'">{{ token.text }}</code><template v-else>{{ token.text }}</template></template>
        </li>
      </ul>
      <pre v-else-if="block.kind === 'code'"><code>{{ block.text }}</code></pre>
      <component :is="block.kind === 'heading' ? 'h3' : 'p'" v-else>
        <template v-for="(token, tokenIndex) in block.inline" :key="tokenIndex"><strong v-if="token.kind === 'strong'">{{ token.text }}</strong><code v-else-if="token.kind === 'code'">{{ token.text }}</code><template v-else>{{ token.text }}</template></template>
      </component>
    </template>
  </div>
</template>
