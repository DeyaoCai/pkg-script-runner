<template>
  <!-- 10. Design 仓库选择：与 3 同壳，列表来自当前工作区 -->
  <ZoneProjectNav
    :can-explorer="!!ctrl.data.designRoot"
    explorer-tip="在文件浏览器中打开设计仓库"
    :path-label="pathLabel"
    :path-title="pathTitle"
    @explorer="ctrl.showDesignInExplorer()"
  >
    <template #selector>
      <RepoRouter :ctrl="repos" />
    </template>
  </ZoneProjectNav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CodeEditorShellCtrl } from '../../CodeEditorShell/CodeEditorShellCtrl.ts';
import type { RepoRouterCtrl } from '../RepoRouter/RepoRouterCtrl.ts';
import RepoRouter from '../RepoRouter/RepoRouter.vue';
import ZoneProjectNav from './ZoneProjectNav.vue';

const props = defineProps<{
  ctrl: CodeEditorShellCtrl;
  repos: RepoRouterCtrl;
}>();

const pathLabel = computed(() => {
  const d = props.ctrl.data;
  if (!d.workspaceRoot) return '未选择工作区';
  if (!d.designRoot) return '请选择仓库';
  if (d.designRoot.toLowerCase() === d.workspaceRoot.toLowerCase()) {
    return '工作区根';
  }
  const name = d.designRoot.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return name || d.designRoot;
});

const pathTitle = computed(() => {
  const d = props.ctrl.data;
  return [
    d.workspaceRoot && `工作区: ${d.workspaceRoot}`,
    d.designRoot ? `设计仓库: ${d.designRoot}` : '设计仓库: （未选择）',
  ]
    .filter(Boolean)
    .join('\n');
});
</script>
