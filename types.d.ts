declare module "three";
declare module "@webref/elements" {
  interface WebrefElement {
    name: string;
    obsolete?: boolean;
  }
  interface WebrefElementsSpec {
    elements: WebrefElement[];
  }
  export function listAll(options?: {
    folder?: string;
  }): Promise<Record<string, WebrefElementsSpec>>;
}

declare module "@webref/css" {
  interface CssProperty {
    name: string;
    styleDeclaration?: string[];
  }
  interface CssData {
    properties: CssProperty[];
  }
  const css: {
    listAll: () => Promise<CssData>;
  };
  export default css;
}

declare module "@webref/idl" {
  interface IdlType {
    idlType?: string | IdlType | IdlType[];
  }
  interface IdlMember {
    type: string;
    name?: string;
    idlType?: IdlType;
  }
  interface IdlDefinition {
    type: string;
    name?: string;
    members?: IdlMember[];
  }
  /** One `.idl` file in the package folder, keyed by its shortname in `listAll()`'s result. */
  interface IdlFile {
    filename: string;
    shortname: string;
    path: string;
    text: () => Promise<string>;
    parse: () => Promise<IdlDefinition[]>;
  }
  const idl: {
    parseAll: (options?: { folder?: string }) => Promise<Record<string, IdlDefinition[]>>;
    listAll: (options?: { folder?: string }) => Promise<Record<string, IdlFile>>;
  };
  export default idl;
}
declare module "glob";
declare module "unified";
declare module "remark-parse";
declare module "remark-frontmatter";
declare module "remark-parse-frontmatter";
declare module "remark-rehype";
declare module "rehype-stringify";
declare module "quikchat/md";
