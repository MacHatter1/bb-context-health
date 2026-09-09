<p align="center">
  <img src="assets/context-health-readme.png" width="64" height="64" alt="Context Health icon" />
</p>

<h1 align="center">Context Health</h1>

<p align="center">See what’s contributing to your BB thread’s context.</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#provider-support">Provider support</a>
</p>

Context Health adds a thread side panel to BB for exploring context usage, recorded messages, tool output and skills. Find large contributions, inspect individual entries and distinguish available skills from observed skill reads.

## Features

- **Context usage meter** — see provider-reported or estimated usage when available.
- **Category breakdown** — compare recorded text contributions with coloured percentage bars.
- **Searchable entries** — filter by category, search text, sort by size or name, and expand previews.
- **Loaded skills** — inspect skill reads observed in recorded tool results.
- **Available skills** — browse the current provider’s skill inventory, descriptions and plugin ownership.
- **Extra Codex detail** — optionally inspect local session logs for instructions, skill catalogues and tool definitions.
- **Automatic refresh** — updates every 30 seconds while visible, with manual refresh available.

## Screenshots

All screenshots use fictional demo data. They show the overview, entry details and skill inventory; the current version also includes a **Loaded skills** tab.

<table>
  <tr>
    <th>Context overview</th>
    <th>Entry drill-down</th>
    <th>Available skills</th>
  </tr>
  <tr>
    <td valign="top"><img src="assets/screenshots/context-health-overview.png" width="280" alt="Context usage meter, category breakdown and searchable entries" /></td>
    <td valign="top"><img src="assets/screenshots/context-health-entry-detail.png" width="280" alt="Expanded entry showing a code preview and estimated token contribution" /></td>
    <td valign="top"><img src="assets/screenshots/context-health-skills.png" width="280" alt="Searchable skill inventory with an expanded skill description" /></td>
  </tr>
</table>

## Installation

### Requirements

- BB **0.42 or later**, with a compatible Plugin SDK runtime (**0.4.48 or later**).
- Node.js **22.18+** and npm to build and test from source.

### Build and install

Clone or download this repository, then open a terminal in the plugin directory containing `package.json` and run:

```sh
npm ci --include=dev
npm run check
npm test
bb plugin build
bb plugin install . --yes
```

### Open Context Health

1. Open a thread in BB.
2. Show the right panel (`⌘ J` on macOS).
3. Choose **New tab → Context Health**.
4. Switch between **Recorded content**, **Loaded skills** and **Available skills**.

Select a category to filter entries, or search titles and previews. Expand an entry for more detail. On Codex threads, use the **Data source** selector to switch to **Codex session detail**.

## Provider support

Context Health uses BB’s normalized event APIs for a consistent inspection method across providers. The amount of detail depends on what each provider exposes.

| Capability | Codex | Claude Code, Pi and ACP providers |
| --- | --- | --- |
| Recorded activity | Yes | Yes, for supported normalized items |
| Overall context usage | When exposed by BB | When exposed by BB |
| Observed skill reads | Tool results and optional session logs | Tool results with sufficient evidence |
| Available skill inventory | Filtered for the provider | Filtered for the provider |
| Local session-log inspection | Optional | Not implemented |

Missing usage is displayed as **Unavailable**, not zero.

## Understanding the numbers

**Recorded-text estimates are not the same as total context usage.**

The usage meter preserves BB’s provider-reported or estimated classification. Category totals estimate recorded text at **four Unicode characters per token**. Category percentages show each category’s share of that recorded-text estimate, not its share of the model’s context-window capacity.

Recorded activity can include messages, commands, tool calls and results, web activity, visible reasoning, plans and diffs. Hidden prompts, attachment contents, encrypted reasoning and provider-side truncation are not fully measurable. Category totals therefore do not add up to the usage meter.

The shared view excludes activity before the latest context-clear or compaction boundary. Open **Data coverage & accuracy** for details about the current snapshot.

### Loaded skills versus available skills

**Loaded skills** shows evidence of a skill read: a recorded tool call references exactly one `SKILL.md` path, and its result contains skill `name` and `description` frontmatter. Catalogue mentions and ambiguous multi-file references do not qualify.

This is an observed read, **not a guarantee that the skill remains in the current context**. Compaction, missing history or unrecognized read formats can prevent detection. An empty list means no qualifying evidence was found in the inspection window.

Skill result-token estimates are already included under **Tool results** and are not counted twice.

**Available skills** lists the current inventory. Availability does not prove loading, and inventory entries are excluded from token totals.

## Codex session detail

The optional Codex source reads the matching session’s JSONL log on the thread’s environment host. It provides additional visibility into recorded instructions, skill catalogue entries, dynamic tool definitions and tool activity.

The default log directory is:

```text
$CODEX_HOME/sessions
```

When `CODEX_HOME` is unset, it falls back to `~/.codex/sessions`. Set **Codex home on the thread host** in the plugin settings to override the home directory with an absolute path.

The shared activity view does not require access to provider logs. Missing logs or unavailable hosts produce a coverage notice.

## Privacy and limits

Context Health reads records without modifying session files. It does not store context in a plugin database or send it to an external service. Results are returned to the BB panel through plugin RPC. The plugin adds no agent tools, instructions or skills.

Real entry previews and skill paths can contain private project information. Review them before sharing screenshots.

| Inspection limit | Maximum |
| --- | --- |
| Shared activity | Latest 1,000 relevant events after the context boundary |
| Breakdown entries | 1,500 |
| Preview length | 1,200 characters per entry |
| Available skills | 1,500 |
| Codex log size | 64 MiB |
| Codex session discovery | 5,000 directories |

These limits can omit older content or skill-read evidence. Coverage notices identify unavailable or bounded data.

## Troubleshooting

| Issue | What to check |
| --- | --- |
| Usage is unavailable | The provider may not expose usage. Refresh after a model response. |
| Loaded skills is empty | No qualifying read was found. On Codex, try the session-detail source. |
| Category totals differ from usage | Expected: recorded-text estimates and overall usage have different coverage. |
| Codex detail is unavailable | Check the environment host, session logs and Codex home setting. |
| Older entries are missing | Check coverage notices for context boundaries or inspection limits. |
| Refresh fails | The panel keeps the last successful snapshot when available. Resolve the reported issue and refresh again. |

## Development

The package pins its development SDK to `0.4.48`. React is provided by BB at runtime; Zod is the only declared runtime dependency.

```sh
npm ci --include=dev
npm run check
npm test
bb plugin dev
```

`bb plugin dev` watches source changes, rebuilds and reloads the installed plugin. To rebuild and reload once:

```sh
bb plugin build
bb plugin reload context-health
```

Tests cover event deduplication, context boundaries, skill-read evidence, JSON-safe RPC results, bounded log inspection and panel interactions.

| File | Purpose |
| --- | --- |
| [app.tsx](app.tsx) / [app.css](app.css) | Panel UI and styling |
| [server.ts](server.ts) | RPC, usage and inventory orchestration |
| [shared.ts](shared.ts) | Provider-independent event inspection |
| [analyze.ts](analyze.ts) | Codex log analysis and skill-read evidence |
| [host.ts](host.ts) | Read-only session-file access |
| [contract.ts](contract.ts) | Validated RPC schemas |

## License

[MIT](LICENSE).
