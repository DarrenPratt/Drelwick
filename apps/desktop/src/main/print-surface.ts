import { BrowserWindow, session } from "electron";
import { randomUUID } from "node:crypto";
import { ApplicationError } from "@drelwick/shared";
import { PRINT_LIMITS, type PrintSurface } from "./print-render.js";

/** No preload, file grants, persistent partition, navigation or network. */
export function createPrintSurface(
  resourceMilliseconds: number = PRINT_LIMITS.resourceMilliseconds,
): PrintSurface {
  const partition = session.fromPartition(`print-${randomUUID()}`, {
    cache: false,
  });
  partition.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  partition.setPermissionCheckHandler(() => false);
  partition.webRequest.onBeforeRequest((details, callback) => {
    callback({
      cancel: !details.url.startsWith("data:") && details.url !== "about:blank",
    });
  });
  partition.on("will-download", (event) => event.preventDefault());
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (!window.isDestroyed()) window.destroy();
    partition.webRequest.onBeforeRequest(null);
  };
  return {
    close,
    async render(document, contentHeight) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              close();
              reject(
                new ApplicationError(
                  "PRINT_RESOURCE_TIMEOUT",
                  "Print resources did not finish loading in time.",
                ),
              );
            }, resourceMilliseconds);
          }),
          (async () => {
            if (closed) throw new Error("Print context closed.");
            await window.loadURL(
              `data:text/html;base64,${Buffer.from(document).toString("base64")}`,
            );
            const measurement = (await window.webContents
              .executeJavaScript(`(async () => {
            const faces = await Promise.all([400,700].flatMap(weight => ['normal','italic'].map(style => document.fonts.load(style + ' ' + weight + ' 12px DrelwickPrint'))));
            await document.fonts.ready;
            if (faces.some(face => face.length !== 1) || [...document.fonts].some(font => font.status !== 'loaded')) throw new Error('Font unavailable');
            await Promise.all([...document.images].map(image => image.decode()));
            if ([...document.images].some(image => !image.naturalWidth)) throw new Error('Image unavailable');
            const width = document.body.getBoundingClientRect().width;
            let overflow = false, clipping = false;
            for (const element of document.querySelectorAll('.chapter *')) {
              const rect = element.getBoundingClientRect();
              if (rect.left < -1 || rect.right > width + 1 || element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).display === 'block') overflow = true;
              if (element.matches('img, h1, h2, h3, h4, h5, h6, .epigraph') && rect.height > ${contentHeight} + 1) clipping = true;
              if (['hidden','clip'].includes(getComputedStyle(element).overflow) && element.scrollHeight > element.clientHeight + 1) clipping = true;
            }
            return { overflow, clipping };
          })()`)) as { overflow: boolean; clipping: boolean };
            const pdf = await window.webContents.printToPDF({
              printBackground: true,
              preferCSSPageSize: true,
              displayHeaderFooter: false,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
            });
            return { pdf, ...measurement };
          })(),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
