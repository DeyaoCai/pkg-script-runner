<template>
  <button
    ref="rootEl"
    type="button"
    class="tb-chip"
    :class="chipClass"
    :disabled="disabled"
    :title="title"
    :aria-label="ariaLabel"
    @click="emit('click', $event)"
  >
    <span v-if="label" class="chip-label">{{ label }}</span>
    <span v-if="showValue" class="chip-value" :class="valueClass">
      <slot name="value">{{ value }}</slot>
    </span>
    <span v-if="caret != null && caret !== ''" class="chip-caret">{{ caret }}</span>
    <slot />
  </button>
</template>

<script lang="ts" setup>
import { computed, ref, useSlots } from 'vue';

const props = withDefaults(
  defineProps<{
    label?: string;
    value?: string | null;
    caret?: string | null;
    disabled?: boolean;
    title?: string;
    ariaLabel?: string;
    chipClass?: string | Record<string, boolean> | Array<string | Record<string, boolean>>;
    valueClass?: string | Record<string, boolean>;
  }>(),
  {
    disabled: false,
  },
);

const emit = defineEmits<{
  click: [ev: MouseEvent];
}>();

const slots = useSlots();
const rootEl = ref<HTMLButtonElement | null>(null);

const showValue = computed(
  () => !!slots.value || (props.value != null && props.value !== ''),
);

defineExpose({
  el: rootEl,
});
</script>
