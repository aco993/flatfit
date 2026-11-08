/** Undo / redo stacks of snapshots; the owner decides what a snapshot holds and how to restore it. */
export class History<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  constructor(private limit = 100) {}

  /** Call with the state before every change the user makes. */
  push(before: T) {
    this.undoStack.push(before);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  /** Returns the state to go back to, given the current one; undefined when there is nothing to undo. */
  undo(current: T): T | undefined {
    const s = this.undoStack.pop();
    if (s !== undefined) this.redoStack.push(current);
    return s;
  }
  redo(current: T): T | undefined {
    const s = this.redoStack.pop();
    if (s !== undefined) this.undoStack.push(current);
    return s;
  }
  clear() { this.undoStack = []; this.redoStack = []; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
