import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { open, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { hostContract } from './contract.ts';
import { createAnalyzer } from './analyze.ts';

// Only discover dated Codex rollout files; callers never supply a file path.
async function findSession(root: string, sessionId: string, signal: AbortSignal): Promise<string | null> {
  let visited = 0;
  async function walk(path: string, depth: number): Promise<string | null> {
    signal.throwIfAborted();
    if (++visited > 5000) throw new Error('Session search exceeded 5,000 directories. Narrow the Codex home setting.');
    let files;
    try { files = await readdir(path, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    for (const f of files.sort((a,b) => b.name.localeCompare(a.name))) {
      if (f.isFile() && f.name.startsWith('rollout-') && f.name.endsWith(`-${sessionId}.jsonl`)) return join(path, f.name);
      if (depth < 3 && f.isDirectory() && /^\d{2,4}$/.test(f.name)) {
        const match = await walk(join(path, f.name), depth + 1);
        if (match) return match;
      }
    }
    return null;
  }
  return walk(root, 0);
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    async inspect({ sessionId, codexHome }, { signal }) {
      const home = codexHome || process.env.CODEX_HOME || join(homedir(), '.codex');
      if (!isAbsolute(home)) throw new Error('Codex home must be an absolute path on the thread host.');
      const path = await findSession(join(home, 'sessions'), sessionId, signal);
      if (!path) return { entries: [], source: null, compacted: false, notices: ['No local Codex session log was found. Check the Codex home setting on this thread’s host.'] };
      const file = await open(path, 'r');
      try {
        const stat = await file.stat();
        if (stat.size > 64 * 1024 * 1024) throw new Error('Session log exceeds the 64 MiB inspection limit. Overall usage remains available.');
        const analyzer = createAnalyzer();
        // Read a stable byte snapshot; do not follow a growing active session.
        const buffer = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < buffer.length) {
          signal.throwIfAborted();
          const { bytesRead } = await file.read(buffer, offset, Math.min(1024 * 1024, buffer.length - offset), offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        const lines = buffer.subarray(0, offset).toString('utf8').split('\n');
        for (const line of lines) { signal.throwIfAborted(); if (line.trim()) analyzer.push(line); }
        return { ...analyzer.finish(), source: path };
      } finally { await file.close(); }
    },
  },
});
