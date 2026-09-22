import { Node } from "@tiptap/core";
import { ImageAttributesSchema } from "@sarel/project-model";

// Keep normal editor reads sequential to bound decoded image work in main.
let reads = Promise.resolve();
export const ManuscriptImage = Node.create<{ projectId?: string }>({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addOptions: () => ({}),
  addAttributes: () => ({
    assetId: { default: "" },
    alt: { default: "" },
    size: { default: "medium" },
  }),
  // External HTML image URLs are never parsed into manuscript references.
  parseHTML: () => [],
  renderHTML: ({ node }) => [
    "figure",
    {
      "data-image-asset": node.attrs.assetId,
      "data-image-size": node.attrs.size,
    },
    ["span", {}, node.attrs.alt || "Image"],
  ],
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("figure");
      dom.className = "manuscript-image";
      dom.contentEditable = "false";
      const img = document.createElement("img");
      const status = document.createElement("span");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Retry image";
      dom.append(img, status, retry);
      let destroyed = false;
      let revision = 0;
      let current = node;
      const render = () => {
        const request = ++revision;
        const attributes = ImageAttributesSchema.safeParse(current.attrs);
        img.removeAttribute("src");
        img.alt = attributes.success ? attributes.data.alt : "";
        dom.dataset["imageSize"] = attributes.success
          ? attributes.data.size
          : "medium";
        status.textContent = "Loading image…";
        retry.hidden = true;
        const projectId = this.options.projectId;
        reads = reads.then(async () => {
          if (destroyed || revision !== request) return;
          try {
            if (!projectId || !attributes.success)
              throw new Error("Unavailable");
            const result = await window.sarel.images.read({
              projectId,
              assetId: attributes.data.assetId,
            });
            if (destroyed || revision !== request) return;
            if (
              !result.ok ||
              !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(
                result.value.dataUrl,
              )
            )
              throw new Error("Unavailable");
            img.src = result.value.dataUrl;
            status.textContent = "";
          } catch {
            if (destroyed || revision !== request) return;
            status.textContent =
              "Image unavailable. Restore the project asset, retry, or select this image and replace it. Its reference is preserved.";
            status.setAttribute("role", "status");
            retry.hidden = false;
          }
        });
      };
      retry.addEventListener("click", render);
      render();
      return {
        dom,
        update(next) {
          if (next.type !== current.type) return false;
          const changed = next.attrs.assetId !== current.attrs.assetId;
          current = next;
          img.alt = String(next.attrs.alt);
          dom.dataset["imageSize"] = String(next.attrs.size);
          if (changed) render();
          return true;
        },
        selectNode: () => dom.classList.add("ProseMirror-selectednode"),
        deselectNode: () => dom.classList.remove("ProseMirror-selectednode"),
        stopEvent: (event) => event.target === retry,
        ignoreMutation: () => true,
        destroy: () => {
          destroyed = true;
          retry.removeEventListener("click", render);
        },
      };
    };
  },
});
