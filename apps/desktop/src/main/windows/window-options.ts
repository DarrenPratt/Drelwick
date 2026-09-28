export function getMainWindowOptions(preloadPath: string) {
  return {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Drelwick's bundled checker never invokes native downloads/autocorrection.
      spellcheck: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      preload: preloadPath,
    },
  };
}
