import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sceneBreak: {
      insertSceneBreak: () => ReturnType;
    };
  }
}

export const SceneBreak = Node.create({
  name: "sceneBreak",
  group: "block",
  atom: true,
  isolating: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "div[data-scene-break]" }];
  },

  renderHTML() {
    return [
      "div",
      mergeAttributes({
        "data-scene-break": "true",
        "aria-label": "Scene break",
      }),
      "***",
    ];
  },

  addCommands() {
    return {
      insertSceneBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});
