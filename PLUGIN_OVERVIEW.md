## Find what is taking up your thread's context

Context Health gives each BB thread a panel for exploring recorded messages,
tool output and skills. Compare category bars, then search, sort and expand
individual entries to find large contributions.

## What you get

- An overall context usage meter when BB exposes provider-reported or estimated usage.
- Recorded-text estimates grouped by category, with filters and expandable previews.
- A Loaded skills view for qualifying skill reads observed in recorded tool results.
- A separate Available skills inventory with descriptions and plugin ownership.
- Optional Codex session-log detail for recorded instructions, skill catalogue entries and dynamic tool definitions.
- Coverage notices explaining missing data, context boundaries and inspection limits.

Open a thread's right panel and choose **New tab → Context Health**. The panel
refreshes every 30 seconds while visible, with manual refresh available.

## Understand the coverage

The shared view uses BB's normalised event data across Codex, Claude Code, Pi
and ACP providers. Detail depends on what each provider exposes. Recorded-text
estimates use four Unicode characters per token, rounded up per entry; they
do not reconstruct the full model context or add up to the usage meter.

The shared view reads up to 1,000 relevant events after the latest context
clear or compaction, in pages of 100. Breakdowns and skill inventory are limited
to 1,500 entries each. Codex log inspection is limited to 64 MiB.

Loaded skills means a qualifying read was observed, not that the skill remains
in context after compaction. Those result tokens are already included under
Tool results. Available skills is current inventory and is excluded from
recorded-text totals. Missing usage is shown as Unavailable.

## Requirements and privacy

Requires BB 0.42+ and a compatible Plugin SDK runtime of 0.4.48+. Optional
Codex detail requires the matching session log on the thread's environment
host. You can override the Codex home directory in plugin settings.

No separate account or paid service is required. The plugin reads records
without modifying session files. Results return through BB plugin RPC; context
is not sent to an external analysis service or stored in a plugin database.
It adds no agent tools, instructions, CLI commands or bundled skills.
Review real previews and skill paths before sharing screenshots.
