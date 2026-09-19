const paths = {
  book: "M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15",
  page: "M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6",
  preview: "M5 3h14v18H5V3Zm5 15h4",
  settings: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6",
  search: "M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  export: "M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6",
  history: "M3 4v5h5M3 9a9 9 0 1 1 0 6m9-9v6l4 2",
  close: "m6 6 12 12M6 18 18 6",
  arrow: "m9 5 7 7-7 7",
  plus: "M12 5v14M5 12h14",
  panel: "M3 4h18v16H3V4Zm6 0v16",
  check: "m5 12 4 4L19 6",
} as const;

export function WorkspaceIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
