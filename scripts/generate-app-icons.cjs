// Run with the pinned desktop Electron binary; no image conversion dependency needed.
const { app, nativeImage } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

app.whenReady().then(async () => {
  try {
    const assets = join(__dirname, "..", "apps", "desktop", "assets");
    const source = nativeImage.createFromPath(
      join(assets, "branding", "app-logo.png"),
    );
    const { width, height } = source.getSize();
    if (source.isEmpty() || width !== height || width < 512)
      throw new Error(
        "The application logo must be a square image of at least 512 pixels.",
      );
    const output = join(assets, "icons");
    await mkdir(output, { recursive: true });
    const resize = (size) =>
      source.resize({ width: size, height: size, quality: "best" }).toPNG();
    await writeFile(join(output, "app.png"), resize(512));

    // ICO directory followed by PNG frames (supported by modern Windows).
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const frames = sizes.map(resize);
    const directory = Buffer.alloc(6 + 16 * frames.length);
    directory.writeUInt16LE(1, 2);
    directory.writeUInt16LE(frames.length, 4);
    let offset = directory.length;
    frames.forEach((frame, index) => {
      const entry = 6 + index * 16;
      directory[entry] = sizes[index] === 256 ? 0 : sizes[index];
      directory[entry + 1] = directory[entry];
      directory.writeUInt16LE(1, entry + 4);
      directory.writeUInt16LE(32, entry + 6);
      directory.writeUInt32LE(frame.length, entry + 8);
      directory.writeUInt32LE(offset, entry + 12);
      offset += frame.length;
    });
    await writeFile(
      join(output, "app.ico"),
      Buffer.concat([directory, ...frames]),
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
