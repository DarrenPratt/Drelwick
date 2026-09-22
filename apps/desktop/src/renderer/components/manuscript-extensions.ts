import { isSupportedManuscriptLink } from "@bookeditor/project-model";
import StarterKit from "@tiptap/starter-kit";
import { Epigraph } from "./Epigraph.js";
import { SceneBreak } from "./SceneBreak.js";

/** A fresh extension set for every editor instance and headless compatibility test. */
export function createManuscriptExtensions() {
  return [
    StarterKit.configure({
      link: {
        openOnClick: false,
        defaultProtocol: "https",
        isAllowedUri: (href) => isSupportedManuscriptLink(href),
      },
    }),
    SceneBreak,
    Epigraph,
  ];
}
