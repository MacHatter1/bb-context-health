import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, rpcContract, type Breakdown } from './contract.ts';
import { readSharedContext, relevantSkills } from './shared.ts';
export { rpcContract } from './contract.ts';

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({ codexHome: { type: 'string', label: 'Codex home on the thread host', description: 'Leave blank for CODEX_HOME or ~/.codex. Used only to read session logs.', default: '' } });
  const host = bb.hosts.experimental_client({ contract: hostContract });
  bb.rpc.register(rpcContract, {
    async inspect({ threadId, source }) {
      const [thread, timeline] = await Promise.all([
        bb.sdk.threads.get({ threadId }),
        bb.sdk.threads.timeline({ threadId, summaryOnly: 'true', segmentLimit: '1' }),
      ]);
      let breakdown: Breakdown = { entries: [], source: null, compacted: false, notices: [] };
      if (source === 'shared') {
        breakdown = await readSharedContext(bb.sdk, threadId, timeline.maxSeq, timeline.contextBoundarySeq);
      } else if (thread.providerId !== 'codex') breakdown.notices.push('Detailed breakdown is currently available for Codex session logs. BB’s overall usage is shown when this provider reports it.');
      else if (!thread.environmentId) breakdown.notices.push('This thread has no attached environment yet.');
      else {
        try {
          const [environment, identities, config] = await Promise.all([
            bb.sdk.environments.get({ environmentId: thread.environmentId }),
            bb.sdk.threads.events.list({ threadId, types: ['thread/identity'], order: 'desc', limit: '1', afterSeq: String(timeline.contextBoundarySeq ?? 0), beforeSeq: String(timeline.maxSeq + 1) }),
            settings.get(),
          ]);
          const identity = identities[0];
          if (!identity || identity.type !== 'thread/identity' || identity.seq <= (timeline.contextBoundarySeq ?? 0) || identity.seq > timeline.maxSeq) breakdown.notices.push('The provider has not recorded a session identity for the current context yet.');
          else breakdown = await host.call('inspect', { sessionId: identity.data.providerThreadId, codexHome: config.codexHome }, { hostId: environment.hostId });
        } catch (error) { breakdown.notices.push(`Detailed inspection unavailable: ${error instanceof Error ? error.message : String(error)}`); }
      }
      let skills: Awaited<ReturnType<typeof bb.sdk.skills.list>>['skills'] = [];
      try {
        const inventory = await bb.sdk.skills.list({ projectId: thread.projectId, environmentId: thread.environmentId });
        skills = relevantSkills(inventory.skills, thread.providerId);
        if (skills.length > 1500) breakdown.notices.push('Skill inventory limited to 1,500 entries.');
      } catch (error) { breakdown.notices.push(`Skill inventory unavailable: ${error instanceof Error ? error.message : String(error)}`); }
      return { ...breakdown, skills: skills.slice(0, 1500), provider: thread.providerId, usage: timeline.contextWindowUsage ?? null, updatedAt: Date.now() };
    },
  });
}
