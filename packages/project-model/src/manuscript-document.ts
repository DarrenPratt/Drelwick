import { z } from "zod";
import { ImageAttributesSchema } from "./image-assets.js";

/** Heading levels intentionally supported by the authoring and publishing model. */
export const MANUSCRIPT_HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
const manuscriptHeadingLevel = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

/**
 * Links in manuscripts may target an absolute web page, an email address or a
 * fragment within a generated publication. Local files, executable schemes and
 * protocol-relative URLs are deliberately excluded.
 */
export function isSupportedManuscriptLink(href: string): boolean {
  if (
    href.length === 0 ||
    href !== href.trim() ||
    [...href].some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined && (codePoint <= 0x20 || codePoint === 0x7f)
      );
    })
  )
    return false;
  if (href.startsWith("#")) return href.length > 1;
  try {
    const url = new URL(href);
    if (url.protocol === "mailto:") return url.pathname.length > 0;
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

// This is the deliberate persisted vocabulary shared by the editor, paste
// conversion and core load/save validation. Reject unknown data rather than
// allowing ProseMirror to silently discard it.
const mark = z.union([
  z
    .object({ type: z.enum(["bold", "italic", "strike", "underline", "code"]) })
    .strict(),
  z
    .object({
      type: z.literal("link"),
      attrs: z
        .object({
          href: z.string().refine(isSupportedManuscriptLink, {
            message: "Unsupported manuscript link",
          }),
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
      .object({ type: z.literal("image"), attrs: ImageAttributesSchema })
      .strict(),
    z
      .object({
        type: z.literal("heading"),
        attrs: z.object({ level: manuscriptHeadingLevel }).strict(),
        content: z.array(inline).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("epigraph"),
        attrs: z
          .object({ attribution: z.string().nullable().optional() })
          .strict()
          .optional(),
        content: z.array(paragraph).min(1),
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
