import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const entrySchema = z.object({
  id: z.string(), category: z.string(), title: z.string(),
  characters: z.number().nonnegative(), tokens: z.number().nonnegative(),
  preview: z.string(),
  loadedSkill: z.object({ name: z.string(), filePath: z.string() }).optional(),
});
export const breakdownSchema = z.object({
  entries: z.array(entrySchema), notices: z.array(z.string()),
  source: z.string().nullable(), compacted: z.boolean(),
});
export type Entry = z.infer<typeof entrySchema>;
export type Breakdown = z.infer<typeof breakdownSchema>;
export const hostContract = defineRpcContract({
  inspect: {
    input: z.object({ sessionId: z.string().uuid(), codexHome: z.string().max(4096) }),
    output: breakdownSchema,
  },
});
export const rpcContract = defineRpcContract({
  inspect: {
    input: z.object({ threadId: z.string().regex(/^thr_[a-zA-Z0-9]+$/), source: z.enum(['shared', 'codex']).default('shared') }),
    output: breakdownSchema.extend({
      provider: z.string(), updatedAt: z.number(),
      skills: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().nullable(), filePath: z.string(), scope: z.string(), pluginId: z.string().nullable() })),
      usage: z.object({ usedTokens: z.number(), modelContextWindow: z.number(), estimated: z.boolean() }).nullable(),
    }),
  },
});
