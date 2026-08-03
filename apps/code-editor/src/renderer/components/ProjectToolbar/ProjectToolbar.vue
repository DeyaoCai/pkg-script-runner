<template>
  <TitleBarShell class="editor-toolbar" :ctrl="ctrl">
    <template #leading>
      <TitleBarChip
        :label="ctrl.data.workspaceRoot ? '工作区' : '选择工作区'"
        :value="ctrl.data.workspaceRoot || null"
        :disabled="ctrl.state.busy"
        value-class="is-rtl"
        v-tip="workspaceTitle"
        @click="ctrl.onPickWorkspace()"
      />
    </template>
  </TitleBarShell>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import TitleBarShell from '@pkg-runner/shell/renderer/TitleBarShell.vue';
import TitleBarChip from '@pkg-runner/shell/renderer/TitleBarChip.vue';
import type { ProjectToolbarCtrl } from './ProjectToolbarCtrl.ts';

const props = defineProps<{
  ctrl: ProjectToolbarCtrl;
}>();

const workspaceTitle = computed(() => {
  const root = props.ctrl.data.workspaceRoot;
  return root ? `${root}\n点击重新选择工作区` : '选择工作区目录';
});
</script>

<style scoped>
.editor-toolbar {
  padding-left: 0;
}
</style>
