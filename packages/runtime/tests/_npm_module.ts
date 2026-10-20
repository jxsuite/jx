/** A package module the `npm:` resolver test serves in place of a real package. */
/** The scope a Function entry is called with, as far as this module reads it: not at all. */
export interface GreeterScope {
  readonly name?: string;
}

export function greet(_state: GreeterScope, name: string): string {
  return `hello ${name}`;
}
