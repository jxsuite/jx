/**
 * Lock.ts — one turn at a time.
 *
 * @module @jxsuite/ai/harness
 * @license MIT
 */

import type { TurnLock } from "./types.ts";

/** Thrown, synchronously, by `runTurn` when its lock is already held by another turn. */
export class LaneBusyError extends Error {
  constructor(active: string) {
    super(`A turn is already running (${active}).`);
    this.name = "LaneBusyError";
  }
}

/**
 * A lock one turn holds at a time. A release function releases only the hold it was returned for,
 * so a late call from a turn that already ended cannot free a newer turn's hold.
 *
 * @returns {TurnLock}
 */
export function createTurnLock(): TurnLock {
  let active: string | null = null;
  let hold = 0;
  return {
    acquire(turnId) {
      if (active !== null) {
        return null;
      }
      active = turnId;
      hold += 1;
      const mine = hold;
      return () => {
        if (hold === mine) {
          active = null;
        }
      };
    },
    get active() {
      return active;
    },
  };
}
