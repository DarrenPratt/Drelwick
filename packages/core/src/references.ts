import { unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  ChapterFileSchema,
  ProjectConfigSchema,
  ProjectFormatSchema,
  ReferenceRecordSchema,
  ReferenceInputSchema,
  ReferenceDraftSchema,
  REFERENCE_LIMITS,
  type ProjectConfig,
  type ReferenceDraft,
} from "@drelwick/project-model";
import {
  ApplicationError,
  createUuid,
  createIsoDate,
  ReferenceRequestSchema,
  ReferenceIdSchema,
  type ReferenceRecord,
  type ReferenceKind,
  type ReferenceRequest,
  type ReferenceResponse,
  type ReferenceDiagnostic,
  type ReferenceSaved,
  type ReferenceCandidate,
  type ReferenceCandidateKey,
  type ReferenceEdge,
  type ReferenceInput,
  type ReferenceTarget,
} from "@drelwick/shared";
import { assertMigrationReadable, isMissing } from "./migration-state.js";
import { regularPath } from "./image-assets.js";
import {
  referenceError,
  referenceHash,
  referenceBytes,
  referenceRead,
  decodeReference,
  referenceDirectory,
  referenceEntries,
  referenceExclusive,
  publishReference,
  withReferenceLock,
  assertReferenceActive,
  type ReferenceWriteOptions,
  referenceFingerprint,
  preserveReferenceBytes,
} from "./reference-files.js";

export const REFERENCE_DIRECTORIES: Record<ReferenceKind, string> = {
  character: "characters",
  location: "locations",
  canon: "canon",
  timeline: "timeline",
  note: "notes",
};
type Entry = ReferenceSaved & { bytes: Buffer; path: string };
interface Store {
  entries: Entry[];
  diagnostics: ReferenceDiagnostic[];
  inventory: string;
  invalid: Map<string, string>;
}
interface Context {
  root: string;
  project: ProjectConfig;
  manifestHash: string;
  chapterHashes: Map<string, string | null>;
}
const errorCode = (error: unknown) =>
  error instanceof ApplicationError && error.code.startsWith("REFERENCE_")
    ? error.code
    : "REFERENCE_PATH_INVALID";
const version = (value: unknown): void => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value)
  )
    throw referenceError("REFERENCE_MALFORMED");
  if (Number.isInteger(value.schemaVersion) && Number(value.schemaVersion) > 1)
    throw referenceError("REFERENCE_UNSUPPORTED");
  if (value.schemaVersion !== 1) throw referenceError("REFERENCE_MALFORMED");
};
function parseRecord(bytes: Buffer): ReferenceRecord {
  const raw = decodeReference(bytes);
  version(raw);
  const parsed = ReferenceRecordSchema.safeParse(raw);
  if (!parsed.success)
    throw referenceError(
      parsed.error.issues.some((i) => i.code === "unrecognized_keys")
        ? "REFERENCE_UNSUPPORTED"
        : "REFERENCE_INVALID",
    );
  return parsed.data;
}
function identity(
  record: ReferenceRecord,
  projectId: string,
  id: string,
  kind?: ReferenceKind,
): void {
  if (
    record.projectId !== projectId ||
    record.id !== id ||
    (kind && record.kind !== kind)
  )
    throw referenceError("REFERENCE_IDENTITY_INVALID");
}
async function context(root: string, projectId: string): Promise<Context> {
  await regularPath(root, true);
  await assertMigrationReadable(root);
  const bytes = await referenceRead(join(root, "project.json"));
  const parsed = ProjectConfigSchema.safeParse(decodeReference(bytes));
  if (!parsed.success || parsed.data.projectId !== projectId)
    throw referenceError("REFERENCE_PROJECT_INVALID");
  if (parsed.data.schemaVersion === 2) {
    const format = ProjectFormatSchema.safeParse(
      decodeReference(await referenceRead(join(root, "format.json"))),
    );
    if (!format.success || format.data.projectId !== projectId)
      throw referenceError("REFERENCE_PROJECT_INVALID");
  }
  return {
    root,
    project: parsed.data,
    manifestHash: referenceHash(bytes),
    chapterHashes: new Map(),
  };
}
async function scan(ctx: Context): Promise<Store> {
  const entries: Entry[] = [],
    diagnostics: ReferenceDiagnostic[] = [],
    inventory: string[] = [];
  const invalid = new Map<string, string>();
  let count = 0,
    total = 0;
  for (const [kind, directory] of Object.entries(REFERENCE_DIRECTORIES) as [
    ReferenceKind,
    string,
  ][]) {
    let names: string[];
    try {
      names = await referenceEntries(join(ctx.root, "reference", directory));
    } catch {
      diagnostics.push({ code: "REFERENCE_PATH_INVALID", kind });
      continue;
    }
    for (const name of names) {
      if (++count > REFERENCE_LIMITS.files) {
        diagnostics.push({ code: "REFERENCE_LIMIT" });
        return {
          entries,
          diagnostics,
          inventory: referenceHash(inventory.join("\n")),
          invalid,
        };
      }
      const path = join(ctx.root, "reference", directory, name);
      const id = name.replace(/\.json$/i, "").toLowerCase();
      try {
        // Owned temporaries are reported by the recovery scanner, not treated as live records.
        if (/^[a-f0-9-]{36}\.[a-f0-9-]{36}\.tmp$/.test(name)) {
          await regularPath(path);
          continue;
        }
        const bytes = await referenceRead(path);
        total += bytes.length;
        if (total > REFERENCE_LIMITS.scanBytes)
          throw referenceError("REFERENCE_LIMIT");
        inventory.push(`${directory}/${name}:${referenceHash(bytes)}`);
        if (
          !name.endsWith(".json") ||
          !ReferenceIdSchema.safeParse(name.slice(0, -5)).success
        )
          throw referenceError("REFERENCE_IDENTITY_INVALID");
        const record = parseRecord(bytes);
        identity(record, ctx.project.projectId, id, kind);
        entries.push({
          record,
          bytes,
          path,
          fingerprint: referenceHash(bytes),
        });
      } catch (e) {
        const code = errorCode(e);
        invalid.set(id, code);
        diagnostics.push({
          code,
          kind,
          ...(ReferenceIdSchema.safeParse(id).success ? { id } : {}),
        });
        if (code === "REFERENCE_LIMIT")
          return {
            entries,
            diagnostics,
            invalid,
            inventory: referenceHash(inventory.join("\n")),
          };
      }
    }
  }
  const ids = new Map<string, Entry>(),
    links = new Map<string, Entry>();
  for (const entry of entries) {
    const duplicate = ids.get(entry.record.id);
    if (duplicate) {
      invalid.set(entry.record.id, "REFERENCE_DUPLICATE");
      diagnostics.push({ code: "REFERENCE_DUPLICATE", id: entry.record.id });
    }
    ids.set(entry.record.id, entry);
    for (const link of entry.record.links) {
      const other = links.get(link.id);
      if (other) {
        invalid.set(other.record.id, "REFERENCE_DUPLICATE");
        invalid.set(entry.record.id, "REFERENCE_DUPLICATE");
        diagnostics.push({ code: "REFERENCE_DUPLICATE", id: entry.record.id });
      }
      links.set(link.id, entry);
    }
  }
  return {
    entries: entries.filter((e) => !invalid.has(e.record.id)),
    diagnostics,
    invalid,
    inventory: referenceHash(inventory.join("\n")),
  };
}
async function targetStatus(
  ctx: Context,
  store: Store,
  target: ReferenceTarget,
): Promise<ReferenceEdge["status"]> {
  if (target.kind === "chapter") {
    if (!ctx.project.manuscript.order.includes(target.id)) return "missing";
    try {
      const path = join(ctx.root, "manuscript", `${target.id}.json`);
      const bytes = await referenceRead(path, 512 * 1024 ** 2);
      const hash = referenceHash(bytes);
      if (ctx.chapterHashes.has(path) && ctx.chapterHashes.get(path) !== hash)
        throw referenceError("REFERENCE_STALE");
      ctx.chapterHashes.set(path, hash);
      const raw = decodeReference(bytes);
      const chapter = ChapterFileSchema.safeParse(raw);
      return chapter.success && chapter.data.id === target.id
        ? "resolved"
        : "invalid";
    } catch (e) {
      if (e instanceof ApplicationError && e.code === "REFERENCE_STALE")
        throw e;
      if (isMissing(e))
        ctx.chapterHashes.set(
          join(ctx.root, "manuscript", `${target.id}.json`),
          null,
        );
      return isMissing(e) ? "missing" : "invalid";
    }
  }
  const invalid = store.invalid.get(target.id);
  if (invalid)
    return invalid === "REFERENCE_UNSUPPORTED" ? "unsupported" : "invalid";
  const entry = store.entries.find((e) => e.record.id === target.id);
  return !entry
    ? "missing"
    : entry.record.kind !== target.kind
      ? "invalid"
      : entry.record.deletedAt === null
        ? "resolved"
        : "deleted";
}
function find(store: Store, kind: ReferenceKind, id: string): Entry {
  const entry = store.entries.find(
    (e) => e.record.id === id && e.record.kind === kind,
  );
  if (!entry)
    throw referenceError(store.invalid.get(id) ?? "REFERENCE_MISSING");
  return entry;
}
async function unchanged(ctx: Context, store: Store): Promise<void> {
  if (
    referenceHash(await referenceRead(join(ctx.root, "project.json"))) !==
      ctx.manifestHash ||
    (await scan(ctx)).inventory !== store.inventory
  )
    throw referenceError("REFERENCE_STALE");
  for (const [path, hash] of ctx.chapterHashes) {
    let current: string | null = null;
    try {
      current = await referenceFingerprint(path);
    } catch (e) {
      if (!isMissing(e)) throw referenceError("REFERENCE_STALE");
    }
    if (current !== hash) throw referenceError("REFERENCE_STALE");
  }
}
interface CandidateData {
  summary: ReferenceCandidate;
  record?: ReferenceRecord;
  draft?: ReferenceDraft;
  bytes: Buffer;
  path: string;
}
async function candidates(
  ctx: Context,
): Promise<{ data: CandidateData[]; diagnostics: ReferenceDiagnostic[] }> {
  const data: CandidateData[] = [],
    diagnostics: ReferenceDiagnostic[] = [];
  let files = 0,
    total = 0;
  let visited = 0;
  const visit = () => {
    if (++visited > REFERENCE_LIMITS.files * 2)
      throw referenceError("REFERENCE_LIMIT");
  };
  async function add(
    path: string,
    source: ReferenceCandidateKey["source"],
    recordId: string,
    candidateId: string,
    kind?: ReferenceKind,
  ) {
    if (++files > REFERENCE_LIMITS.files)
      throw referenceError("REFERENCE_LIMIT");
    try {
      const bytes = await referenceRead(path, REFERENCE_LIMITS.draftBytes);
      total += bytes.length;
      if (total > REFERENCE_LIMITS.scanBytes)
        throw referenceError("REFERENCE_LIMIT");
      let record: ReferenceRecord | undefined,
        draft: ReferenceDraft | undefined;
      try {
        if (source === "draft") {
          const raw = decodeReference(bytes);
          version(raw);
          const parsed = ReferenceDraftSchema.safeParse(raw);
          if (
            !parsed.success ||
            parsed.data.draftId !== candidateId ||
            parsed.data.recordId !== recordId
          )
            throw referenceError();
          draft = parsed.data;
          record = draft.record;
        } else record = parseRecord(bytes);
        if (referenceBytes(record).length > REFERENCE_LIMITS.recordBytes)
          throw referenceError("REFERENCE_LIMIT");
        identity(record, ctx.project.projectId, recordId, kind);
      } catch {
        record = undefined;
        draft = undefined;
      }
      data.push({
        bytes,
        path,
        ...(record ? { record } : {}),
        ...(draft ? { draft } : {}),
        summary: {
          source,
          kind: record?.kind ?? kind ?? "note",
          recordId,
          candidateId,
          fingerprint: referenceHash(bytes),
          currentFingerprint: null,
          status: record
            ? source === "history"
              ? "historical"
              : "pending"
            : "invalid",
          ...(record ? { revision: record.revision } : {}),
        },
      });
    } catch (e) {
      diagnostics.push({ code: errorCode(e), id: recordId });
    }
  }
  try {
    for (const [source, directory] of [
      ["history", "history"],
      ["draft", "recovery"],
    ] as const) {
      for (const id of await referenceEntries(
        join(ctx.root, "reference", directory),
      )) {
        visit();
        if (!ReferenceIdSchema.safeParse(id).success) {
          diagnostics.push({ code: "REFERENCE_RECOVERY_INVALID" });
          continue;
        }
        for (const name of await referenceEntries(
          join(ctx.root, "reference", directory, id),
        )) {
          visit();
          const candidateId = name.slice(0, -5);
          if (
            !name.endsWith(".json") ||
            !ReferenceIdSchema.safeParse(candidateId).success
          ) {
            diagnostics.push({ code: "REFERENCE_RECOVERY_INVALID", id });
            continue;
          }
          await add(
            join(ctx.root, "reference", directory, id, name),
            source,
            id,
            candidateId,
          );
        }
      }
    }
    for (const [kind, directory] of Object.entries(REFERENCE_DIRECTORIES) as [
      ReferenceKind,
      string,
    ][]) {
      for (const name of await referenceEntries(
        join(ctx.root, "reference", directory),
      )) {
        visit();
        if (!name.endsWith(".tmp")) continue;
        const [id, candidateId] = name.split(".");
        if (
          !ReferenceIdSchema.safeParse(id).success ||
          !ReferenceIdSchema.safeParse(candidateId).success
        ) {
          diagnostics.push({ code: "REFERENCE_RECOVERY_INVALID" });
          continue;
        }
        await add(
          join(ctx.root, "reference", directory, name),
          "temporary",
          id!,
          candidateId!,
          kind,
        );
      }
    }
  } catch (e) {
    diagnostics.push({ code: errorCode(e) });
  }
  const history = new Set(
    data
      .filter((d) => d.summary.source === "history" && d.record)
      .map((d) => referenceHash(d.bytes)),
  );
  const liveHashes = new Map<string, string | null>();
  for (const item of data) {
    if (!item.record) continue;
    const hash = referenceHash(referenceBytes(item.record));
    const path = join(
      ctx.root,
      "reference",
      REFERENCE_DIRECTORIES[item.record.kind],
      `${item.record.id}.json`,
    );
    try {
      if (!liveHashes.has(path))
        liveHashes.set(path, await referenceFingerprint(path));
      item.summary.currentFingerprint = liveHashes.get(path) ?? null;
    } catch (e) {
      if (isMissing(e)) liveHashes.set(path, null);
      else diagnostics.push({ code: errorCode(e), id: item.record.id });
    }
    if (
      item.summary.source !== "history" &&
      (item.summary.currentFingerprint === hash || history.has(hash))
    )
      item.summary.status = "committed";
  }
  return { data, diagnostics };
}
async function validateLinks(
  ctx: Context,
  store: Store,
  record: ReferenceRecord,
  previous?: ReferenceRecord,
  recovery = false,
): Promise<void> {
  const elsewhere = new Set(
    store.entries
      .filter((e) => e.record.id !== record.id)
      .flatMap((e) => e.record.links.map((l) => l.id)),
  );
  for (const link of record.links) {
    if (elsewhere.has(link.id)) throw referenceError("REFERENCE_DUPLICATE");
    const old = previous?.links.find((l) => l.id === link.id);
    const retained =
      old &&
      old.target.id === link.target.id &&
      old.target.kind === link.target.kind;
    if (
      !retained &&
      !recovery &&
      (await targetStatus(ctx, store, link.target)) !== "resolved"
    )
      throw referenceError("REFERENCE_TARGET_INVALID");
  }
}
function prepare(
  content: ReferenceInput,
  projectId: string,
  previous?: ReferenceRecord,
): ReferenceRecord {
  const input = ReferenceInputSchema.safeParse(content);
  if (!input.success || (previous && previous.kind !== input.data.kind))
    throw referenceError("REFERENCE_INPUT_INVALID");
  const now = createIsoDate();
  const modified =
    previous && previous.modified > now ? previous.modified : now;
  const links = input.data.links.map((link) => {
    if (link.id && !previous?.links.some((old) => old.id === link.id))
      throw referenceError("REFERENCE_INPUT_INVALID");
    return { ...link, id: link.id ?? createUuid() };
  });
  return checkedRecord({
    ...input.data,
    links,
    schemaVersion: 1,
    projectId,
    id: previous?.id ?? createUuid(),
    created: previous?.created ?? modified,
    modified,
    revision: (previous?.revision ?? 0) + 1,
    deletedAt: null,
  });
}
function checkedRecord(raw: unknown): ReferenceRecord {
  const parsed = ReferenceRecordSchema.safeParse(raw);
  if (
    !parsed.success ||
    referenceBytes(parsed.data).length > REFERENCE_LIMITS.recordBytes
  )
    throw referenceError("REFERENCE_INPUT_INVALID");
  return parsed.data;
}
async function commit(
  ctx: Context,
  store: Store,
  record: ReferenceRecord,
  previous: Entry | undefined,
  generation: number,
  options: ReferenceWriteOptions,
  recoveryBase?: {
    path: string;
    hash: string | null;
    candidatePath: string;
    candidateHash: string;
  },
): Promise<ReferenceResponse> {
  const directory = await referenceDirectory(ctx.root, [
    "reference",
    REFERENCE_DIRECTORIES[record.kind],
  ]);
  const path = join(directory, `${record.id}.json`),
    bytes = referenceBytes(record);
  assertReferenceActive(options);
  if (!recoveryBase) {
    await options.checkpoint?.("before-draft");
    const draftId = createUuid();
    const draft = ReferenceDraftSchema.parse({
      schemaVersion: 1,
      projectId: ctx.project.projectId,
      recordId: record.id,
      draftId,
      captured: createIsoDate(),
      generation,
      baseRevision: previous?.record.revision ?? null,
      baseSha256: previous?.fingerprint ?? null,
      record,
    });
    const drafts = await referenceDirectory(ctx.root, [
      "reference",
      "recovery",
      record.id,
    ]);
    await referenceExclusive(
      join(drafts, `${draftId}.json`),
      referenceBytes(draft),
    );
    await options.checkpoint?.("after-draft");
  }
  if (previous) {
    const history = await referenceDirectory(ctx.root, [
      "reference",
      "history",
      record.id,
    ]);
    await referenceExclusive(
      join(history, `${createUuid()}.json`),
      previous.bytes,
    );
    await options.checkpoint?.("after-snapshot");
  }
  const warning = await publishReference(
    path,
    bytes,
    !previous && !recoveryBase?.hash,
    async () => {
      await unchanged(ctx, store);
      await validateLinks(
        ctx,
        store,
        record,
        previous?.record,
        Boolean(recoveryBase),
      );
      if (recoveryBase) {
        if (
          (await referenceFingerprint(recoveryBase.candidatePath)) !==
          recoveryBase.candidateHash
        )
          throw referenceError("REFERENCE_STALE");
        let current: string | null = null;
        try {
          current = await referenceFingerprint(recoveryBase.path);
        } catch (e) {
          if (!isMissing(e)) throw e;
        }
        if (current !== recoveryBase.hash)
          throw referenceError("REFERENCE_STALE");
      } else if (
        previous &&
        referenceHash(await referenceRead(path)) !== previous.fingerprint
      )
        throw referenceError("REFERENCE_STALE");
      assertReferenceActive(options);
    },
    options,
  );
  return {
    type: "record",
    value: { record, fingerprint: referenceHash(bytes) },
    ...(warning ? { warning } : {}),
  };
}

/** One restricted operation boundary, used by typed IPC and independent local consumers. */
export async function executeReferenceOperation(
  input: { projectPath: string; request: ReferenceRequest },
  options: ReferenceWriteOptions = {},
): Promise<ReferenceResponse> {
  try {
    // Bound transport work before recursive validation or path access.
    if (
      Buffer.byteLength(JSON.stringify(input.request)) >
      REFERENCE_LIMITS.draftBytes
    )
      throw referenceError("REFERENCE_LIMIT");
    const parsed = ReferenceRequestSchema.safeParse(input.request);
    if (!parsed.success) throw referenceError("REFERENCE_INPUT_INVALID");
    const request = parsed.data;
    if (
      "content" in request &&
      !ReferenceInputSchema.safeParse(request.content).success
    )
      throw referenceError("REFERENCE_INPUT_INVALID");
    return await withReferenceLock<ReferenceResponse>(
      input.projectPath,
      async (root) => {
        assertReferenceActive(options);
        const ctx = await context(root, request.projectId),
          store = await scan(ctx);
        if (request.operation === "list") {
          const entries = store.entries.filter(
            (e) => request.includeDeleted || e.record.deletedAt === null,
          );
          entries.sort((a, b) => {
            const x = "name" in a.record ? a.record.name : a.record.title,
              y = "name" in b.record ? b.record.name : b.record.title;
            const left = Array.from(x, (c) => c.codePointAt(0)!),
              right = Array.from(y, (c) => c.codePointAt(0)!);
            for (let i = 0; i < Math.min(left.length, right.length); i++) {
              if (left[i] !== right[i]) return left[i]! - right[i]!;
            }
            return (
              left.length - right.length ||
              a.record.id.localeCompare(b.record.id)
            );
          });
          await unchanged(ctx, store);
          return {
            type: "list",
            records: entries.map(({ record: r }) => ({
              id: r.id,
              kind: r.kind,
              title: "name" in r ? r.name : r.title,
              revision: r.revision,
              deletedAt: r.deletedAt,
            })),
            diagnostics: store.diagnostics,
            readOnly: store.diagnostics.length > 0,
          };
        }
        if (request.operation === "read") {
          const e = find(store, request.kind, request.id);
          await unchanged(ctx, store);
          return {
            type: "record",
            value: { record: e.record, fingerprint: e.fingerprint },
          };
        }
        if (request.operation === "links") {
          const incoming: ReferenceEdge[] = [],
            outgoing: ReferenceEdge[] = [];
          for (const e of store.entries) {
            if (!request.includeDeleted && e.record.deletedAt !== null)
              continue;
            for (const link of e.record.links) {
              const edge: ReferenceEdge = {
                sourceId: e.record.id,
                sourceKind: e.record.kind,
                link,
                status: await targetStatus(ctx, store, link.target),
              };
              if (
                link.target.id === request.target.id &&
                link.target.kind === request.target.kind
              )
                incoming.push(edge);
              if (
                e.record.id === request.target.id &&
                e.record.kind === request.target.kind
              )
                outgoing.push(edge);
            }
          }
          await unchanged(ctx, store);
          return {
            type: "links",
            incoming,
            outgoing,
            diagnostics: store.diagnostics,
          };
        }
        const recovery = await candidates(ctx);
        if (request.operation === "recovery-list")
          return {
            type: "recovery",
            candidates: recovery.data.map((d) => d.summary),
            diagnostics: recovery.diagnostics,
          };
        if (
          request.operation === "recovery-read" ||
          request.operation === "recovery-discard" ||
          request.operation === "recovery-apply"
        ) {
          const selected = recovery.data.find((d) =>
            Object.entries(request.candidate).every(
              ([k, v]) => d.summary[k as keyof ReferenceCandidate] === v,
            ),
          );
          if (!selected || selected.summary.fingerprint !== request.fingerprint)
            throw referenceError("REFERENCE_STALE");
          if (request.operation === "recovery-discard") {
            if (selected.summary.source === "history")
              throw referenceError("REFERENCE_INPUT_INVALID");
            assertReferenceActive(options);
            if (
              referenceHash(
                await referenceRead(selected.path, REFERENCE_LIMITS.draftBytes),
              ) !== request.fingerprint
            )
              throw referenceError("REFERENCE_STALE");
            await unlink(selected.path);
            return { type: "discarded" };
          }
          if (!selected.record)
            throw referenceError("REFERENCE_RECOVERY_INVALID");
          if (request.operation === "recovery-read")
            return {
              type: "record",
              value: {
                record: selected.record,
                fingerprint: selected.summary.fingerprint,
              },
            };
          if (
            recovery.diagnostics.length ||
            store.diagnostics.some((d) => d.id !== selected.record!.id) ||
            [
              "REFERENCE_UNSUPPORTED",
              "REFERENCE_DUPLICATE",
              "REFERENCE_IDENTITY_INVALID",
            ].includes(store.invalid.get(selected.record.id) ?? "") ||
            recovery.data.some(
              (d) =>
                d.record?.id === selected.record!.id &&
                d.record.kind !== selected.record!.kind,
            )
          )
            throw referenceError("REFERENCE_READ_ONLY");
          const path = join(
            root,
            "reference",
            REFERENCE_DIRECTORIES[selected.record.kind],
            `${selected.record.id}.json`,
          );
          let current: string | null = null;
          try {
            current = await referenceFingerprint(path);
          } catch (e) {
            if (!isMissing(e)) throw e;
          }
          if (current !== request.expectedFingerprint)
            throw referenceError("REFERENCE_STALE");
          const previous = store.entries.find(
            (e) => e.record.id === selected.record!.id,
          );
          if (previous && previous.record.kind !== selected.record.kind)
            throw referenceError("REFERENCE_IDENTITY_INVALID");
          if (current && !previous) {
            // Never convert future/unsupported envelopes through a repair path.
            try {
              const raw = decodeReference(await referenceRead(path));
              version(raw);
              const parsed = ReferenceRecordSchema.safeParse(raw);
              if (
                !parsed.success &&
                parsed.error.issues.some((i) => i.code === "unrecognized_keys")
              )
                throw referenceError("REFERENCE_UNSUPPORTED");
            } catch (e) {
              if (
                e instanceof ApplicationError &&
                ["REFERENCE_UNSUPPORTED", "REFERENCE_LIMIT"].includes(e.code)
              )
                throw e;
            }
            const preserved = await referenceDirectory(root, [
              "reference",
              "preserved",
              selected.record.id,
            ]);
            await preserveReferenceBytes(
              path,
              join(preserved, `${createUuid()}.bin`),
              current,
            );
          }
          const maximum =
            previous?.record.revision ??
            Math.max(
              0,
              ...recovery.data
                .filter((d) => d.record?.id === selected.record!.id)
                .map((d) => d.record!.revision),
            );
          const now = createIsoDate();
          const record = checkedRecord({
            ...selected.record,
            created: previous?.record.created ?? selected.record.created,
            modified: [
              now,
              selected.record.modified,
              previous?.record.modified ?? now,
            ]
              .sort()
              .at(-1),
            revision: maximum + 1,
          });
          await validateLinks(ctx, store, record, previous?.record, true);
          return commit(ctx, store, record, previous, 1, options, {
            path,
            hash: request.expectedFingerprint,
            candidatePath: selected.path,
            candidateHash: request.fingerprint,
          });
        }
        if (ctx.project.schemaVersion !== 2)
          throw referenceError("REFERENCE_MIGRATION_REQUIRED");
        if (store.diagnostics.length)
          throw referenceError("REFERENCE_READ_ONLY");
        if (request.operation !== "create") {
          const current = find(store, request.kind, request.id);
          if (
            current.record.revision !== request.expectedRevision ||
            current.fingerprint !== request.expectedFingerprint
          )
            throw referenceError("REFERENCE_STALE");
        }
        if (
          recovery.diagnostics.length ||
          recovery.data.some(
            (d) =>
              d.summary.status === "pending" || d.summary.status === "invalid",
          )
        )
          throw referenceError("REFERENCE_RECOVERY_REQUIRED");
        let previous: Entry | undefined, record: ReferenceRecord;
        if (request.operation === "create")
          record = prepare(request.content, ctx.project.projectId);
        else {
          previous = find(store, request.kind, request.id);
          if (
            previous.record.revision !== request.expectedRevision ||
            previous.fingerprint !== request.expectedFingerprint
          )
            throw referenceError("REFERENCE_STALE");
          if (request.operation === "update") {
            if (previous.record.deletedAt !== null)
              throw referenceError("REFERENCE_DELETED");
            record = prepare(
              request.content,
              ctx.project.projectId,
              previous.record,
            );
          } else {
            if (
              (request.operation === "delete") !==
              (previous.record.deletedAt === null)
            )
              throw referenceError("REFERENCE_STATE_INVALID");
            const modified = [createIsoDate(), previous.record.modified]
              .sort()
              .at(-1)!;
            record = checkedRecord({
              ...previous.record,
              modified,
              revision: previous.record.revision + 1,
              deletedAt: request.operation === "delete" ? modified : null,
            });
          }
        }
        if (
          !previous &&
          (store.entries.some((e) => e.record.id === record.id) ||
            recovery.data.some((d) => d.summary.recordId === record.id))
        )
          throw referenceError("REFERENCE_DUPLICATE");
        await validateLinks(ctx, store, record, previous?.record);
        return commit(
          ctx,
          store,
          record,
          previous,
          request.generation,
          options,
        );
      },
    );
  } catch (e) {
    if (
      e instanceof ApplicationError &&
      (e.code.startsWith("REFERENCE_") || e.code === "PROJECT_BUSY")
    )
      throw e;
    throw referenceError("REFERENCE_FAILED");
  }
}

/** Archive uses its own fixed inventory; do not omit unwrapped recovery bytes. */
export async function assertReferenceBackupReady(
  root: string,
  projectId: string,
): Promise<void> {
  const recovery = await candidates(await context(root, projectId));
  if (
    recovery.diagnostics.length ||
    recovery.data.some((d) => d.summary.source === "temporary")
  )
    throw referenceError("REFERENCE_RECOVERY_REQUIRED");
}
/** Read-only report; the caller holds the project operation lock. */
export async function referenceBackupDiagnostics(
  root: string,
  projectId: string,
): Promise<ReferenceDiagnostic[]> {
  return (await scan(await context(root, projectId))).diagnostics;
}
export type { ReferenceWriteOptions } from "./reference-files.js";
