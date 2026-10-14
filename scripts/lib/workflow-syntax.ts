/**
 * A job step as GitHub Actions workflow syntax declares one, narrowed to the members the lane
 * suites read. GitHub rejects a workflow whose steps break this shape, which is what lets a suite
 * assert a parsed committed workflow to it.
 */
export interface WorkflowStep {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
}
