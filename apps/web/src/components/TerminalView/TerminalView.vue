<template>
  <div ref="hostRef" class="xterm-host" />
</template>

<script lang="ts" setup>
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { APP_CTRL_KEY } from '../../appContext';
import { TerminalViewCtrl } from './TerminalViewCtrl';

const props = defineProps<{
  sessionId: string;
  active: boolean;
}>();

const app = inject(APP_CTRL_KEY)!;
const ctrl = new TerminalViewCtrl(app);
const hostRef = ref<HTMLElement | null>(null);

ctrl.setProps({ sessionId: props.sessionId, active: props.active });

onMounted(() => {
  if (hostRef.value) ctrl.mount(hostRef.value);
});

watch(
  () => props.sessionId,
  (sessionId) => ctrl.setProps({ sessionId, active: props.active }),
);

watch(
  () => props.active,
  (active) => ctrl.onActiveChange(active),
);

watch(
  () => app.data.theme,
  () => ctrl.onThemeChange(),
);

onBeforeUnmount(() => ctrl.unmount());
</script>

<style lang="less" scoped>
.xterm-host {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
