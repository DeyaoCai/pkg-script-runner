<template>
  <div
    class="titlebar-meta"
    :class="{ error: error, 'is-rich': isRich }"
    :title="titleAttr"
  >
    <slot>{{ text }}</slot>
  </div>
</template>

<script lang="ts" setup>
import { computed, useSlots } from 'vue';

const props = withDefaults(
  defineProps<{
    text?: string;
    title?: string;
    error?: boolean;
  }>(),
  {
    text: '',
    error: false,
  },
);

const slots = useSlots();
const isRich = computed(() => !!slots.default);
const titleAttr = computed(() => props.title ?? (props.text || undefined));
</script>
