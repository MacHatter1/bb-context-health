import type { BbPluginApi } from '@get-bb/plugin-sdk';
import type { Breakdown, Entry } from './contract.ts';
import { estimateTokens, PREVIEW_LIMIT, MAX_ENTRIES, loadedSkillEvidence } from './analyze.ts';

type Event = Awaited<ReturnType<BbPluginApi['sdk']['threads']['events']['list']>>[number];
export type Skill = Awaited<ReturnType<BbPluginApi['sdk']['skills']['list']>>['skills'][number];
export const relevantSkills = (skills: Skill[], provider: string) => skills.filter(s => s.provider === null || s.provider === provider);
const serialize = (value: unknown) => typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value);

export function analyzeEvents(events: Event[], boundary: number, compacted: boolean): Breakdown {
  const entries: Entry[] = [];
  const accepted = new Set<string>(), mirrored = new Set<string>(), seen = new Set<string>();
  let truncated = false, skipped = 0;
  const current = events.filter(e => e.seq > boundary).sort((a,b) => b.seq - a.seq);
  for (const event of current) {
    if (event.type === 'turn/input/accepted') accepted.add(event.data.clientRequestId);
    if (event.type === 'item/completed' && event.data.item.type === 'userMessage' && event.data.item.clientRequestId) mirrored.add(event.data.item.clientRequestId);
  }
  const add = (id: string, category: string, title: string, body: string) => {
    if (!body) return;
    entries.push({ id, category, title: title.slice(0, 160), characters: Array.from(body).length, tokens: estimateTokens(body), preview: body.slice(0, PREVIEW_LIMIT) });
  };
  for (const event of current) {
    if (event.type === 'client/turn/requested') {
      if (accepted.has(event.data.requestId) && !mirrored.has(event.data.requestId)) {
        add(event.id, 'User messages', 'Accepted user message', event.data.input.filter(p => p.type === 'text').map(p => p.text).join('\n'));
      }
      continue;
    }
    if (event.type !== 'item/completed') continue;
    const item = event.data.item;
    if ('parentToolCallId' in item && item.parentToolCallId) continue;
    const id = `${event.scope.kind === 'turn' ? event.scope.turnId : 'thread'}:${item.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if ('truncation' in item && item.truncation) truncated = true;
    const title = 'presentation' in item ? item.presentation?.title : undefined;
    switch (item.type) {
      case 'userMessage': add(id, 'User messages', 'User message', item.content.filter(p => p.type === 'text').map(p => p.text).join('\n')); break;
      case 'agentMessage': add(id, 'Assistant messages', title || 'Assistant message', item.text); break;
      case 'commandExecution':
        add(`${id}:call`, 'Tool calls', item.command, item.command);
        add(`${id}:result`, 'Tool results', item.command, item.aggregatedOutput ?? '');
        if (item.aggregatedOutput) {
          const evidence = loadedSkillEvidence(item.command, item.aggregatedOutput);
          if (evidence) entries[entries.length - 1].loadedSkill = evidence;
        }
        break;
      case 'toolCall':
        add(`${id}:call`, 'Tool calls', title || item.tool, serialize(item.arguments));
        add(`${id}:result`, 'Tool results', title || `${item.tool} result`, serialize(item.result) || item.error || '');
        if (item.result && !item.error) {
          const evidence = loadedSkillEvidence(serialize(item.arguments), serialize(item.result));
          if (evidence) entries[entries.length - 1].loadedSkill = evidence;
        }
        break;
      case 'webSearch':
        add(`${id}:call`, 'Tool calls', 'Web search', item.queries.join('\n'));
        add(`${id}:result`, 'Tool results', 'Search results', item.resultText ?? ''); break;
      case 'webFetch':
        add(`${id}:call`, 'Tool calls', item.url, [item.url, item.prompt, item.pattern].filter(Boolean).join('\n'));
        add(`${id}:result`, 'Tool results', item.url, item.resultText ?? ''); break;
      case 'reasoning': add(id, 'Visible reasoning', 'Recorded reasoning', (item.content.length ? item.content : item.summary).join('\n')); break;
      case 'plan': add(id, 'Plans', 'Plan', item.text); break;
      case 'fileChange': add(id, 'File changes', 'Recorded diff', item.changes.map(c => c.diff ?? '').join('\n')); break;
      default: skipped++;
    }
  }
  return {
    entries: entries.sort((a,b) => b.tokens - a.tokens).slice(0, MAX_ENTRIES), source: 'BB normalized thread events', compacted,
    notices: [
      'All providers use the same BB event data and estimate: four Unicode characters per token. Recorded activity is not a reconstruction of retained model context and does not sum to the usage meter.',
      'Only completed, top-level items and accepted user text are counted. Hidden prompts, native tool definitions, attachment contents and provider-side truncation are not fully exposed by this SDK.',
      'Available skills are a current inventory, not proof of injection or loading. Their sizes are excluded from the recorded-content totals.',
      ...(boundary ? [`Showing activity after context boundary ${boundary}. Earlier content is excluded; retained compaction summaries may be unavailable.`] : []),
      ...(truncated ? ['Some tool results were truncated by BB; estimates cover only the retained text.'] : []),
      ...(skipped ? [`${skipped} items had no supported text payload and were excluded from estimates.`] : []),
      ...(entries.length > MAX_ENTRIES ? ['Only the 1,500 largest entries are shown.'] : []),
    ],
  };
}

// BB rejects thread event list requests with a limit above 100 (bb >= 0.43).
const EVENT_PAGE_SIZE = 100;
const MAX_EVENT_PAGES = 10;

export async function readSharedContext(sdk: BbPluginApi['sdk'], threadId: string, maxSeq: number, clearBoundary: number | null): Promise<Breakdown> {
  const boundaries = await sdk.threads.events.list({ threadId, types: ['thread/compacted', 'thread/context/cleared'], order: 'desc', beforeSeq: String(maxSeq + 1), limit: '1' });
  const boundary = Math.max(clearBoundary ?? 0, boundaries[0]?.seq ?? 0);
  const events: Event[] = [];
  let before = maxSeq + 1, limited = false;
  // ponytail: inspect at most 1,000 relevant events per refresh; add user pagination for longer histories.
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const rows = await sdk.threads.events.list({ threadId, beforeSeq: String(before), afterSeq: String(boundary), order: 'desc', limit: String(EVENT_PAGE_SIZE), types: ['item/completed', 'client/turn/requested', 'turn/input/accepted'] });
    events.push(...rows);
    if (rows.length < EVENT_PAGE_SIZE) break;
    const next = Math.min(...rows.map(r => r.seq));
    if (next >= before) throw new Error('Thread event pagination did not advance.');
    before = next;
    limited = page === MAX_EVENT_PAGES - 1;
  }
  const result = analyzeEvents(events, boundary, boundaries[0]?.type === 'thread/compacted');
  if (limited) result.notices.push('Inspection limited to the latest 1,000 relevant events. Older items, including some user-request records, may be omitted.');
  return result;
}
