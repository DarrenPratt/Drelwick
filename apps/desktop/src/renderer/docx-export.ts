/** Reuses the normal autosave path and rechecks dirtiness after its acknowledgement. */
export async function exportSavedDocx<T>(input: {
  flush(): Promise<boolean>;
  dirty(): boolean;
  export(): Promise<T>;
}): Promise<T> {
  if (!(await input.flush()) || input.dirty())
    throw new Error(
      "Unable to save pending edits. DOCX export was cancelled; your edits remain in the editor.",
    );
  return input.export();
}
