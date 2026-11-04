import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  readRevisionChapter,
  reviewRevisions,
  type ReviewRevisionInput,
} from "@drelwick/core";
import {
  ApplicationError,
  createUuid,
  IPC,
  RevisionActionSchema,
} from "@drelwick/shared";
export function registerRevisionHandler(context: {
  trusted(event: IpcMainInvokeEvent): unknown;
  session(): { projectPath: string; projectId: string; epoch: number } | null;
  busy(): boolean;
  setBusy(value: boolean): void;
  settle(path: string): Promise<void>;
}) {
  const previews = new Map<
    string,
    {
      owner: IpcMainInvokeEvent["senderFrame"];
      epoch: number;
      input: Omit<ReviewRevisionInput, "operationId">;
    }
  >();
  ipcMain.handle(IPC.REVISION_ACTION, async (event, payload: unknown) => {
    if (!context.trusted(event))
      return {
        ok: false,
        error: {
          code: "PROJECT_ACCESS_DENIED",
          message: "Project access is not permitted.",
        },
      };
    const parsed = RevisionActionSchema.safeParse(payload),
      session = context.session();
    if (
      !parsed.success ||
      !session ||
      parsed.data.projectId !== session.projectId
    )
      return {
        ok: false,
        error: {
          code: "EDITORIAL_INVALID",
          message: "Invalid revision request or inactive project.",
        },
      };
    const action = parsed.data;
    if (action.operation === "cancel") {
      if (previews.get(action.token)?.owner === event.senderFrame)
        previews.delete(action.token);
      return { ok: true, value: null };
    }
    if (context.busy())
      return {
        ok: false,
        error: {
          code: "PROJECT_BUSY",
          message: "Wait for the current operation before reviewing revisions.",
        },
      };
    context.setBusy(true);
    const authorized = () =>
      Boolean(context.trusted(event)) &&
      context.session()?.epoch === session.epoch;
    try {
      await context.settle(session.projectPath);
      let value: unknown;
      if (action.operation === "get")
        value = await readRevisionChapter(
          session.projectPath,
          session.projectId,
          action.chapterId,
        );
      else if (action.operation === "preview") {
        const current = await readRevisionChapter(
          session.projectPath,
          session.projectId,
          action.chapterId,
        );
        if (
          new Set(action.ids).size !== action.ids.length ||
          action.ids.some(
            (id) =>
              !current.state.review.pending.some((group) => group.id === id),
          )
        )
          throw new ApplicationError("EDITORIAL_STALE", "Stale decision.");
        const token = createUuid();
        if (previews.size >= 8) previews.delete(previews.keys().next().value!);
        previews.set(token, {
          owner: event.senderFrame,
          epoch: session.epoch,
          input: {
            projectPath: session.projectPath,
            projectId: session.projectId,
            chapterId: action.chapterId,
            expected: current.expected,
            ids: action.ids,
            action: action.action,
          },
        });
        value = { ...current, token, ids: action.ids, action: action.action };
      } else {
        const preview = previews.get(action.token);
        if (
          !preview ||
          preview.owner !== event.senderFrame ||
          preview.epoch !== session.epoch ||
          preview.input.projectPath !== session.projectPath
        )
          throw new ApplicationError("EDITORIAL_STALE", "Stale decision.");
        value = await reviewRevisions(
          { ...preview.input, operationId: action.operationId },
          { authorized },
        );
      }
      if (!authorized())
        throw new ApplicationError(
          "PROJECT_ACCESS_DENIED",
          "Project access changed.",
        );
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        error: {
          code:
            error instanceof ApplicationError
              ? error.code
              : "EDITORIAL_INVALID",
          message:
            "Revision review could not finish safely. Drafts and previous saved content were preserved. Refresh review or reopen for recovery; an uncertain decision must be retried with its original request.",
        },
      };
    } finally {
      context.setBusy(false);
    }
  });
  return {
    clear() {
      previews.clear();
    },
  };
}
