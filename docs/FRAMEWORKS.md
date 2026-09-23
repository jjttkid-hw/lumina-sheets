# React / Vue 生命周期接入

SDK 自带渲染运行时。宿主只负责一个有明确高度的空容器；不要同时让框架渲染这个容器的内部内容。一个容器最多一个活动实例；重复创建会抛出 `INVALID_ARGUMENT`。移除容器前调用 `destroy()`；可重复销毁，销毁后可在同一容器创建新实例。

以下为接入示例，不是另行发布的 React/Vue 包。React 生命周期保护已通过控制器测试；实际 React StrictMode DOM 行为与 Vue 浏览器集成仍需验收。

## React

以 `documentId` 作为切换文档边界，避免父组件每次重新构造 options/workbook 对象都覆盖用户编辑。初始工作簿只在新文档挂载时加载；业务服务器的新版本应经显式冲突决策再调用 `load`。

```tsx
import { useEffect, useRef } from 'react';
import { createSpreadsheet, type SpreadsheetOptions, type Workbook } from 'lumina-report-sdk';
import 'lumina-report-sdk/style.css';

type Props = {
  documentId: string;
  initialWorkbook: Workbook;
  onChange?: SpreadsheetOptions['onChange'];
  onError?: SpreadsheetOptions['onError'];
};

export function Sheet({ documentId, initialWorkbook, onChange, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ initialWorkbook, onChange, onError });
  latest.current = { initialWorkbook, onChange, onError };
  useEffect(() => {
    if (!host.current) return;
    const grid = createSpreadsheet(host.current, {
      workbook: latest.current.initialWorkbook,
      onChange: (event) => latest.current.onChange?.(event),
      onError: (error) => latest.current.onError?.(error),
    });
    return () => grid.destroy();
  }, [documentId]);
  return <div ref={host} style={{ height: 560, width: '100%' }} />;
}
```

在 StrictMode 的 setup→cleanup→setup 中，每次 setup 创建独立实例，每次 cleanup 只销毁自己创建的实例。不要在 render 中创建实例，也不要用全局变量保存多个组件共用的实例。服务端渲染框架中将组件声明为客户端组件；服务端不能挂载 Canvas。

## Vue 3

下面组件的 `initialWorkbook` 只在挂载时使用。切换文档时由父级 `<Sheet :key="documentId" ... />` 建立明确的卸载与挂载边界；不要深度 watch 整个工作簿然后自动 load，这会丢失当前编辑与历史。

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { createSpreadsheet, type LuminaSpreadsheet, type Workbook, type CellChange } from 'lumina-report-sdk';
import 'lumina-report-sdk/style.css';

const props = defineProps<{ initialWorkbook: Workbook }>();
const emit = defineEmits<{
  change: [event: { sheetId: string; changes: CellChange[] }];
  error: [error: Error];
}>();
const host = ref<HTMLDivElement | null>(null);
let grid: LuminaSpreadsheet | undefined;
onMounted(() => {
  if (!host.value) return;
  grid = createSpreadsheet(host.value, {
    workbook: props.initialWorkbook,
    onChange: (event) => emit('change', event),
    onError: (error) => emit('error', error),
  });
});
onBeforeUnmount(() => {
  grid?.destroy();
  grid = undefined;
});
</script>
<template><div ref="host" style="height: 560px; width: 100%" /></template>
```

## 保存、替换与取消

`onChange` 是变化通知，不是自动服务器保存。布局、规则等变化可能带空单元格列表，结构操作另有 `onStructureChange`；仅保存 onChange.changes 不能覆盖完整文档生命周期。业务层可以显式生成快照，并采用版本号/冲突检测保存；不要在每次光标移动时调用全量 `toJSON()`。

导入、导出和分页都必须处理 Promise。导航卸载由 destroy 取消待导入与导出；外部 AbortController 可主动取消 import/export。导入取消返回 `IMPORT_CANCELLED`，导出取消返回 `EXPORT_CANCELLED`。组件不能在异步完成后继续使用已销毁实例。

SDK 不提供反应式 options 更新。只读属于构造选项；需要改变时由宿主明确决定保存快照、销毁并重建，避免把重建误作无损历史延续。缩放使用 `setZoom(value)`，无需重建实例且保留编辑历史。支持直接更新的布局、规则、筛选等使用对应方法。实际业务集成应分别验证数据源、保存和取消，而不能把生命周期示例当作云同步实现。
