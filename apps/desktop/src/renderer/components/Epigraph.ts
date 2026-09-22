import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    epigraph: {
      toggleEpigraph: () => ReturnType;
    };
  }
}

/** Semantic quotation used at the opening of a chapter or section. */
export const Epigraph = Node.create({
  name: "epigraph",
  group: "block",
  content: "paragraph+",
  defining: true,

  addAttributes() {
    return {
      attribution: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-attribution"),
        renderHTML: ({ attribution }: { attribution?: unknown }) =>
          typeof attribution === "string" && attribution.length > 0
            ? { "data-attribution": attribution }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "aside[data-epigraph]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "aside",
      mergeAttributes(HTMLAttributes, { "data-epigraph": "true" }),
      0,
    ];
  },

  addCommands() {
    return {
      toggleEpigraph:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
    };
  },
});
