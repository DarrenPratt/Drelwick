import { dialog, type BrowserWindow } from "electron";
import { ApplicationError } from "@drelwick/shared";
export function chooseRevisionProjection(
  window: BrowserWindow,
  authorized: () => boolean = () => !window.isDestroyed(),
) {
  return async (scope: {
    generation: number;
    count: number;
    chapters: number;
  }): Promise<"accepted" | "proposed" | null> => {
    if (!authorized())
      throw new ApplicationError(
        "PROJECT_ACCESS_DENIED",
        "Project access changed.",
      );
    const choice = await dialog.showMessageBox(window, {
      type: "question",
      title: "Choose manuscript text for this output",
      message: `${scope.count} pending changes in ${scope.chapters} chapters (saved generation ${scope.generation})`,
      detail:
        "Accepted text omits pending insertions and keeps pending deletions and original formatting. Proposed text includes all pending changes. This choice applies only to this output and does not accept or reject revisions.",
      buttons: [
        "Accepted text only",
        "Proposed text including pending changes",
        "Cancel",
      ],
      defaultId: 2,
      cancelId: 2,
      noLink: true,
    });
    if (!authorized())
      throw new ApplicationError(
        "PROJECT_ACCESS_DENIED",
        "Project access changed.",
      );
    return choice.response === 0
      ? "accepted"
      : choice.response === 1
        ? "proposed"
        : null;
  };
}
