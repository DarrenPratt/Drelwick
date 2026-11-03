import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  captureComparisonSource,
  compareSnapshots,
  ManuscriptSnapshotError,
  type ComparisonInput,
} from "@drelwick/core";
import {
  ApplicationError,
  ComparisonActionSchema,
  IPC,
  createUuid,
  type ComparisonSourceRequest,
} from "@drelwick/shared";

/** Source bytes remain privileged; renderer tokens convey no filesystem authority. */
export function registerComparisonHandler(context: {
  trusted(event: IpcMainInvokeEvent): unknown;
  session(): { projectPath: string; projectId: string; epoch: number } | null;
  settle(path: string): Promise<void>;
}) {
  type Session = NonNullable<ReturnType<typeof context.session>>;
  type Owned = { owner: IpcMainInvokeEvent["senderFrame"]; session: Session };
  const sources = new Map<
    string,
    Owned & { input: ComparisonInput; request: ComparisonSourceRequest }
  >();
  const running = new Map<string, Owned & { controller: AbortController }>();
  let capturing = false;
  const same = (a: Session, b: Session | null) =>
    b &&
    a.projectPath === b.projectPath &&
    a.projectId === b.projectId &&
    a.epoch === b.epoch;
  const clean = () => {
    for (const [id, source] of sources)
      if (!same(source.session, context.session())) sources.delete(id);
    for (const run of running.values())
      if (!same(run.session, context.session())) run.controller.abort();
  };
  ipcMain.handle(IPC.COMPARISON_ACTION, async (event, payload: unknown) => {
    if (!context.trusted(event))
      return {
        ok: false,
        error: {
          code: "PROJECT_ACCESS_DENIED",
          message: "Project access is not permitted.",
        },
      };
    clean();
    const parsed = ComparisonActionSchema.safeParse(payload),
      session = context.session();
    if (!parsed.success)
      return {
        ok: false,
        error: {
          code: "COMPARISON_INVALID",
          message: "Invalid comparison request.",
        },
      };
    const action = parsed.data;
    if (!session || action.projectId !== session.projectId)
      return {
        ok: false,
        error: {
          code: "PROJECT_NOT_OPEN",
          message: "Open the project before comparing revisions.",
        },
      };
    const authorized = () =>
      Boolean(context.trusted(event)) &&
      Boolean(same(session, context.session()));
    const owned = (value: Owned | undefined) =>
      value &&
      value.owner === event.senderFrame &&
      same(value.session, session);
    try {
      let value: unknown;
      if (action.operation === "cancel") {
        const run = running.get(action.requestId);
        if (owned(run)) run!.controller.abort();
        value = null;
      } else if (action.operation === "release") {
        if (owned(sources.get(action.token))) sources.delete(action.token);
        value = null;
      } else if (action.operation === "capture") {
        if (capturing || running.size)
          throw new ApplicationError(
            "PROJECT_BUSY",
            "Wait for the current comparison operation.",
          );
        if (sources.size >= 2)
          throw new ApplicationError(
            "COMPARISON_LIMIT",
            "Release a comparison source before capturing another.",
          );
        capturing = true;
        try {
          await context.settle(session.projectPath);
          const input = await captureComparisonSource(
            session.projectPath,
            session.projectId,
            action.source,
          );
          if (!authorized())
            throw new ApplicationError(
              "PROJECT_ACCESS_DENIED",
              "Project access changed.",
            );
          const token = createUuid();
          sources.set(token, {
            owner: event.senderFrame,
            session,
            input,
            request: action.source,
          });
          value = { token, source: input.source };
        } finally {
          capturing = false;
        }
      } else if (action.operation === "status") {
        const captured = sources.get(action.token);
        if (!owned(captured))
          throw new ApplicationError(
            "COMPARISON_STALE",
            "Capture the comparison source again.",
          );
        const current = await captureComparisonSource(
          session.projectPath,
          session.projectId,
          {
            kind: "captured-current",
            projection: captured!.input.source.projection,
          },
        );
        value = {
          stale:
            captured!.input.source.kind === "captured-current" &&
            current.source.inventoryHash !==
              captured!.input.source.inventoryHash,
        };
      } else {
        const left = sources.get(action.left),
          right = sources.get(action.right);
        if (!owned(left) || !owned(right))
          throw new ApplicationError(
            "COMPARISON_STALE",
            "Capture both comparison sources again.",
          );
        if (running.size || capturing)
          throw new ApplicationError(
            "PROJECT_BUSY",
            "Cancel the current comparison first.",
          );
        const controller = new AbortController();
        running.set(action.requestId, {
          owner: event.senderFrame,
          session,
          controller,
        });
        try {
          for (const source of [left!, right!]) {
            const checked = await captureComparisonSource(
              session.projectPath,
              session.projectId,
              source.request,
            );
            if (controller.signal.aborted)
              throw new ApplicationError(
                "COMPARISON_CANCELLED",
                "Comparison cancelled.",
              );
            if (
              checked.source.inventoryHash !==
                source.input.source.inventoryHash ||
              checked.source.generation !== source.input.source.generation
            )
              throw new ApplicationError(
                "COMPARISON_STALE",
                "Capture the comparison sources again.",
              );
          }
          value = await compareSnapshots(left!.input, right!.input, {
            signal: controller.signal,
            authorized,
          });
        } finally {
          running.delete(action.requestId);
        }
      }
      if (!authorized())
        throw new ApplicationError(
          "PROJECT_ACCESS_DENIED",
          "Project access changed.",
        );
      return { ok: true, value };
    } catch (error) {
      // Fixed messages only: never return exception payloads, paths or manuscript text.
      const code =
        error instanceof ApplicationError
          ? error.code
          : "COMPARISON_UNAVAILABLE";
      const assetId =
        error instanceof ManuscriptSnapshotError
          ? /^managed image ([a-f0-9-]{36})$/.exec(error.component)?.[1]
          : undefined;
      return {
        ok: false,
        error: {
          code,
          message: assetId
            ? `MISSING_ASSET: ${assetId}. This source is unavailable; comparison cannot claim equality.`
            : code === "COMPARISON_CANCELLED"
              ? "Comparison cancelled."
              : code === "COMPARISON_UNSUPPORTED_VERSION"
                ? "UNSUPPORTED_VERSION: this source has no supported read-only comparison adapter. Saved content was preserved."
                : code === "COMPARISON_STALE"
                  ? "The comparison source changed or its token expired. Capture both versions again."
                  : "Comparison source is unavailable, changed, incompatible or exceeds a resource limit. Capture the sources again; saved content was preserved.",
        },
      };
    }
  });
  return {
    clear() {
      sources.clear();
      for (const run of running.values()) run.controller.abort();
    },
  };
}
