import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import type { CapturedPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { fireEvent } from '@testing-library/react';
import type { rpcContract } from '../src/contract.ts';
import type { PluginThreadPanelProps } from '@get-bb/plugin-sdk/app';

async function withAppTest(run: (app: CapturedPluginApp, render: typeof renderSlot, fire: typeof fireEvent) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'MutationObserver'] as const;
  const previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  const temporary = await mkdtemp(fileURLToPath(new URL('./.app-test-', import.meta.url)));
  try {
    const { fireEvent } = await import('@testing-library/react');
    const { loadPluginApp, renderSlot } = await import('@get-bb/plugin-sdk/testing/app');
    const source = (await readFile(new URL('../src/app.tsx', import.meta.url), 'utf8')).replace("import './app.css';", '');
    await writeFile(`${temporary}/app.mjs`, ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
    const app = await loadPluginApp(() => import(pathToFileURL(`${temporary}/app.mjs`).href));
    await run(app, renderSlot, fireEvent);
  } finally {
    for (const [index,key] of keys.entries()) {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(globalThis,key,descriptor); else Reflect.deleteProperty(globalThis,key);
    }
    dom.window.close();
    await rm(temporary, {recursive:true,force:true});
  }
}

test('panel filters, sorts and pages entries, and renders skill inventory', async () => {
  await withAppTest(async (app, renderSlot, fireEvent) => {
    const slot = renderSlot(app.threadPanelActions[0]!, { threadId: 'thr_test', params: null }, {
      rpc: { inspect: () => ({ provider: 'codex', updatedAt: Date.now(), usage: null, entries: Array.from({length: 27}, (_, i) => ({id:String(i),category:i % 2 ? 'Messages' : 'Tool results',title:`Entry ${String(i).padStart(2, '0')}`,characters:4 * (i + 1),tokens:i + 1,preview:i === 10 ? 'Unique preview text' : 'Recorded body'})), skills:[{id:'skill',name:'debugging',description:'Find bugs',filePath:'/skills/debugging',scope:'plugin',pluginId:'test'}], notices:[], source:'BB normalized thread events', compacted:false }) },
    });
    try {
      assert.ok(await slot.findByRole('heading', { name: 'Recorded content' }));
      const entries = await slot.findByRole('region', { name: 'Context entries' });
      const rows = () => entries.querySelectorAll('details');
      const firstTitle = () => rows()[0]?.querySelector('strong')?.textContent;
      assert.equal(rows().length, 25);
      assert.equal(firstTitle(), 'Entry 26');
      fireEvent.click(await slot.findByRole('button', { name: /Show 2 more/ }));
      assert.equal(rows().length, 27);
      fireEvent.change(await slot.findByLabelText('Sort context entries'), { target: { value: 'smallest' } });
      assert.equal(rows().length, 25);
      assert.equal(firstTitle(), 'Entry 00');
      fireEvent.change(await slot.findByLabelText('Sort context entries'), { target: { value: 'name' } });
      assert.equal(firstTitle(), 'Entry 00');
      fireEvent.change(await slot.findByLabelText('Search context entries'), { target: { value: 'unique preview' } });
      assert.equal(rows().length, 1);
      assert.equal(firstTitle(), 'Entry 10');
      assert.ok(await slot.findByLabelText('Text preview: Entry 10'));
      fireEvent.change(await slot.findByLabelText('Search context entries'), { target: { value: 'no-such-entry' } });
      assert.ok(await slot.findByText('No matching entries'));
      fireEvent.click(await slot.findByRole('button', { name: 'Reset search' }));
      assert.equal(rows().length, 25);
      fireEvent.click(await slot.findByRole('button', { name: /Messages.*entries/ }));
      assert.equal(rows().length, 13);
      assert.equal(firstTitle(), 'Entry 01');
      fireEvent.click(await slot.findByRole('button', { name: 'Clear filters' }));
      assert.equal(rows().length, 25);
      fireEvent.click(await slot.findByRole('button', { name: /Loaded skills/ }));
      assert.ok(await slot.findByRole('heading', { name: 'Loaded skills' }));
      assert.ok(await slot.findByText(/No skill loads could be verified/));
      fireEvent.click(await slot.findByRole('button', { name: /Available skills/ }));
      assert.ok(await slot.findByRole('heading', {name:'Available skills'}));
      assert.ok(await slot.findByText('debugging'));
      fireEvent.change(await slot.findByLabelText('Search available skills'), { target: { value: 'no-such-skill' } });
      assert.ok(await slot.findByText('No skills match this search.'));
      assert.ok(await slot.findByLabelText('Context data source'));
      assert.ok(await slot.findByText('Unavailable'));
    } finally { slot.lifecycle.unmount(); }
  });
});

const snapshot = (source: string) => ({
  provider: 'codex', updatedAt: Date.now(), usage: null, skills: [], notices: [], source, compacted: false,
  entries: [{ id: source, category: 'User messages', title: `${source} entry`, characters: 4, tokens: 1, preview: 'Body' }],
});

test('a failed source switch keeps the selector available and can recover to shared activity', async () => {
  await withAppTest(async (app, renderSlot, fireEvent) => {
    const sources: Array<string | undefined> = [];
    const slot = renderSlot<PluginThreadPanelProps, typeof rpcContract>(app.threadPanelActions[0]!, { threadId: 'thr_test', params: null }, {
      rpc: { inspect: ({ source }) => {
        sources.push(source);
        if (source === 'codex') throw new Error('Inspection RPC failed');
        return snapshot('Shared');
      } },
    });
    try {
      const picker = await slot.findByLabelText('Context data source');
      fireEvent.change(picker, { target: { value: 'codex' } });
      assert.match((await slot.findByRole('alert')).textContent ?? '', /Inspection RPC failed/);
      assert.equal((slot.getByLabelText('Context data source') as HTMLSelectElement).value, 'codex');
      assert.equal(slot.queryByRole('heading', { name: 'Recorded content' }), null);
      fireEvent.change(slot.getByLabelText('Context data source'), { target: { value: 'shared' } });
      assert.ok(await slot.findByRole('heading', { name: 'Recorded content' }));
      assert.equal(slot.queryByRole('alert'), null);
      assert.deepEqual(sources, ['shared', 'codex', 'shared']);
    } finally { slot.lifecycle.unmount(); }
  });
});

test('source selection works during loading and ignores a late response from the previous source', async () => {
  await withAppTest(async (app, renderSlot, fireEvent) => {
    const { act } = await import('@testing-library/react');
    let release!: (report: ReturnType<typeof snapshot>) => void;
    const detail = new Promise<ReturnType<typeof snapshot>>(resolve => { release = resolve; });
    const slot = renderSlot<PluginThreadPanelProps, typeof rpcContract>(app.threadPanelActions[0]!, { threadId: 'thr_test', params: null }, {
      rpc: { inspect: ({ source }) => source === 'codex' ? detail : snapshot('Shared') },
    });
    try {
      fireEvent.change(await slot.findByLabelText('Context data source'), { target: { value: 'codex' } });
      assert.equal((slot.getByLabelText('Context data source') as HTMLSelectElement).value, 'codex');
      assert.ok(slot.getByText('Reading context…'));
      fireEvent.change(slot.getByLabelText('Context data source'), { target: { value: 'shared' } });
      assert.ok(await slot.findByText('Shared entry', { selector: 'strong' }));
      await act(async () => { release(snapshot('Late detail')); await detail; });
      assert.equal(slot.queryByText('Late detail entry', { selector: 'strong' }), null);
      assert.equal((slot.getByLabelText('Context data source') as HTMLSelectElement).value, 'shared');
    } finally { slot.lifecycle.unmount(); }
  });
});
