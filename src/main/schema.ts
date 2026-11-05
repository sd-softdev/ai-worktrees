import { z } from 'zod'
import type { TerminalLayout } from '../shared/types'

export const pathSchema = z.string().min(1).max(4096)
export const idSchema = z.uuid()
export const sizeSchema = z.number().int().min(1).max(1000)
export const relativePathSchema = z.string().max(4096)
export const sshTargetSchema = z.object({
  host: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^\s\x00-\x1f-][^\s\x00-\x1f]*$/),
  nodePath: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => !/[\x00\r\n]/.test(value)),
})
export const sshConnectSchema = sshTargetSchema.extend({ id: idSchema })
export const remoteReferenceSchema = sshTargetSchema.extend({
  kind: z.literal('ssh'),
  path: pathSchema,
})

const layoutSchema: z.ZodType<TerminalLayout> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('terminal'), id: idSchema, title: z.string().max(160) }),
    z.object({
      type: z.literal('split'),
      id: idSchema,
      direction: z.enum(['horizontal', 'vertical']),
      ratio: z.number().min(0.1).max(0.9),
      first: layoutSchema,
      second: layoutSchema,
    }),
  ]),
)

export const reviewPreferencesSchema = z.object({
  provider: z.enum(['auto', 'off', 'github', 'gitlab']),
  remote: z.string().max(300),
})

export const preferencesSchema = z.object({
  activeWorktree: pathSchema.nullable(),
  targetBranch: z.string().max(300),
  leftWidth: z.number().min(190).max(480),
  rightWidth: z.number().min(260).max(720),
  inspectorTab: z.enum(['changes', 'history', 'files', 'reviews']),
  reviews: reviewPreferencesSchema.default({ provider: 'auto', remote: '' }),
  worktrees: z.record(
    pathSchema,
    z.object({
      task: z.string().max(500),
      status: z.enum(['todo', 'working', 'review', 'done']),
      activeTab: idSchema.nullable(),
      tabs: z
        .array(z.object({ id: idSchema, title: z.string().max(160), layout: layoutSchema }))
        .max(24),
    }),
  ),
})

export const createWorktreeSchema = z.object({
  branch: z.string().min(1).max(200),
  base: z.string().min(1).max(300),
  task: z.string().max(500),
})

export const diffSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('working'), path: relativePathSchema }),
  z.object({ kind: z.literal('staged'), path: relativePathSchema }),
  z.object({ kind: z.literal('branch'), target: z.string().min(1).max(300) }),
  z.object({ kind: z.literal('commit'), hash: z.string().regex(/^[0-9a-f]{40,64}$/i) }),
])
