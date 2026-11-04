import { isSupportedManuscriptLink } from "@drelwick/project-model";
import StarterKit from "@tiptap/starter-kit";
import { Epigraph } from "./Epigraph.js";
import { SceneBreak } from "./SceneBreak.js";
import { ManuscriptImage } from "./ManuscriptImage.js";
import { EditorialDecorations } from "./EditorialDecorations.js";
import { RevisionTracking } from "./RevisionTracking.js";
import type { RevisionState } from "@drelwick/core/revisions";

/** A fresh extension set for every editor instance and headless compatibility test. */
export function createManuscriptExtensions(
  projectId?: string,
  revisionState?: RevisionState,
) {
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
    RevisionTracking.configure({ initial: revisionState ?? null }),
  ];
}
