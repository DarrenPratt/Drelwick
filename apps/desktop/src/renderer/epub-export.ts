export async function exportSavedEpub<T>(input: {
  flush: () => Promise<boolean>;
  dirty: () => boolean;
  export: () => Promise<
    { ok: true; value: T } | { ok: false; error: { message: string } }
  >;
}): Promise<
  { ok: true; value: T } | { ok: false; error: { message: string } }
> {
  if (!(await input.flush()) || input.dirty())
    return {
      ok: false,
      error: { message: "Save pending edits before exporting." },
    };
  return input.export();
}
