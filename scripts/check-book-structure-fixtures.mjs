// Documentation-only proposal checks; not a production schema or project loader.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const defaults = { ebook: true, print: true, navigation: true };
const names = [
  "single-novel",
  "multipart-novel",
  "multivolume-novel",
  "edition-variants",
];
const fixtures = [];
const unique = (values) =>
  assert.equal(new Set(values.map((v) => v.toLowerCase())).size, values.length);
const keys = (value, allowed) =>
  assert(Object.keys(value).every((key) => allowed.includes(key)));
const flags = (value) => {
  keys(value, Object.keys(defaults));
  assert(Object.values(value).every((v) => typeof v === "boolean"));
};

function validate(fixture) {
  assert.equal(fixture.proposedDesign, true);
  const s = fixture.structure;
  keys(s, [
    "schemaVersion",
    "projectId",
    "revision",
    "roots",
    "nodes",
    "numbering",
  ]);
  assert.equal(s.schemaVersion, 1);
  assert.equal(s.projectId, fixture.projectId);
  assert(uuid.test(s.projectId));
  assert(Number.isSafeInteger(s.revision) && s.revision > 0);
  assert(Buffer.byteLength(JSON.stringify(s)) <= 8 * 1024 ** 2);
  assert(s.nodes.length <= 12000);
  assert(s.nodes.filter((n) => n.type !== "chapter").length <= 2000);
  assert(fixture.chapterCatalogue.length <= 10000);
  assert(
    ["continuous", "per-part", "per-volume", "none"].includes(
      s.numbering.chapters,
    ),
  );
  for (const kind of ["parts", "volumes"])
    assert(["arabic", "roman", "none"].includes(s.numbering[kind]));
  unique(s.nodes.map((n) => n.id));
  unique(fixture.manifestOrder);
  unique(fixture.chapterCatalogue.map((n) => n.id));
  assert.deepEqual(
    new Set(fixture.manifestOrder),
    new Set(fixture.chapterCatalogue.map((n) => n.id)),
  );
  const nodes = new Map(s.nodes.map((n) => [n.id, n]));
  const chapters = new Map(fixture.chapterCatalogue.map((n) => [n.id, n]));
  const contentIds = [
    ...chapters.keys(),
    ...fixture.publication.pages.map((p) => p.id),
  ];
  unique([...nodes.keys(), ...contentIds]);
  assert(contentIds.every((id) => uuid.test(id)));
  const seen = new Set(),
    traversal = [];
  const stack = s.roots
    .toReversed()
    .map((id) => ({ id, parent: "book", depth: 1 }));
  while (stack.length) {
    const { id, parent, depth } = stack.pop();
    assert(depth <= 3 && uuid.test(id));
    assert(!seen.has(id), "cycle or repeated ownership");
    seen.add(id);
    const n = nodes.get(id);
    assert(n, "missing node");
    const allowed =
      parent === "book"
        ? ["volume", "part", "chapter"]
        : parent === "volume"
          ? ["part", "chapter"]
          : ["chapter"];
    assert(allowed.includes(n.type), "invalid parent-child relationship");
    if (n.type === "chapter") {
      keys(n, ["id", "type", "chapterId", "numbering"]);
      assert(chapters.has(n.chapterId), "missing chapter");
      assert([undefined, "inherit", "none", "counted"].includes(n.numbering));
      traversal.push(n.chapterId);
    } else {
      keys(n, [
        "id",
        "type",
        "title",
        "subtitle",
        "children",
        "display",
        "inclusion",
      ]);
      assert(
        typeof n.title === "string" &&
          n.title.trim().length &&
          n.title.length <= 500,
      );
      assert(
        n.subtitle === undefined ||
          (typeof n.subtitle === "string" && n.subtitle.length <= 500),
      );
      if (n.inclusion) flags(n.inclusion);
      if (n.display) {
        keys(n.display, ["opening", "label", "start", "pageReset"]);
        assert(
          [undefined, "page", "inline", "none"].includes(n.display.opening),
        );
        assert([undefined, true, false].includes(n.display.label));
        assert([undefined, "next", "recto"].includes(n.display.start));
        assert(
          [undefined, "continue", "arabic-one"].includes(n.display.pageReset),
        );
        assert(n.display.pageReset === undefined || n.type === "volume");
      }
      unique(n.children);
      stack.push(
        ...n.children
          .toReversed()
          .map((id) => ({ id, parent: n.type, depth: depth + 1 })),
      );
    }
  }
  assert.equal(seen.size, nodes.size, "unreachable node");
  assert.deepEqual(traversal, fixture.manifestOrder, "manifest equality");
  assert.equal(fixture.publication.projectId, fixture.projectId);
  assert.equal(fixture.publication.schemaVersion, 1);
  unique(
    [...fixture.publication.pages, ...fixture.publication.body].map(
      (p) => p.id,
    ),
  );
  for (const p of fixture.publication.pages) {
    assert(["front", "back"].includes(p.placement));
    flags(p.inclusion);
  }
  for (const p of fixture.publication.body) {
    assert(chapters.has(p.id));
    flags(p.inclusion);
  }
  if (fixture.editions) {
    keys(fixture.editions, [
      "schemaVersion",
      "projectId",
      "revision",
      "editions",
    ]);
    assert.equal(fixture.editions.schemaVersion, 1);
    assert(
      Number.isSafeInteger(fixture.editions.revision) &&
        fixture.editions.revision > 0,
    );
    assert.equal(fixture.editions.projectId, fixture.projectId);
    const editions = fixture.editions.editions;
    assert(editions.length <= 100);
    unique(editions.map((e) => e.id));
    for (const e of editions) {
      keys(e, ["id", "name", "parentId", "overrides"]);
      assert(uuid.test(e.id) && e.name.trim());
      assert(e.name.length <= 200 && e.overrides.length <= 12500);
      unique(e.overrides.map((o) => o.id));
      for (const o of e.overrides) {
        keys(o, ["id", "inclusion"]);
        assert(
          [...nodes.values()].some(
            (n) => n.type !== "chapter" && n.id === o.id,
          ) || contentIds.includes(o.id),
        );
        flags(o.inclusion);
      }
      editionChain(fixture, e.id);
    }
  }
  return traversal;
}

function editionChain(f, id) {
  const chain = [];
  while (id) {
    assert(
      !chain.some((e) => e.id === id) && chain.length < 4,
      "edition cycle/depth",
    );
    const e = f.editions?.editions.find((e) => e.id === id);
    assert(e, "missing edition");
    chain.unshift(e);
    id = e.parentId;
  }
  return chain;
}

function plan(f, target, selectionId) {
  const nodes = new Map(f.structure.nodes.map((n) => [n.id, n]));
  const chain = editionChain(f, selectionId);
  const resolved = (id, base = defaults) =>
    chain.reduce(
      (v, e) => ({ ...v, ...e.overrides.find((o) => o.id === id)?.inclusion }),
      { ...defaults, ...base },
    );
  const items = [],
    navigation = [],
    chapterNumbers = [],
    counters = new Map();
  const matter = (placement) => {
    for (const p of f.publication.pages.filter(
      (p) => p.placement === placement,
    )) {
      const flags = resolved(p.id, p.inclusion);
      if (!flags[target]) continue;
      items.push(p.id);
      if (flags.navigation) navigation.push({ id: p.id, parent: null });
    }
  };
  const visit = (ids, ancestors, navParent) => {
    let included = 0;
    for (const id of ids) {
      const n = nodes.get(id);
      const flags = resolved(
        n.chapterId ?? id,
        n.type === "chapter"
          ? f.publication.body.find((p) => p.id === n.chapterId)?.inclusion
          : n.inclusion,
      );
      if (!flags[target]) continue;
      if (n.type !== "chapter") {
        if ((n.display?.opening ?? "page") === "page")
          items.push(`structure-${id}-opening`);
        if (flags.navigation) navigation.push({ id, parent: navParent });
        const children = visit(
          n.children,
          [...ancestors, n],
          flags.navigation ? id : navParent,
        );
        assert(children > 0, "empty included group");
        included += children;
      } else {
        included++;
        items.push(n.chapterId);
        if (flags.navigation)
          navigation.push({ id: n.chapterId, parent: navParent });
        const chapter = f.chapterCatalogue.find((c) => c.id === n.chapterId);
        const policy = f.structure.numbering.chapters;
        const counted =
          n.numbering === "counted" ||
          (n.numbering !== "none" &&
            chapter.type === "chapter" &&
            policy !== "none");
        let number = null;
        if (counted) {
          const type =
            policy === "per-part"
              ? "part"
              : policy === "per-volume"
                ? "volume"
                : undefined;
          const scope =
            ancestors.findLast((n) => n.type === type)?.id ?? "book";
          number = (counters.get(scope) ?? 0) + 1;
          counters.set(scope, number);
        }
        chapterNumbers.push({ chapterId: n.chapterId, number });
      }
    }
    return included;
  };
  matter("front");
  assert(visit(f.structure.roots, [], null) > 0, "empty body");
  matter("back");
  unique(items);
  return {
    target,
    selectionId: selectionId ?? null,
    items,
    navigation,
    chapterNumbers,
  };
}

for (const name of names) {
  const raw = await readFile(
    new URL(`../docs/examples/book-structure-v1/${name}.json`, import.meta.url),
    "utf8",
  );
  const f = JSON.parse(raw);
  assert.deepEqual(validate(f), f.expected.traversal);
  for (const output of f.expected.outputs)
    assert.deepEqual(plan(f, output.target, output.selectionId), output);
  fixtures.push(f);
  console.log(
    `${name}: traversal and ${f.expected.outputs.length} output plans verified`,
  );
}

let negativeCases = 0;
const invalid = (index, mutate, output = false) => {
  const f = structuredClone(fixtures[index]);
  mutate(f);
  if (output) validate(f);
  assert.throws(() => (output ? plan(f, "ebook", null) : validate(f)));
  negativeCases++;
};
invalid(0, (f) => (f.structure.schemaVersion = 2));
invalid(0, (f) => (f.structure.projectId = f.manifestOrder[0]));
invalid(
  0,
  (f) => (f.structure.nodes[0].chapterId = f.structure.nodes[1].chapterId),
);
invalid(
  0,
  (f) =>
    (f.structure.nodes[0].chapterId = "00000000-0000-4000-8000-000000009999"),
);
invalid(0, (f) => f.structure.roots.reverse());
invalid(0, (f) => f.structure.roots.pop());
invalid(1, (f) => f.structure.nodes[0].children.push(f.structure.nodes[0].id));
invalid(1, (f) => f.structure.nodes[0].children.push(f.structure.nodes[3].id));
invalid(1, (f) => f.structure.nodes[0].children.push(f.structure.nodes[1].id));
invalid(
  0,
  (f) => (f.structure.nodes[0].unknown = "preserve unsupported bytes"),
);
invalid(
  3,
  (f) => (f.editions.editions[0].parentId = f.editions.editions[1].id),
);
invalid(3, (f) => (f.editions.editions[0].parentId = f.manifestOrder[0]));
invalid(
  1,
  (f) => {
    f.structure.nodes[3].children.unshift(...f.structure.nodes[0].children);
    f.structure.nodes[0].children = [];
  },
  true,
);
const suppressed = structuredClone(fixtures[1]);
suppressed.structure.nodes[0].inclusion = { ...defaults, ebook: false };
validate(suppressed);
assert.equal(plan(suppressed, "ebook").chapterNumbers.length, 2);
suppressed.structure.nodes[3].children.unshift(
  ...suppressed.structure.nodes[0].children,
);
suppressed.structure.nodes[0].children = [];
validate(suppressed);
assert.equal(plan(suppressed, "ebook").chapterNumbers.length, 4);
const restart = structuredClone(fixtures[1]);
restart.structure.numbering.chapters = "per-part";
assert.deepEqual(
  plan(restart, "ebook").chapterNumbers.map((n) => n.number),
  [1, 2, 1, 2],
);
const unnumbered = structuredClone(restart);
unnumbered.structure.nodes[1].numbering = "none";
assert.deepEqual(
  plan(unnumbered, "ebook").chapterNumbers.map((n) => n.number),
  [null, 1, 1, 2],
);
for (let bits = 0; bits < 8; bits++) {
  const f = structuredClone(fixtures[0]);
  const id = f.manifestOrder[0];
  const inclusion = {
    ebook: Boolean(bits & 1),
    print: Boolean(bits & 2),
    navigation: Boolean(bits & 4),
  };
  f.publication.body = [{ id, inclusion }];
  validate(f);
  for (const target of ["ebook", "print"]) {
    const output = plan(f, target);
    assert.equal(output.items.includes(id), inclusion[target]);
    assert.equal(
      output.navigation.some((n) => n.id === id),
      inclusion[target] && inclusion.navigation,
    );
  }
}
console.log(
  `${negativeCases} invalid proposal variants rejected; all eight flags, exclusion and numbering scopes verified`,
);
