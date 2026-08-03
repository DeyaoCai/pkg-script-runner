<template>
  <button
    type="button"
    class="btn titlebar-tool"
    :class="{ accent: accent, primary: primary }"
    :disabled="disabled"
    :title="title"
    :aria-label="ariaLabel"
    @click="emit('click', $event)"
  >
    <slot />
  </button>
</template>

<script lang="ts" setup>
withDefaults(
  defineProps<{
    disabled?: boolean;
    title?: string;
    ariaLabel?: string;
    accent?: boolean;
    primary?: boolean;
  }>(),
  {
    disabled: false,
    accent: false,
    primary: false,
  },
);

const emit = defineEmits<{
  click: [ev: MouseEvent];
}>();
</script>
