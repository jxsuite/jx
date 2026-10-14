/**
 * What a CLI run prints and whether it failed, returned rather than printed so a test can run the
 * whole report without the process exiting.
 */
export interface CliReport {
  failed: boolean;
  lines: string[];
}
