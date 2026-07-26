<template>
  <!-- 3. Review 仓库选择 -->
  <ZoneProjectNav
    :can-explorer="!!ctrl.data.projectLocked"
    explorer-tip="在文件浏览器中打开当前仓库"
    :path-label="pathLabel"
    :path-title="pathTitle"
    @explorer="ctrl.onShowInExplorer()"
  >
    <template #selector>
      <RepoRouter :ctrl="repos" />
    </template>
  </ZoneProjectNav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ProjectToolbarCtrl } from '../ProjectToolbar/ProjectToolbarCtrl.ts';
import type { RepoRouterCtrl } from '../RepoRouter/RepoRouterCtrl.ts';
import RepoRouter from '../RepoRouter/RepoRouter.vue';
import ZoneProjectNav from './ZoneProjectNav.vue';

const props = defineProps<{
  ctrl: ProjectToolbarCtrl;
  repos: RepoRouterCtrl;
}>();

const pathLabel = computed(() => {
  const d = props.ctrl.data;
  if (!d.workspaceRoot) return '未选择工作区';
  if (!d.projectRoot) return '请选择仓库';
  if (d.projectRoot.toLowerCase() === d.workspaceRoot.toLowerCase()) {
    return '工作区根';
  }
  const name = d.projectRoot.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return name || d.projectRoot;
});

const pathTitle = computed(() => {
  const d = props.ctrl.data;
  return [
    d.workspaceRoot && `工作区: ${d.workspaceRoot}`,
    d.projectRoot ? `仓库: ${d.projectRoot}` : '仓库: （未选择）',
  ]
    .filter(Boolean)
    .join('\n');
});
</script>
