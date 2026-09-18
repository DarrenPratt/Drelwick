import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import { SAVE_COMMAND_CHANNEL } from "@bookeditor/shared";

export function installApplicationMenu(platform = process.platform): void {
  const template: MenuItemConstructorOptions[] = [
    ...(platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Save",
          accelerator: "CommandOrControl+S",
          click: (_item, window) => {
            if (window)
              BrowserWindow.fromId(window.id)?.webContents.send(
                SAVE_COMMAND_CHANNEL,
              );
          },
        },
        { type: "separator" },
        { role: platform === "darwin" ? "close" : "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
