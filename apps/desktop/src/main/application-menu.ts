import {
  BrowserWindow,
  Menu,
  type BaseWindow,
  type MenuItemConstructorOptions,
} from "electron";
import {
  APPLICATION_MENU_COMMAND_CHANNEL,
  SAVE_COMMAND_CHANNEL,
} from "@bookeditor/shared";

function sendCommand(
  window: BaseWindow | undefined,
  command:
    | "new-project"
    | "open-project"
    | "close-project"
    | "backup-project"
    | "restore-project",
): void {
  if (!window || window.isDestroyed()) return;
  BrowserWindow.fromId(window.id)?.webContents.send(
    APPLICATION_MENU_COMMAND_CHANNEL,
    command,
  );
}

export function installApplicationMenu(platform = process.platform): void {
  const isMac = platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Project",
          accelerator: "CommandOrControl+N",
          click: (_item, window) => sendCommand(window, "new-project"),
        },
        {
          label: "Open Project",
          accelerator: "CommandOrControl+O",
          click: (_item, window) => sendCommand(window, "open-project"),
        },
        { type: "separator" },
        {
          label: "Save",
          accelerator: "CommandOrControl+S",
          click: (_item, window) => {
            if (!window || window.isDestroyed()) return;
            BrowserWindow.fromId(window.id)?.webContents.send(
              SAVE_COMMAND_CHANNEL,
            );
          },
        },
        { type: "separator" },
        {
          label: "Back Up Project…",
          click: (_item, window) => sendCommand(window, "backup-project"),
        },
        {
          label: "Restore Project Backup…",
          click: (_item, window) => sendCommand(window, "restore-project"),
        },
        { type: "separator" },
        {
          label: "Close Project",
          click: (_item, window) => sendCommand(window, "close-project"),
        },
        ...(!isMac ? [{ label: "Exit", role: "quit" as const }] : []),
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    ...(!isMac
      ? [
          {
            label: "Help",
            submenu: [{ label: "About BookEditor", role: "about" as const }],
          },
        ]
      : [{ role: "help" as const }]),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
