import { z } from "zod";
const base = { projectId: z.string().uuid(), chapterId: z.string().uuid() };
export const RevisionActionSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("get"), ...base }),
  z.strictObject({
    operation: z.literal("preview"),
    ...base,
    ids: z.array(z.string().uuid()).min(1).max(1000),
    action: z.enum(["accept", "reject"]),
  }),
  z.strictObject({
    operation: z.literal("commit"),
    projectId: z.string().uuid(),
    operationId: z.string().uuid(),
    token: z.string().uuid(),
  }),
  z.strictObject({
    operation: z.literal("cancel"),
    projectId: z.string().uuid(),
    token: z.string().uuid(),
  }),
]);
export type RevisionAction = z.infer<typeof RevisionActionSchema>;
