import type { JsonValue } from "@jxsuite/schema/types";

export interface BuildEntry {
  entrypoints: string[];
  outdir: string;
  match?: ((path: string) => boolean) | RegExp;
  label?: string;
}

export interface ClassJsonParam {
  $ref?: string;
  identifier?: string;
  name?: string;
}

export interface ClassJsonField {
  role?: string;
  access?: string;
  scope?: string;
  identifier?: string;
  initializer?: JsonValue;
  default?: JsonValue;
  /** A JSON Schema fragment; only an object (or array) form is merged into the studio schema. */
  type?: JsonValue;
  description?: string;
  examples?: JsonValue[];
}

export interface ClassJsonMethod {
  identifier?: string;
  role?: string;
  scope?: string;
  body?: string | string[];
  getter?: { body: string };
  setter?: { parameters?: ClassJsonParam[]; body: string };
  parameters?: ClassJsonParam[];
  returns?: JsonValue;
  /** Where a format-extension capability method may run (`compiler`, `server`, `client`). */
  timing?: string[];
}

export interface ClassJsonParameterDef {
  identifier?: string;
  /** A JSON Schema fragment; only an object (or array) form is merged into the studio schema. */
  type?: JsonValue;
  format?: string;
  description?: string;
  examples?: JsonValue[];
}

export interface ClassJsonDef {
  title?: string;
  description?: string;
  $implementation?: string;
  /** A format extension's format block, surfaced to the studio verbatim. */
  format?: JsonValue;
  /** Studio presentation hints, surfaced verbatim. */
  $studio?: JsonValue;
  extends?: { $ref?: string };
  $defs?: {
    fields?: Record<string, ClassJsonField>;
    constructor?: {
      role?: string;
      $prototype?: string;
      body?: string | string[];
      parameters?: ClassJsonParam[];
    };
    methods?: Record<string, ClassJsonMethod>;
    parameters?: Record<string, ClassJsonParameterDef>;
  };
}
