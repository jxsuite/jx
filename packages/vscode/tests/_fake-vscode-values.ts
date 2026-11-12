/**
 * The two values of VS Code's API that are only what they are constructed with, kept beside the
 * fake that hands them out (`_fake-vscode.ts`).
 */

/** VS Code's `Position`, as far as it is a line and a character. */
export class Position {
  readonly line: number;
  readonly character: number;

  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }
}

/** VS Code's `Range`, as far as it is two positions. */
export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(start: Position, end: Position) {
    this.start = start;
    this.end = end;
  }
}
