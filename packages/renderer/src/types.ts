import type {
  ChapterFile,
  ImageAsset,
  ManuscriptDocumentSchema,
} from "@drelwick/project-model";
import type {
  PublicationMetadata,
  PublicationInclusion,
  MatterType,
} from "@drelwick/shared";

/** An in-memory, validated snapshot. No paths, handles, editor state or I/O. */
export interface BookRevision {
  projectId: string;
  revision: string;
  title: string;
  language: string;
  metadata?: PublicationMetadata;
  coverAssetId?: string;
  chapters: readonly BookChapter[];
  assets: readonly BookAsset[];
}
export interface BookChapter {
  publication?: {
    section: "front" | "body" | "back";
    kind?: MatterType | "cover";
    inclusion: PublicationInclusion;
  };
  id: string;
  title: string;
  type: ChapterFile["type"];
  document: ReturnType<typeof ManuscriptDocumentSchema.parse>;
}
export type AssetDescriptor = Pick<
  ImageAsset,
  "id" | "mediaType" | "width" | "height" | "byteSize" | "sha256"
>;
export type BookAsset =
  | { status: "available"; descriptor: AssetDescriptor }
  | { status: "missing" | "invalid"; id: string };
export type DiagnosticCode =
  | "unsupported-node"
  | "unsupported-mark"
  | "invalid-structure"
  | "invalid-xml-text"
  | "unsafe-url"
  | "unresolved-internal-link"
  | "missing-asset"
  | "invalid-asset"
  | "unsafe-asset-reference";
export interface RenderDiagnostic {
  code: DiagnosticCode;
  severity: "error" | "warning";
  chapterId: string;
  path: readonly number[];
  /** Known vocabulary only; never copy arbitrary untrusted type strings. */
  nodeType?: string;
  assetId?: string;
}
export interface SemanticTarget {
  chapterId: string;
  id: string;
  path: readonly number[];
}
export type AssetReference =
  { kind: "relative"; value: string } | { kind: "embedded"; value: string };
export interface RenderOptions {
  target?: "ebook" | "print";
  /** Trusted target code; pure/deterministic. Values are checked before serialization. */
  resolveAsset(
    asset: AssetDescriptor,
    context: { chapterId: string; path: readonly number[] },
  ): AssetReference | undefined;
  /** Packaging may map a semantic target into another chapter document. */
  resolveInternalLink?: (
    target: SemanticTarget,
    fromChapterId: string,
  ) => string | undefined;
  /** Isolated preview disables navigation without changing manuscript semantics. */
  links?: "enabled" | "inert";
}
export interface RenderedChapter {
  publication?: BookChapter["publication"];
  id: string;
  anchor: string;
  title: string;
  xhtml: string;
  targets: readonly SemanticTarget[];
  assetIds: readonly string[];
}
export interface RenderedBook {
  ok: boolean;
  revision: string;
  chapters: readonly RenderedChapter[];
  diagnostics: readonly RenderDiagnostic[];
}
