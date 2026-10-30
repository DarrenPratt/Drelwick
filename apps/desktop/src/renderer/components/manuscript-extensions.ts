import { isSupportedManuscriptLink } from "@drelwick/project-model";
import StarterKit from "@tiptap/starter-kit";
import { Epigraph } from "./Epigraph.js";
import { SceneBreak } from "./SceneBreak.js";
import { ManuscriptImage } from "./ManuscriptImage.js";
import { EditorialDecorations } from "./EditorialDecorations.js";

/** A fresh extension set for every editor instance and headless compatibility test. */
export function createManuscriptExtensions(projectId?: string) {
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
    ManuscriptImage.configure(projectId ? { projectId } : {}),
    EditorialDecorations,
  ];
}
