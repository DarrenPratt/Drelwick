import {
  PublicationDataSchema,
  type PublicationData,
  type MatterType,
} from "@drelwick/shared";
import { ManuscriptDocumentSchema } from "./manuscript-document.js";

export const PublicationSchema = PublicationDataSchema.superRefine(
  (value, context) => {
    value.pages.forEach((page, index) => {
      if (!ManuscriptDocumentSchema.safeParse(page.document).success)
        context.addIssue({
          code: "custom",
          path: ["pages", index, "document"],
          message: "Invalid semantic matter document",
        });
    });
  },
);

/** Starter text is editable semantic content, never a live template or raw HTML. */
export function createMatterPage(
  type: MatterType,
  id: string,
  metadata: PublicationData["metadata"],
): PublicationData["pages"][number] {
  const labels: Record<MatterType, string> = {
    title: "Title page",
    copyright: "Copyright",
    dedication: "Dedication",
    acknowledgements: "Acknowledgements",
    author: "About the author",
  };
  const paragraphs: Record<MatterType, string[]> = {
    title: [metadata.title, metadata.author],
    copyright: [`Copyright © ${metadata.author}.`, "All rights reserved."],
    dedication: ["For those who made this book possible."],
    acknowledgements: [
      "Thank you to everyone who helped bring this book to life.",
    ],
    author: [`About ${metadata.author}`],
  };
  return {
    id,
    type,
    title: labels[type],
    placement: ["author", "acknowledgements"].includes(type) ? "back" : "front",
    inclusion: {
      navigation: !["title", "copyright", "dedication"].includes(type),
      ebook: true,
      print: true,
    },
    document: {
      type: "doc",
      content: paragraphs[type].map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    },
  };
}
