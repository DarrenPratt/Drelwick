import type { JSONContent } from "@tiptap/core";

// Original demonstration prose. Never written into an author's project.
export const sampleParagraphs = [
  "The lighthouse had been dark for eleven years when someone lit it again. From the kitchen window, Mara watched its pale beam sweep across the harbour, illuminating the boats one by one, as if counting what the sea had chosen to return.",
  "She set her cup down. Outside, the town was still asleep. A fishing line tapped against a mast, and somewhere beyond the breakwater a bell answered the slow movement of the tide.",
  "Her father's letter lay open on the table. It had arrived yesterday, folded into thirds and smelling faintly of cedar. There was no date. Just a single instruction, written in the careful hand she remembered from childhood: when the light returns, come home.",
  "Now she was home, and the light was turning, and the house felt suddenly too small for all the things she had spent eleven years refusing to remember.",
  "Mara pulled on her coat and stepped into the morning. The road to the lighthouse followed the water, past shuttered shops and the old boatyard where the grass had grown through the gravel. Nothing had changed. Everything had.",
];

export const sampleChapters = [
  "The returning light",
  "A letter without a date",
  "What the tide remembers",
  "The keeper's house",
  "On the other shore",
];

export function sampleDocument(index: number): JSONContent {
  const paragraphs =
    index === 0
      ? sampleParagraphs
      : [
          `This is a sample of “${sampleChapters[index] ?? "A new chapter"}”. Select the first chapter to return to the opening of the demonstration book.`,
          "Use this workspace to explore the writing surface and the planned publishing tools. Any changes to this sample stay in this session only; they are never saved to a project.",
        ];
  return {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
}
