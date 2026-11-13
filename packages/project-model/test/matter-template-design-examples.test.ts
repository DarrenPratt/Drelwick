// Documentation conformance only: no production template API or importer.
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { z } from "zod";
import { MatterPageRequestSchema } from "@drelwick/shared";
import {
  ManuscriptDocumentSchema,
  PublicationSchema,
  parseEditorialJson,
} from "../src/index.js";

const uuid = z.string().uuid();
const binding = z
  .object({
    path: z.array(z.number().int().nonnegative()).min(1).max(32),
    key: z.enum([
      "book.title",
      "book.author",
      "book.language",
      "book.description",
      "identity.name",
      "identity.biography",
      "input.copyrightYear",
      "input.rightsHolder",
    ]),
  })
  .strict();
const page = MatterPageRequestSchema.extend({
  bindings: z.array(binding).max(1000),
});
const entry = z
  .object({
    id: uuid,
    revisionId: uuid,
    name: z.string().min(1).max(200),
    description: z.string().max(2000),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    kind: z.enum(["page", "collection"]),
    pages: z.array(page).min(1).max(100),
  })
  .strict();
const portable = z
  .object({
    format: z.literal("drelwick-matter"),
    schemaVersion: z.literal(1),
    entries: z.array(entry).min(1).max(100),
    identities: z
      .array(
        z
          .object({
            id: uuid,
            label: z.string().min(1).max(200),
            name: z.string().min(1).max(500),
            biography: z.string().max(20000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
type Example = z.infer<typeof portable>;
type Node = { type?: string; text?: string; content?: Node[] };
const unique = (ids: string[]) => {
  if (new Set(ids.map((id) => id.toLowerCase())).size !== ids.length)
    throw new Error("Duplicate identity");
};
function leaf(document: unknown, path: number[]): Node {
  let node = document as Node;
  for (const index of path) {
    const next = node.content?.[index];
    if (!next) throw new Error("Invalid binding path");
    node = next;
  }
  if (node.type !== "text") throw new Error("Binding must target text");
  return node;
}
function check(input: unknown): Example {
  const value = portable.parse(input);
  unique(value.entries.map((e) => e.id));
  unique(value.identities.map((i) => i.id));
  for (const e of value.entries) {
    if (e.updatedAt < e.createdAt) throw new Error("Invalid timestamp order");
    if (e.kind === "page" && e.pages.length !== 1)
      throw new Error("Page cardinality");
    unique(e.pages.map((p) => p.id));
    let back = false;
    for (const p of e.pages) {
      if (p.placement === "front" && back) throw new Error("Collection order");
      back ||= p.placement === "back";
      ManuscriptDocumentSchema.parse(p.document);
      const walk = (node: Node, depth: number) => {
        if (depth > 32 || node.type === "image")
          throw new Error("Unsupported template document");
        node.content?.forEach((child) => walk(child, depth + 1));
      };
      walk(p.document, 0);
      unique(p.bindings.map((b) => JSON.stringify(b.path)));
      p.bindings.forEach((b) => leaf(p.document, b.path));
    }
  }
  return value;
}
const load = async () =>
  check(
    parseEditorialJson(
      await readFile(
        new URL(
          "../../../docs/examples/matter-templates-v1/examples.drelwick-matter.json",
          import.meta.url,
        ),
      ),
    ),
  );
const metadata = {
  title: "The Lantern Road",
  author: "Publication Author",
  language: "en-GB",
  description: "A synthetic novel.",
  identifiers: [],
};
function resolve(
  e: Example["entries"][number],
  identity: Example["identities"][number],
) {
  const values: Record<string, string> = {
    "book.title": metadata.title,
    "book.author": metadata.author,
    "book.language": metadata.language,
    "book.description": metadata.description,
    "identity.name": identity.name,
    "identity.biography": identity.biography,
    "input.copyrightYear": "2026",
    "input.rightsHolder": identity.name,
  };
  return e.pages.map((p, index) => {
    const { bindings, ...copy } = structuredClone(p);
    bindings.forEach((b) => {
      const value = values[b.key];
      if (!value) throw new Error("Unresolved value");
      leaf(copy.document, b.path).text = value;
    });
    return {
      ...copy,
      id: `00000000-0000-4000-8000-${String(900 + index).padStart(12, "0")}`,
    };
  });
}
const text = (node: Node): string =>
  node.text ?? node.content?.map(text).join("") ?? "";

it("M01 validates five individual types and an ordered self-contained collection", async () => {
  const value = await load();
  expect(value.entries.slice(0, 5).map((e) => e.pages[0]?.type)).toEqual([
    "title",
    "copyright",
    "dedication",
    "acknowledgements",
    "author",
  ]);
  expect(value.entries[5]?.pages.map((p) => p.placement)).toEqual([
    "front",
    "front",
    "front",
    "back",
    "back",
  ]);
  expect(value.entries[5]?.pages.map((p) => p.type)).toEqual(
    value.entries.slice(0, 5).map((e) => e.pages[0]?.type),
  );
});
it("M02 resolves both pen names and book metadata into unchanged publication v1", async () => {
  const value = await load();
  const before = JSON.stringify(value);
  for (const identity of value.identities)
    for (const e of value.entries) {
      const pages = resolve(e, identity);
      const result = PublicationSchema.parse({
        schemaVersion: 1,
        projectId: "00000000-0000-4000-8000-000000000999",
        metadata,
        pages,
        body: [],
      });
      expect(
        result.pages.every(
          (p) => !e.pages.some((source) => source.id === p.id),
        ),
      ).toBe(true);
      expect(result.pages.every((p) => !("bindings" in p))).toBe(true);
      const all = pages.map((p) => text(p.document)).join("\n");
      if (e.pages.some((p) => p.type === "title"))
        expect(all).toContain(`The Lantern Road${identity.name}`);
      if (e.pages.some((p) => p.type === "copyright"))
        expect(all).toContain(`Copyright © 2026 ${identity.name}.`);
      if (e.pages.some((p) => p.type === "author"))
        expect(all).toContain(identity.biography);
      pages[0]!.title = "Independent edit";
    }
  expect(JSON.stringify(value)).toBe(before);
});
it("M03 rejects unsupported versions, executable fields, duplicate IDs and invalid references", async () => {
  const source = await load();
  const mutations: ((v: Example) => unknown)[] = [
    (v) => ({ ...v, schemaVersion: 2 }),
    (v) => ({ ...v, html: "<script>active()</script>" }),
    (v) => {
      v.entries[1]!.id = v.entries[0]!.id;
      return v;
    },
    (v) => {
      v.entries[0]!.pages[0]!.bindings[0]!.path = [99, 0];
      return v;
    },
    (v) => {
      v.entries[0]!.pages[0]!.bindings[0]!.path = [0];
      return v;
    },
    (v) => {
      v.entries[0]!.pages[0]!.bindings.push(
        v.entries[0]!.pages[0]!.bindings[0]!,
      );
      return v;
    },
    (v) => {
      v.entries[0]!.pages[0]!.document = {
        type: "doc",
        content: [{ type: "script" }],
      };
      return v;
    },
    (v) => {
      v.entries[0]!.pages[0]!.document = {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              assetId: "00000000-0000-4000-8000-000000000001",
              alt: "image",
              size: "medium",
            },
          },
        ],
      };
      return v;
    },
    (v) => ({
      ...v,
      entries: [
        {
          ...v.entries[0],
          pages: [
            {
              ...v.entries[0]!.pages[0],
              bindings: [{ path: [0, 0], key: "process.env.SECRET" }],
            },
          ],
        },
      ],
    }),
    (v) => {
      v.entries[5]!.pages.reverse();
      return v;
    },
  ];
  mutations.forEach((mutate) =>
    expect(() => check(mutate(structuredClone(source)))).toThrow(),
  );
  expect(() =>
    parseEditorialJson(Buffer.from('{"schemaVersion":1,"schemaVersion":2}')),
  ).toThrow();
});
it("M04 treats hostile-looking substitutions as literal semantic text", async () => {
  const value = await load();
  const identity = {
    ...value.identities[0]!,
    name: "<script>${book.title}</script> & {{x}}",
  };
  const pages = resolve(value.entries[0]!, identity);
  expect(text(pages[0]!.document)).toContain(identity.name);
  expect(
    PublicationSchema.safeParse({
      schemaVersion: 1,
      projectId: "00000000-0000-4000-8000-000000000999",
      metadata,
      pages,
      body: [],
    }).success,
  ).toBe(true);
});
