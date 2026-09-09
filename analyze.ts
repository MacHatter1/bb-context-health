import type { Breakdown, Entry } from './contract.ts';

export const MAX_ENTRIES = 1500;
export const PREVIEW_LIMIT = 1200;
// ponytail: character heuristic; use provider token attribution when it becomes available.
export const estimateTokens = (text: string) => Math.ceil(Array.from(text).length / 4);
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
function content(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(part => {
    const p = record(part);
    return text(p.text) || (p.type === 'image' || p.type === 'input_image' ? '[Image: token size unavailable]' : '');
  }).join('\n');
}

// Require both a skill-file reference and returned skill frontmatter; mentions alone are not load evidence.
export function loadedSkillEvidence(call: string, output: string) {
  const strings = (value: unknown): string => typeof value === 'string' ? value : value && typeof value === 'object' ? Object.values(value).map(strings).join('\n') : '';
  try { call = strings(JSON.parse(call)); } catch { /* Raw command text. */ }
  try { output = strings(JSON.parse(output)); } catch { /* Raw tool output. */ }
  const paths = [...call.matchAll(/(?:^|[\s"'`])([^\s"'`]*SKILL\.md)(?=$|[\s"'`])/g)].map(m => m[1]);
  const name = output.match(/(?:^|\n)---\r?\nname:\s*["']?([^\r\n"']+)["']?\r?\n/);
  if (paths.length !== 1 || !name || !/\ndescription:/.test(output)) return undefined;
  return { name: name[1].trim(), filePath: paths[0] };
}

export function createAnalyzer() {
  let entries: Entry[] = [], base: Entry[] = [], state: Entry[] = [];
  let compacted = false, malformed = 0, omitted = 0, id = 0;
  const calls = new Map<string, { name: string; input: string }>();
  const add = (target: Entry[], category: string, title: string, body: string) => {
    if (!body) return;
    target.push({ id: String(++id), category, title, characters: Array.from(body).length,
      tokens: estimateTokens(body), preview: body.slice(0, PREVIEW_LIMIT) });
  };
  function skills(target: Entry[], body: string) {
    // Partition catalogue lines, preserving all remaining instructions without double counting.
    let rest = '';
    for (const line of body.split(/(?<=\n)/)) {
      const match = line.match(/^- ([^\n]+?): (.*\(file: .*\).*)/);
      if (match) add(target, 'Skills catalogue', match[1], line);
      else rest += line;
    }
    add(target, 'Instructions', 'Skill catalogue guidance', rest);
  }
  function message(p: Record<string, unknown>) {
    const kind = text(p.type);
    if (kind === 'message') {
      const body = content(p.content), role = text(p.role);
      if (body.includes('### Available skills')) skills(entries, body);
      else add(entries, role === 'developer' || role === 'system' ? 'Instructions' : role === 'assistant' ? 'Assistant messages' : 'User messages', `${role || 'Unknown'} message`, body);
    } else if (kind === 'function_call' || kind === 'custom_tool_call') {
      const name = text(p.name) || 'Tool call';
      calls.set(text(p.call_id), { name, input: text(p.arguments) || text(p.input) });
      add(entries, 'Tool calls', name, text(p.arguments) || text(p.input));
    } else if (kind === 'function_call_output' || kind === 'custom_tool_call_output') {
      const call = calls.get(text(p.call_id));
      const body = content(p.output) || JSON.stringify(p.output ?? '');
      add(entries, 'Tool results', `${call?.name || 'Tool'} result`, body);
      const evidence = loadedSkillEvidence(call?.input ?? '', body);
      if (evidence && entries.length) entries[entries.length - 1].loadedSkill = evidence;
    } else if (kind === 'reasoning') {
      add(entries, 'Reasoning summaries', 'Visible reasoning summary', content(p.summary) || content(p.content));
    }
  }
  return {
    push(line: string) {
      let r: Record<string, unknown>;
      try { r = record(JSON.parse(line)); } catch { malformed++; return; }
      const p = record(r.payload);
      if (r.type === 'session_meta') {
        base = [];
        add(base, 'Instructions', 'Base instructions', text(record(p.base_instructions).text));
        if (Array.isArray(p.dynamic_tools)) for (const tool of p.dynamic_tools) {
          add(base, 'Tool definitions', text(record(tool).name) || 'Tool definition', JSON.stringify(tool));
        }
      } else if (r.type === 'world_state') {
        const s = record(p.state);
        if (p.full === true) state = [];
        if ('host_skills' in s) {
          state = state.filter(e => e.category !== 'Skills catalogue' && e.title !== 'Skill catalogue guidance');
          skills(state, text(record(s.host_skills).body));
        }
      } else if (r.type === 'compacted') {
        compacted = true; entries = []; omitted = 0; calls.clear();
        if (Array.isArray(p.replacement_history)) p.replacement_history.forEach(v => message(record(v)));
        else add(entries, 'Compaction summary', 'Retained summary', text(p.message));
      } else if (r.type === 'response_item') message(p);
      if (entries.length > MAX_ENTRIES) { omitted += entries.length - MAX_ENTRIES; entries = entries.slice(-MAX_ENTRIES); }
    },
    finish(): Breakdown {
      // world_state mirrors the injected catalogue on newer Codex versions.
      const hasRecordedCatalogue = entries.some(e => e.category === 'Skills catalogue');
      const all = [...base, ...(hasRecordedCatalogue ? [] : state), ...entries];
      return { entries: all.sort((a, b) => b.tokens - a.tokens).slice(0, MAX_ENTRIES), source: null, compacted,
        notices: [
          'Breakdown estimates recorded text at 4 characters per token. It is not an exact reconstruction of the model context and will not sum to the usage meter.',
          'Skills catalogue entries are descriptions, not loaded skill bodies. Read skill files appear within tool results. Hidden prompts, encrypted reasoning, images and provider truncation are not fully measurable.',
          ...(compacted ? ['A compaction was recorded. Conversation entries use the latest recorded replacement history or summary.'] : []),
          ...(malformed ? [`${malformed} incomplete or malformed log records were skipped.`] : []),
          ...(omitted || all.length > MAX_ENTRIES ? ['Large session: the breakdown is limited to 1,500 entries and may omit older content.'] : []),
        ] };
    },
  };
}
