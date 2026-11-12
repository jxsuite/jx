/** The formatter Studio's code editor and `jx format` share: a function body and a script. */
import { describe, expect, test } from "bun:test";
import { formatBody, formatScript } from "../src/code-format.ts";

/** A call that is `width` columns wide. */
function callOf(width: number): string {
  return `call(${"a".repeat(width - 7)});`;
}

describe("formatBody", () => {
  test("formats statements at two spaces, from the first column", async () => {
    const { code, errors } = await formatBody("if(a){b()}\nreturn a+1");
    expect(errors).toEqual([]);
    expect(code).toBe("if (a) {\n  b();\n}\nreturn a + 1;");
  });

  test("a body that awaits is formatted, which a method of a class may", async () => {
    const { code, errors } = await formatBody("const r = await fetch('/x'); return r.ok");
    expect(errors).toEqual([]);
    expect(code).toBe('const r = await fetch("/x");\nreturn r.ok;');
  });

  test("keeps its types", async () => {
    const { code } = await formatBody("const el=event.target as HTMLInputElement;return el.value");
    expect(code).toBe("const el = event.target as HTMLInputElement;\nreturn el.value;");
  });

  test("a template literal's lines are the string's own text and are not unindented", async () => {
    const { code, errors } = await formatBody("const t = `a\n  b\nc`;\nif (t) {\nrun(t)\n}");
    expect(errors).toEqual([]);
    expect(code).toBe("const t = `a\n  b\nc`;\nif (t) {\n  run(t);\n}");
  });

  test("a block comment's lines are kept where they were written", async () => {
    const { code } = await formatBody("/*\ntext\n  more\n*/\na()");
    expect(code).toBe("/*\ntext\n  more\n*/\na();");
  });

  test("a blank line between statements is kept, and a second one is not", async () => {
    const { code } = await formatBody("a()\n\n\nb()");
    expect(code).toBe("a();\n\nb();");
  });

  test("a line has a hundred columns counted from where the body starts", async () => {
    const fits = await formatBody(callOf(100));
    const tooLong = await formatBody(callOf(101));
    expect(fits.code).toBe(callOf(100));
    expect(tooLong.code.split("\n")).toHaveLength(3);
  });

  test("formatting what it formatted changes nothing", async () => {
    const once = await formatBody("const t = `a\n  b`;\nif(t){run(t)}");
    const twice = await formatBody(once.code);
    expect(twice.code).toBe(once.code);
  });

  test("a body that does not parse is returned as written, with the line it is wrong on", async () => {
    const body = "const a = 1;\nconst b = ;\nreturn a";
    const { code, errors } = await formatBody(body);
    expect(code).toBe(body);
    expect(errors).toEqual(["Unexpected token (line 2)"]);
  });

  test("a line is counted in the body whatever characters are above it", async () => {
    const { errors } = await formatBody("const é = 'ééé';\nconst b = ;");
    expect(errors).toEqual(["Unexpected token (line 2)"]);
  });

  test("a body that stops short is wrong on its own last line, not on the one after it", async () => {
    const { code, errors } = await formatBody("if (");
    expect(code).toBe("if (");
    expect(errors).toEqual(["Unexpected token (line 1)"]);
  });

  test("a body that closes the function around it is left as written", async () => {
    const body = "}\nfoo();\n{";
    expect(await formatBody(body)).toEqual({ code: body, errors: [] });
  });

  test("nothing but white space is nothing", async () => {
    expect(await formatBody(" \n\t")).toEqual({ code: "", errors: [] });
  });
});

describe("formatScript", () => {
  test("formats a module, without the newline a file ends with", async () => {
    const { code, errors } = await formatScript(
      "import {a} from './a'\nexport function hi(n:string){return a+n}\n",
    );
    expect(errors).toEqual([]);
    expect(code).toBe(
      'import { a } from "./a";\nexport function hi(n: string) {\n  return a + n;\n}',
    );
  });

  test("a module that does not parse is returned as written, with the line", async () => {
    const script = "export const a = 1\nexport const = 2\n";
    expect(await formatScript(script)).toEqual({
      code: script,
      errors: ["Unexpected token (line 2)"],
    });
  });

  test("nothing but white space is nothing", async () => {
    expect(await formatScript(" \n")).toEqual({ code: "", errors: [] });
  });
});
