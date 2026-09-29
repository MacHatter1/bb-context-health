import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BbPluginApi, PluginRpcHandlers } from '@get-bb/plugin-sdk';
import plugin from '../src/server.ts';
import { rpcContract, type Breakdown } from '../src/contract.ts';

type Event = Awaited<ReturnType<BbPluginApi['sdk']['threads']['events']['list']>>[number];
const oldSession = '01a08732-c44f-7c70-8824-291c6c849c76';
const newSession = '01a08732-c44f-7c70-8824-291c6c849c77';
const identity = (seq: number, sessionId: string): Event => ({ id: `e${seq}`, seq, threadId: 'thr_test', createdAt: seq, scope: { kind: 'thread' }, type: 'thread/identity', data: { providerThreadId: sessionId } });

// Drive the registered handler; no storage APIs are used by this plugin.
function inspection(boundary: number | null, events: Event[]) {
  let inspect!: PluginRpcHandlers<typeof rpcContract>['inspect'];
  const requests: Array<Record<string, unknown>> = [];
  const hostCalls: Array<{ sessionId: string; codexHome: string }> = [];
  const usage = { usedTokens: 12, modelContextWindow: 100, estimated: false };
  const detail: Breakdown = { entries: [], source: 'current-session.jsonl', compacted: false, notices: [] };
  const bb = {
    settings: { define: () => ({ get: async () => ({ codexHome: '/custom/codex' }) }) },
    hosts: { experimental_client: () => ({ call: async (_method: string, input: typeof hostCalls[number]) => { hostCalls.push(input); return detail; } }) },
    rpc: { register: (_contract: typeof rpcContract, handlers: PluginRpcHandlers<typeof rpcContract>) => { inspect = handlers.inspect; } },
    sdk: {
      threads: {
        get: async () => ({ providerId: 'codex', projectId: 'proj_test', environmentId: 'env_test' }),
        timeline: async () => ({ maxSeq: 25, contextBoundarySeq: boundary, contextWindowUsage: usage }),
        events: { list: async (input: Record<string, unknown>) => {
          requests.push(input);
          return events.filter(e => e.seq > Number(input.afterSeq ?? 0) && e.seq < Number(input.beforeSeq ?? Infinity)).sort((a, b) => b.seq - a.seq).slice(0, Number(input.limit));
        } },
      },
      environments: { get: async () => ({ hostId: 'host_test' }) },
      skills: { list: async () => ({ skills: [] }) },
    },
  } as unknown as BbPluginApi;
  plugin(bb);
  return {
    hostCalls, requests, usage,
    async read() { return rpcContract.inspect.output.parse(await inspect(rpcContract.inspect.input.parse({ threadId: 'thr_test', source: 'codex' }))); },
  };
}

test('Codex detail excludes identities from before or at the context-clear boundary', async () => {
  for (const seq of [10, 20]) {
    const run = inspection(20, [identity(seq, oldSession)]);
    const report = await run.read();
    assert.equal(run.hostCalls.length, 0);
    assert.equal(report.source, null);
    assert.deepEqual(report.entries, []);
    assert.deepEqual(report.usage, run.usage);
    assert.ok(report.notices.some(n => n.includes('current context')));
  }
});

test('Codex detail selects the current identity within the timeline snapshot', async () => {
  const run = inspection(20, [identity(10, oldSession), identity(21, newSession), identity(30, oldSession)]);
  const report = await run.read();
  assert.deepEqual(run.hostCalls, [{ sessionId: newSession, codexHome: '/custom/codex' }]);
  assert.equal(run.requests[0].afterSeq, '20');
  assert.equal(run.requests[0].beforeSeq, '26');
  assert.equal(report.source, 'current-session.jsonl');
});

test('Codex detail works for sessions that have never been cleared', async () => {
  const run = inspection(null, [identity(10, oldSession)]);
  assert.equal((await run.read()).source, 'current-session.jsonl');
  assert.equal(run.hostCalls[0].sessionId, oldSession);
});
