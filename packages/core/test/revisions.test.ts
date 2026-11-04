import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  decodeEditorialDocument,
  revisionDocumentHash,
  validateRevisionReview,
} from "@drelwick/project-model";
import {
  normalizeRevision,
  planRevisionReview,
  type RevisionState,
} from "../src/revisions.js";
const doc = (text: string, marks?: { type: string }[]) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
    },
  ],
});
const initial = (mode: "track" | "off" = "track"): RevisionState => ({
  content: doc("red fox"),
  review: { schemaVersion: 1, mode, proposed: doc("red fox"), pending: [] },
});
let counter = 0;
const options = () => ({
  id: `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  created: "2026-11-03T00:00:00.000Z",
  authorLabel: null,
});
it("uses the exact canonical-json-v1 SHA-256 codec in Node and the renderer-safe adapter", () => {
  expect(revisionDocumentHash({ b: 2, a: "👩‍💻" })).toBe(
    createHash("sha256").update('{"a":"👩‍💻","b":2}').digest("hex"),
  );
});
it("R01/R02 previews and explicitly combines touching edits, preserving old identities until consent", () => {
  const original = initial(),
    inserted = normalizeRevision(original, doc("red quick fox"), options());
  expect(inserted.state.review.pending[0]).toMatchObject({
    kind: "insert",
    from: 5,
    to: 5,
    supersedes: [],
  });
  const next = normalizeRevision(
    inserted.state,
    doc("red quicker fox"),
    options(),
  );
  expect(next.requiresCombine).toBe(true);
  expect(next.affectedIds).toEqual([inserted.state.review.pending[0]!.id]);
  expect(original.review.pending).toEqual([]);
  expect(inserted.state.review.proposed).toEqual(doc("red quick fox"));
  const approved = normalizeRevision(inserted.state, doc("red quicker fox"), {
    ...options(),
    combineIds: next.affectedIds,
  });
  expect(approved.state.review.pending[0]!.supersedes).toEqual(
    next.affectedIds,
  );
  expect(
    planRevisionReview(
      approved.state,
      [approved.state.review.pending[0]!.id],
      "reject",
    ).state,
  ).toEqual(original);
});
it.each(["insert", "delete", "replace", "format"] as const)(
  "R03/R05 %s round-trips through accept/reject",
  (kind) => {
    const next =
      kind === "insert"
        ? doc("red quick fox")
        : kind === "delete"
          ? doc("red ")
          : kind === "replace"
            ? doc("red dog")
            : doc("red fox", [{ type: "bold" }]);
    const plan = normalizeRevision(initial(), next, options());
    expect(plan.state.review.pending[0]!.kind).toBe(kind);
    const accepted = planRevisionReview(
      plan.state,
      [plan.state.review.pending[0]!.id],
      "accept",
    );
    const rejected = planRevisionReview(
      plan.state,
      [plan.state.review.pending[0]!.id],
      "reject",
    );
    expect(
      decodeEditorialDocument(accepted.state.content).eq(
        decodeEditorialDocument(next),
      ),
    ).toBe(true);
    expect(rejected.state).toEqual(initial());
  },
);
it("R03 keeps independent patches valid in either decision order", () => {
  const first = normalizeRevision(initial(), doc("RED fox"), options()).state;
  const second = normalizeRevision(first, doc("RED fox!"), options());
  expect(second.requiresCombine).toBe(false);
  const [a, b] = second.state.review.pending.map((group) => group.id);
  const left = planRevisionReview(
    planRevisionReview(second.state, [a!], "accept").state,
    [b!],
    "reject",
  ).state;
  const right = planRevisionReview(
    planRevisionReview(second.state, [b!], "reject").state,
    [a!],
    "accept",
  ).state;
  expect(left).toEqual(right);
  expect(left.content).toEqual(doc("RED fox"));
});
it("R04 tracking-off changes update both projections only when disjoint", () => {
  const tracked = normalizeRevision(
    initial(),
    doc("red quick fox"),
    options(),
  ).state;
  tracked.review.mode = "off";
  const collision = normalizeRevision(
    tracked,
    doc("red quicker fox"),
    options(),
  );
  expect(collision.requiresCombine).toBe(true);
  const ordinary = normalizeRevision(tracked, doc("RED quick fox"), options());
  expect(ordinary.requiresCombine).toBe(false);
  expect(ordinary.state.content).toEqual(doc("RED fox"));
  expect(ordinary.state.review.pending).toHaveLength(1);
  validateRevisionReview(ordinary.state.content, ordinary.state.review);
});

it.each([
  {
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "red fox" }],
  },
  { type: "blockquote", content: doc("red fox").content },
  {
    type: "bulletList",
    content: [{ type: "listItem", content: doc("red fox").content }],
  },
  {
    type: "epigraph",
    attrs: { attribution: "Synthetic attribution" },
    content: doc("red fox").content[0] ? [doc("red fox").content[0]!] : [],
  },
  { type: "sceneBreak" },
  {
    type: "image",
    attrs: {
      assetId: "00000000-0000-4000-8000-000000000089",
      alt: "Synthetic original",
      size: "medium",
    },
  },
])(
  "R03/R05 exact semantic $type patches accept/reject without source mutation",
  (node) => {
    const original = initial(),
      before = structuredClone(original),
      next = { type: "doc", content: [node] };
    const plan = normalizeRevision(original, next, options());
    const ids = plan.state.review.pending.map((group) => group.id);
    expect(planRevisionReview(plan.state, ids, "accept").state.content).toEqual(
      decodeEditorialDocument(next).toJSON(),
    );
    expect(planRevisionReview(plan.state, ids, "reject").state).toEqual(before);
    expect(original).toEqual(before);
  },
);
