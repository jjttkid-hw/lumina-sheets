import React, { useEffect, useRef, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createApp, defineComponent, h, ref, onMounted, onBeforeUnmount } from 'vue';
import { createSpreadsheet } from 'lumina-report-sdk';
import 'lumina-report-sdk/style.css';

const framework = new URLSearchParams(location.search).get('framework');
const state = (window.acceptance = {
  framework,
  development: import.meta.env.DEV,
  created: 0,
  destroyed: 0,
  changes: [],
  errors: [],
  active: null,
  staleNotifications: 0,
});
function workbook(id) {
  return {
    id,
    name: id,
    description: '',
    activeSheetId: 'sheet',
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
    sheets: [
      {
        id: 'sheet',
        name: 'Sheet',
        rowCount: 50,
        colCount: 10,
        cells: { A1: { value: id }, A2: { value: 'initial' } },
      },
    ],
  };
}
function mount(host, initialWorkbook, notify) {
  let disposed = false;
  const grid = createSpreadsheet(host, {
    workbook: initialWorkbook,
    onChange: (event) => {
      if (disposed) state.staleNotifications++;
      notify(event);
    },
    onError: (error) => state.errors.push(String(error)),
    onDataStateChange: () => {
      if (disposed) state.staleNotifications++;
    },
  });
  state.created++;
  state.active = grid;
  return () => {
    disposed = true;
    grid.destroy();
    grid.destroy(); // Idempotence must also hold in a real renderer.
    state.destroyed++;
    if (state.active === grid) state.active = null;
  };
}
const props = (id, revision) => ({
  documentId: id,
  initialWorkbook: workbook(id),
  onChange: () => state.changes.push(revision),
});
if (framework === 'react') {
  function Sheet(p) {
    const host = useRef(null),
      latest = useRef(p);
    latest.current = p;
    useEffect(
      () =>
        mount(host.current, latest.current.initialWorkbook, (event) =>
          latest.current.onChange(event),
        ),
      [p.documentId],
    );
    return React.createElement('div', {
      ref: host,
      id: 'sheet-host',
      style: { height: 480, width: 900 },
    });
  }
  const root = createRoot(document.getElementById('app'));
  state.render = (id, revision = 0) =>
    root.render(
      React.createElement(
        StrictMode,
        null,
        id === null ? null : React.createElement(Sheet, props(id, revision)),
      ),
    );
  state.dispose = () => root.unmount();
} else if (framework === 'vue') {
  const Sheet = defineComponent({
    props: ['initialWorkbook'],
    emits: ['change'],
    setup(p, { emit }) {
      const host = ref(null);
      let cleanup;
      onMounted(() => {
        cleanup = mount(host.value, p.initialWorkbook, (event) => emit('change', event));
      });
      onBeforeUnmount(() => cleanup?.());
      return () =>
        h('div', { ref: host, id: 'sheet-host', style: { height: '480px', width: '900px' } });
    },
  });
  const current = ref(null);
  const app = createApp({
    setup: () => () =>
      current.value === null
        ? null
        : h(Sheet, {
            key: current.value.documentId,
            ...current.value,
          }),
  });
  app.mount('#app');
  state.render = (id, revision = 0) => {
    current.value = id === null ? null : props(id, revision);
  };
  state.dispose = () => app.unmount();
} else throw new Error('Unknown framework');
state.duplicate = () => {
  try {
    createSpreadsheet(document.getElementById('sheet-host'));
    return 'allowed';
  } catch (error) {
    return error.code;
  }
};
state.beginPending = (kind) => {
  state.pendingKind = kind;
  state.pendingStarted = false;
  state.pendingResult = null;
  const outcome = (promise) =>
    promise.then(
      () => {
        state.pendingResult = 'resolved';
      },
      (error) => {
        state.pendingResult = typeof error.code === 'string' ? error.code : error.name;
      },
    );
  if (kind === 'import') {
    const file = new File(['late'], 'late.csv');
    file.arrayBuffer = () =>
      new Promise((resolve) => {
        state.pendingStarted = true;
        state.releasePending = () => resolve(new TextEncoder().encode('late file').buffer);
      });
    outcome(state.active.import(file));
  } else {
    outcome(
      state.active.bindData({
        rowCount: 1,
        columnCount: 1,
        fetchPage: (_offset, _limit, signal) =>
          new Promise((resolve) => {
            state.pendingStarted = true;
            state.sourceSignal = signal;
            state.releasePending = () => resolve({ rows: [['late data']], totalRows: 1 });
          }),
      }),
    );
  }
};
state.render('document-a');
