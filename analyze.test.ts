import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyzer, estimateTokens, MAX_ENTRIES, loadedSkillEvidence } from './analyze.ts';
const row = (type: string, payload: unknown) => JSON.stringify({ type, payload });
test('partitions skill catalogue without duplicate counts and ignores event mirrors', () => {
  const a = createAnalyzer();
  const body = '### Available skills\n- debug: Find bugs (file: /skills/debug/SKILL.md)\n';
  a.push(row('session_meta', { base_instructions: { text: 'base' }, dynamic_tools: [{ name: 'read', description: 'Read' }] }));
  a.push(row('world_state', { full: true, state: { host_skills: { body } } }));
  a.push(row('event_msg', { type: 'agent_message', message: 'must not count' }));
  a.push(row('response_item', { type: 'function_call_output', output: 'hello' }));
  const result = a.finish();
  assert.equal(result.entries.filter(e => e.category === 'Skills catalogue').length, 1);
  assert.equal(result.entries.filter(e => ['Skills catalogue', 'Instructions'].includes(e.category)).reduce((n,e) => n + e.characters, 0), body.length + 4);
  assert.equal(result.entries.find(e => e.category === 'Tool results')?.characters, 5);
  assert.ok(!JSON.stringify(result).includes('must not count'));
});
test('compaction replaces history and full world state replaces stale skills', () => {
  const a = createAnalyzer();
  a.push(row('world_state', { full: true, state: { host_skills: { body: '- old: Old (file: old)' } } }));
  a.push(row('response_item', { type: 'message', role: 'user', content: 'discard' }));
  a.push(row('compacted', { replacement_history: [{ type: 'message', role: 'user', content: 'retained' }] }));
  a.push(row('world_state', { full: true, state: {} }));
  assert.deepEqual(a.finish().entries.map(e => e.preview), ['retained']);
  assert.equal(a.finish().compacted, true);
});
test('world-state catalogue mirrors are counted only once beside recorded instructions', () => {
  const a = createAnalyzer();
  const body = '### Available skills\n- debug: Find bugs (file: /debug/SKILL.md)\n';
  a.push(row('response_item', { type: 'message', role: 'developer', content: body }));
  a.push(row('world_state', { full: true, state: { host_skills: { body } } }));
  assert.equal(a.finish().entries.filter(e => e.category === 'Skills catalogue').length, 1);
  assert.equal(a.finish().entries.reduce((n, e) => n + e.characters, 0), body.length);
});
test('malformed logs, large histories and Unicode are bounded', () => {
  const a = createAnalyzer(); a.push('{');
  for (let i = 0; i < MAX_ENTRIES + 1; i++) a.push(row('response_item', { type: 'message', role: 'user', content: 'x'.repeat(2000) }));
  const r = a.finish();
  assert.equal(r.entries.length, MAX_ENTRIES);
  assert.equal(r.entries[0].preview.length, 1200);
  assert.ok(r.notices.some(n => n.includes('malformed')));
  assert.ok(r.notices.some(n => n.includes('1,500')));
  assert.equal(estimateTokens('😀😀😀😀'), 1);
});

test('loaded skills require returned frontmatter and an unambiguous skill read, and reset at compaction', () => {
  const body = '---\nname: debugging\ndescription: Find bugs\n---\nRead the failing path first.';
  assert.deepEqual(loadedSkillEvidence('cat /skills/debugging/SKILL.md', body), {name:'debugging',filePath:'/skills/debugging/SKILL.md'});
  assert.equal(loadedSkillEvidence('cat /skills/debugging/SKILL.md', 'file not found'), undefined);
  assert.equal(loadedSkillEvidence('echo hello', body), undefined);
  assert.equal(loadedSkillEvidence('cat /a/SKILL.md /b/SKILL.md', body), undefined);
  const a = createAnalyzer();
  a.push(row('response_item', {type:'function_call',name:'exec_command',call_id:'read',arguments:JSON.stringify({cmd:'cat /skills/debugging/SKILL.md'})}));
  a.push(row('response_item', {type:'function_call_output',call_id:'read',output:JSON.stringify({output:body})}));
  assert.equal(a.finish().entries.filter(e => e.loadedSkill).length, 1);
  a.push(row('compacted', {message:'Summary'}));
  assert.equal(a.finish().entries.filter(e => e.loadedSkill).length, 0);
});
