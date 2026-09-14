import type { BookEditorApi } from "@bookeditor/shared";

declare global {
  interface Window {
    bookEditor: BookEditorApi;
  }
}

export {};
