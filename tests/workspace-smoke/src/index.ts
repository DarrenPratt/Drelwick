// A named package import exercises both declaration and runtime resolution.
// Keep the import in emitted JavaScript so Node also verifies the workspace link.
import * as shared from "@sarel/shared";

export { shared };
