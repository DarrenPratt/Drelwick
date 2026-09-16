import { z } from "zod";

// The nodes/marks emitted by the desktop StarterKit and SceneBreak extension.
// Reject unknown data rather than allowing the editor to silently discard it.
const mark = z.union([
  z
    .object({ type: z.enum(["bold", "italic", "strike", "underline", "code"]) })
    .strict(),
  z
    .object({
      type: z.literal("link"),
      attrs: z
        .object({
          href: z.string(),
          target: z.string().nullable().optional(),
          rel: z.string().nullable().optional(),
          class: z.string().nullable().optional(),
          title: z.string().nullable().optional(),
        })
        .strict(),
    })
    .strict(),
]);
const marks = z.array(mark).superRefine((values, context) => {
  if (
    new Set(values.map((value) => value.type)).size !== values.length ||
    (values.length > 1 && values.some((value) => value.type === "code"))
  )
    context.addIssue({ code: "custom", message: "Invalid mark combination" });
});
const text = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1),
    marks: marks.optional(),
  })
  .strict();
const inline = z.union([
  text,
  z.object({ type: z.literal("hardBreak"), marks: marks.optional() }).strict(),
]);
const paragraph = z
  .object({ type: z.literal("paragraph"), content: z.array(inline).optional() })
  .strict();

export interface ManuscriptNode {
  type: string;
  [key: string]: unknown;
}

const block: z.ZodType<ManuscriptNode> = z.lazy(() =>
  z.union([
    paragraph,
    z
      .object({
        type: z.literal("heading"),
        attrs: z.object({ level: z.number().int().min(1).max(6) }).strict(),
        content: z.array(inline).optional(),
      })
      .strict(),
    z
      .object({ type: z.literal("blockquote"), content: z.array(block).min(1) })
      .strict(),
    z
      .object({
        type: z.literal("bulletList"),
        content: z.array(listItem).min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("orderedList"),
        attrs: z
          .object({
            start: z.number().int(),
            type: z.string().nullable().optional(),
          })
          .strict()
          .optional(),
        content: z.array(listItem).min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("codeBlock"),
        attrs: z
          .object({ language: z.string().nullable() })
          .strict()
          .optional(),
        content: z
          .array(
            z
              .object({ type: z.literal("text"), text: z.string().min(1) })
              .strict(),
          )
          .optional(),
      })
      .strict(),
    z.object({ type: z.enum(["sceneBreak", "horizontalRule"]) }).strict(),
  ]),
);
const listItem: z.ZodType<ManuscriptNode> = z.lazy(() =>
  z
    .object({
      type: z.literal("listItem"),
      content: z.tuple([paragraph]).rest(block),
    })
    .strict(),
);

/** Empty version-1 documents remain valid and are displayed as an empty paragraph. */
export const ManuscriptDocumentSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(block).optional(),
  })
  .strict();
