import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { analyzeEvents, readSharedContext, relevantSkills } from '../src/shared.ts';
type Event = Awaited<ReturnType<BbPluginApi['sdk']['threads']['events']['list']>>[number];
type Item = Extract<Event, { type: 'item/completed' }>['data']['item'];
function completed(seq: number, item: Item, turnId = 'turn-1'): Event {
  return { id: `e${seq}`, seq, threadId: 'thr_test', scope: { kind: 'turn', turnId }, createdAt: seq, type: 'item/completed', data: { item, providerThreadId: 'session' } };
}
test('common normalized items work identically for Codex, Claude, Pi and ACP session IDs', () => {
  for (const providerThreadId of ['codex-session', 'claude-session', 'pi-session', 'acp-session']) {
    const items = [completed(1, { id: 'a', type: 'agentMessage', text: 'hello' }), completed(2, { id: 't', type: 'toolCall', tool: 'read', arguments: { path: 'file' }, result: 'body', status: 'completed' })];
    const result = analyzeEvents(items.map(e => ({ ...e, data: { ...e.data, providerThreadId } })) as Event[], 0, false);
    assert.deepEqual(result.entries.map(e => e.category).sort(), ['Assistant messages', 'Tool calls', 'Tool results']);
    assert.equal(result.entries.find(e => e.category === 'Tool results')?.characters, 4);
  }
});
test('deduplicates item completion, scopes IDs to turns, excludes child output and old epochs', () => {
  const result = analyzeEvents([
    completed(1, { id: 'old', type: 'agentMessage', text: 'old' }),
    completed(3, { id: 'same', type: 'agentMessage', text: 'stale' }),
    completed(4, { id: 'same', type: 'agentMessage', text: 'latest' }),
    completed(5, { id: 'same', type: 'agentMessage', text: 'next' }, 'turn-2'),
    completed(6, { id: 'child', type: 'agentMessage', text: 'child', parentToolCallId: 'parent' }),
  ], 2, true);
  assert.deepEqual(result.entries.map(e => e.preview).sort(), ['latest', 'next']);
  assert.ok(result.notices.some(n => n.includes('boundary 2')));
});
test('skill inventory filters other providers without pretending skills are loaded', () => {
  const base = { id: 's', name: 'Skill', description: null, filePath: '/skill', manageable: false, pluginId: null, registrySkillId: null, scope: 'provider-user' as const };
  assert.deepEqual(relevantSkills([{ ...base, provider: null }, { ...base, id: 'c', provider: 'codex' }, { ...base, id: 'p', provider: 'pi' }], 'pi').map(s => s.id), ['s', 'p']);
});
test('bounded pagination pins its sequence and respects latest compaction', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const sdk = { threads: { events: { async list(input: Record<string, unknown>) {
    calls.push(input);
    if (calls.length === 1) return [{ id: 'b', seq: 10, threadId: 'thr_test', createdAt: 0, scope: {kind: 'thread'}, type: 'thread/compacted', data: { providerThreadId: 'session' } }];
    return [completed(11, {id: 'new', type: 'agentMessage', text: 'after'})];
  } } } } as unknown as BbPluginApi['sdk'];
  const result = await readSharedContext(sdk, 'thr_test', 20, 5);
  assert.equal(calls[1].afterSeq, '10');
  assert.equal(calls[1].beforeSeq, '21');
  assert.equal(result.compacted, true);
  assert.equal(result.entries[0].preview, 'after');
});
test('event pages stay within the BB list limit and still cover 1,000 events', async () => {
  const calls: Array<Record<string, unknown>> = [];
  let seq = 5000;
  const sdk = { threads: { events: { async list(input: Record<string, unknown>) {
    calls.push(input);
    if (calls.length === 1) return [];
    return Array.from({ length: Number(input.limit) }, () => { seq--; return completed(seq, {id: `m${seq}`, type: 'agentMessage', text: 'x'}); });
  } } } } as unknown as BbPluginApi['sdk'];
  const result = await readSharedContext(sdk, 'thr_test', 5000, null);
  for (const call of calls) assert.ok(Number(call.limit) <= 100, `limit ${call.limit} exceeds 100`);
  assert.equal(5000 - seq, 1000);
  assert.ok(result.notices.some(n => n.includes('latest 1,000 relevant events')));
});

test('only accepted requests count, and provider user-message mirrors are not counted twice', () => {
  const request = (id: string, seq: number): Event => ({ id: `r${seq}`, seq, threadId: 'thr_test', createdAt: seq, scope: {kind: 'thread'}, type: 'client/turn/requested', data: { direction: 'outbound', requestId: id, source: 'tell', initiator: 'user', senderThreadId: null, systemMessageKind: 'unlabeled', systemMessageSubject: null, input: [{type:'text',text:'accepted',mentions:[]}], target: {kind:'thread-start'}, request: {method:'thread/start',params:{}}, execution: {model:'test',serviceTier:'default',reasoningLevel:'medium',permissionMode:'auto',source:'client/turn/requested'} } });
  const accepted: Event = {id:'accept',seq:3,threadId:'thr_test',createdAt:3,scope:{kind:'turn',turnId:'turn-1'},type:'turn/input/accepted',data:{providerThreadId:'session',clientRequestId:'yes'}};
  const rows = [request('no',1),request('yes',2),accepted];
  assert.equal(analyzeEvents(rows,0,false).entries.length,1);
  rows.push(completed(4,{id:'user',type:'userMessage',clientRequestId:'yes',content:[{type:'text',text:'accepted'}]}));
  assert.equal(analyzeEvents(rows,0,false).entries.length,1);
});
test('normalized skill read evidence works across providers and excludes failed reads and old boundaries', () => {
  const body = '---\nname: review\ndescription: Review code\n---\nInspect the change.';
  const event = completed(2, {id:'read',type:'toolCall',tool:'read',arguments:{path:'/skills/review/SKILL.md'},result:body,status:'completed'});
  assert.equal(analyzeEvents([event], 0, false).entries.filter(e => e.loadedSkill).length, 1);
  assert.equal(analyzeEvents([event], 2, true).entries.filter(e => e.loadedSkill).length, 0);
  const failed = completed(3, {id:'failed',type:'toolCall',tool:'read',arguments:{path:'/skills/review/SKILL.md'},result:body,error:'Read failed',status:'failed'});
  assert.equal(analyzeEvents([failed], 0, false).entries.filter(e => e.loadedSkill).length, 0);
});

test('ordinary tool and command results omit absent skill evidence for JSON RPC', () => {
  const result = analyzeEvents([
    completed(1, {id:'tool',type:'toolCall',tool:'read',arguments:{path:'README.md'},result:'Project documentation',status:'completed'}),
    completed(2, {id:'command',type:'commandExecution',command:'pwd',cwd:'/workspace',approvalStatus:null,aggregatedOutput:'/workspace',status:'completed',exitCode:0}),
  ], 0, false);
  assert.equal(result.entries.length, 4);
  for (const entry of result.entries) assert.equal(Object.hasOwn(entry, 'loadedSkill'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('normalized reads preserve paths with spaces and recognise reordered frontmatter', () => {
  const filePath = '/workspace/My Project/.agents/skills/review/SKILL.md';
  const body = '---\ndescription: Review code\nname: review\n---\nBody';
  const result = analyzeEvents([
    completed(1, { id: 'tool', type: 'toolCall', tool: 'read', arguments: { path: filePath }, result: body, status: 'completed' }),
    completed(2, { id: 'command', type: 'commandExecution', command: `cat "${filePath}"`, cwd: '/workspace', approvalStatus: null, aggregatedOutput: body, status: 'completed', exitCode: 0 }),
  ], 0, false);
  assert.deepEqual(result.entries.filter(e => e.loadedSkill).map(e => e.loadedSkill), [
    { name: 'review', filePath }, { name: 'review', filePath },
  ]);
});
