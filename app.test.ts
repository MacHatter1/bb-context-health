import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

test('panel filters, sorts and pages entries, and renders skill inventory', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'MutationObserver'] as const;
  const previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  const temporary = await mkdtemp(fileURLToPath(new URL('./.app-test-', import.meta.url)));
  try {
    const { fireEvent } = await import('@testing-library/react');
    const { loadPluginApp, renderSlot } = await import('@get-bb/plugin-sdk/testing/app');
    const source = (await readFile(new URL('./app.tsx', import.meta.url), 'utf8')).replace("import './app.css';", '');
    await writeFile(`${temporary}/app.mjs`, ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
    const app = await loadPluginApp(() => import(pathToFileURL(`${temporary}/app.mjs`).href));
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
  } finally {
    for (const [index,key] of keys.entries()) {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(globalThis,key,descriptor); else Reflect.deleteProperty(globalThis,key);
    }
    dom.window.close();
    await rm(temporary, {recursive:true,force:true});
  }
});
