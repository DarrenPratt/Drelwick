export interface BookEditorApi {
  project: {
    create(): Promise<void>;
    open(): Promise<void>;
  };
  dialog: {
    selectImage(): Promise<void>;
    selectExportLocation(): Promise<void>;
  };
}
