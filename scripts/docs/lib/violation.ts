/** One finding a docs gate reports: the rule that fired, where, and what to do about it. */
export interface GateViolation<Code extends string> {
  code: Code;
  file: string;
  line?: number;
  message: string;
}
