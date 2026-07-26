<template>
  <div class="nav">
    <slot name="selector" />
    <button
      type="button"
      class="btn ghost"
      :disabled="!canExplorer"
      v-tip="explorerTip"
      @click="$emit('explorer')"
    >
      资源管理器
    </button>
    <span class="spacer" />
    <span class="root muted" v-tip="pathTitle">{{ pathLabel }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  canExplorer: boolean;
  explorerTip: string;
  pathLabel: string;
  pathTitle: string;
}>();

defineEmits<{
  explorer: [];
}>();
</script>

<style scoped>
.nav {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--zone-rail-h, 40px);
  padding: 0 8px 0 10px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
  user-select: none;
  min-width: 0;
}

.btn {
  border: 1px solid var(--line);
  background: var(--color-accent-soft);
  color: var(--text);
  border-radius: 4px;
  padding: 3px 10px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}

.btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.btn:not(:disabled):hover {
  border-color: var(--cyan);
}

.btn.ghost {
  background: transparent;
}

.spacer {
  flex: 1;
  min-width: 8px;
}

.root {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  max-width: 28vw;
}

.muted {
  color: var(--muted);
}
</style>
