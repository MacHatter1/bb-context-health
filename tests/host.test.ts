import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import entry from '../src/host.ts';
import { hostContract } from '../src/contract.ts';

test('host reads only the matching session, handles missing logs and cancellation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'context-health-test-'));
  const sessionId = '01a08732-c44f-7c70-8824-291c6c849c76';
  const signal = new AbortController().signal;
  // Only the signal is used by this read-only handler.
  const context = { signal } as Parameters<typeof entry.handlers.inspect>[1];
  try {
    const path = join(home, 'sessions', '2026', '09', '09');
    await mkdir(path, { recursive: true });
    await writeFile(join(path, `rollout-2026-09-09T18-24-06-${sessionId}.jsonl`), JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: 'expected session' } }) + '\n');
    await writeFile(join(path, 'rollout-other.jsonl'), 'do not read');
    const result = await entry.handlers.inspect({ sessionId, codexHome: home }, context);
    assert.equal(result.entries[0].preview, 'expected session');
    assert.ok(result.source?.endsWith(`${sessionId}.jsonl`));
    const missing = await entry.handlers.inspect({ sessionId: '01a08732-c44f-7c70-8824-291c6c849c77', codexHome: home }, context);
    assert.equal(missing.source, null);
    assert.equal(missing.entries.length, 0);
    assert.throws(() => hostContract.inspect.input.parse({ sessionId: '../../secret', codexHome: home }));
    await assert.rejects(async () => entry.handlers.inspect({ sessionId, codexHome: 'relative' }, context), /absolute/);
    await assert.rejects(async () => entry.handlers.inspect({ sessionId, codexHome: home }, { ...context, signal: AbortSignal.abort() }));
  } finally { await rm(home, { recursive: true, force: true }); }
});
