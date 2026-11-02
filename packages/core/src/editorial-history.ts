/// <reference lib="dom" preserve="true" />
import type { Node } from "@tiptap/pm/model";
import { Step, StepMap, StepResult } from "@tiptap/pm/transform";

/** Session-only companion marker retained and inverted by ordinary editor history. */
export class EditorialHistoryStep extends Step {
  constructor(
    readonly eventId: string,
    readonly direction: "forward" | "recorded" | "undo" | "redo" = "forward",
  ) {
    super();
  }
  override apply(doc: Node): StepResult {
    return StepResult.ok(doc);
  }
  override getMap(): StepMap {
    return StepMap.empty;
  }
  override invert(): Step {
    return new EditorialHistoryStep(
      this.eventId,
      this.direction === "undo" ? "redo" : "undo",
    );
  }
  override map(): Step {
    return this;
  }
  override toJSON(): Record<string, unknown> {
    return {
      stepType: "drelwickEditorialHistory",
      eventId: this.eventId,
      direction: this.direction,
    };
  }
}
