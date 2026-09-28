import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const code = /\.(?:[cm]?[jt]sx?)$/;
// Reserve the Pro namespace and repository/path spellings, not words such as
// ProseMirror or project. Nonstandard proprietary names still require review.
const pro =
  /(?:@drelwick\/pro(?:$|[^a-z0-9_])|@drelwick-pro(?:$|[^a-z0-9_])|drelwick[-_]pro(?:$|[^a-z0-9])|[/\\]pro(?:$|[/\\]))/i;
const slash = (value) => value.replaceAll("\\", "/");

/** Pure checker: maps repository-relative paths to their UTF-8 contents. */
export function checkCommunityBoundary(files, community) {
  const errors = [];
  const fail = (file, reason) =>
    errors.push(
      `${file}: ${reason}. Community packages must not depend on Drelwick Pro packages.`,
    );
  const root = resolve("/community-boundary");
  const inside = (file, target) => {
    const path = slash(relative(root, resolve(root, dirname(file), target)));
    return path !== ".." && !path.startsWith("../") && !isAbsolute(path);
  };

  for (const [name, directory] of Object.entries(community)) {
    const file =
      directory === "." ? "package.json" : `${directory}/package.json`;
    if (pro.test(name) || pro.test(directory))
      fail(file, "Pro cannot be classified as Community");
    if (!files.has(file)) fail(file, "Classified package manifest is missing");
  }

  function reference(file, target) {
    if (pro.test(target))
      return fail(file, `Forbidden reference ${JSON.stringify(target)}`);
    if (target.startsWith("@drelwick/")) {
      const name = target.split("/").slice(0, 2).join("/");
      if (!(name in community))
        fail(file, `Unclassified Drelwick package ${name}`);
    }
    if (target.startsWith(".") && !inside(file, target)) {
      fail(file, `Module reference escapes the Community checkout: ${target}`);
    }
    if (isAbsolute(target) || /^[a-z]:[/\\]|^(?:file|https?):/i.test(target)) {
      fail(file, `Non-portable module reference ${target}`);
    }
  }

  for (const [file, source] of files) {
    if (file === "package.json" || file.endsWith("/package.json")) {
      const manifest = JSON.parse(source);
      const directory = slash(dirname(file));
      if (community[manifest.name] !== directory) {
        fail(file, "Package is not in the reviewed Community inventory");
      }
      // Includes aliases, overrides, scripts, imports maps and build config;
      // optional/peer/dev dependencies are not exemptions from the boundary.
      if (pro.test(source)) fail(file, "Manifest references Pro");
      for (const field of dependencyFields) {
        for (const [name, version] of Object.entries(manifest[field] ?? {})) {
          reference(file, name);
          if (name in community && version !== "workspace:*") {
            fail(file, `${name} must resolve locally using workspace:*`);
          }
          if (
            /^(?:file|link):/.test(version) &&
            !inside(file, version.replace(/^[^:]+:/, ""))
          ) {
            fail(file, `Dependency ${name} escapes the Community checkout`);
          }
          if (version.startsWith("workspace:") && !(name in community)) {
            fail(file, `Workspace dependency ${name} is not classified`);
          }
        }
      }
    }

    if (code.test(file)) {
      const ast = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      const moduleArgument = (node) => {
        if (
          node &&
          (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        ) {
          reference(file, node.text);
        } else {
          fail(
            file,
            "Computed module loading needs an explicit Community-owned static registry",
          );
        }
      };
      const visit = (node) => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier
        ) {
          moduleArgument(node.moduleSpecifier);
        } else if (
          ts.isImportTypeNode(node) &&
          ts.isLiteralTypeNode(node.argument)
        ) {
          moduleArgument(node.argument.literal);
        } else if (ts.isExternalModuleReference(node)) {
          moduleArgument(node.expression);
        } else if (ts.isCallExpression(node)) {
          const expression = node.expression;
          if (
            expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(expression) && expression.text === "require") ||
            (ts.isPropertyAccessExpression(expression) &&
              expression.getText(ast) === "require.resolve")
          ) {
            moduleArgument(node.arguments[0]);
          }
        }
        // Runtime paths, environment names and config aliases can couple the
        // application without appearing in an import declaration.
        if (
          (ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isIdentifier(node)) &&
          pro.test(node.text)
        ) {
          fail(file, "Executable string references Pro");
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    } else if (/\.(?:json|ya?ml)$/.test(file) && !file.startsWith("docs/")) {
      if (pro.test(source)) fail(file, "Configuration references Pro");
      if (/(?:^|\/)tsconfig[^/]*\.json$/.test(file)) {
        const config = ts.parseConfigFileTextToJson(file, source).config;
        if (config) {
          const options = config.compilerOptions ?? {};
          for (const target of [
            ...Object.values(options.paths ?? {}).flat(),
            ...(config.references ?? []).map((item) => item.path),
            ...(options.rootDirs ?? []),
            ...(options.baseUrl ? [options.baseUrl] : []),
          ]) {
            reference(
              file,
              target.startsWith(".") ||
                isAbsolute(target) ||
                /^[a-z]:[/\\]/i.test(target)
                ? target
                : `./${target}`,
            );
          }
        }
      }
    }
  }

  const workspace = files.get("pnpm-workspace.yaml") ?? "";
  const packageGlobs = workspace.match(
    /^packages:\s*\n((?:[ \t]+.*\n?)*)/m,
  )?.[1];
  const expected = [
    '- "apps/*"',
    '- "packages/*"',
    '- "tests/workspace-smoke"',
  ];
  if (
    !packageGlobs ||
    JSON.stringify(
      packageGlobs
        .trim()
        .split("\n")
        .map((line) => line.trim()),
    ) !== JSON.stringify(expected)
  ) {
    fail(
      "pnpm-workspace.yaml",
      "Workspace discovery changed; review its Community-only scope and update the check",
    );
  }
  return [...new Set(errors)];
}

const entry = process.argv[1];
if (entry && resolve(entry) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const paths = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const files = new Map();
  for (const path of paths) {
    if (
      (code.test(path) || /\.(?:json|ya?ml)$/.test(path)) &&
      existsSync(resolve(root, path))
    ) {
      files.set(path, readFileSync(resolve(root, path), "utf8"));
    }
  }
  const community = JSON.parse(
    readFileSync(new URL("./community-packages.json", import.meta.url), "utf8"),
  );
  const errors = checkCommunityBoundary(files, community);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `Community boundary verified: ${Object.keys(community).length - 1} workspaces and root tooling; no Pro dependency.`,
    );
  }
}
