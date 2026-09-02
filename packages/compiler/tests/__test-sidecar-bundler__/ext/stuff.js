export class Stuff {
  static emit(sectionValue, ctx) {
    const files = [{
      content: JSON.stringify({ keys: Object.keys(sectionValue ?? {}), routes: ctx.routes.length }),
      path: "/stuff-index.json",
    }];
    if (sectionValue && sectionValue.evil) {
      files.push({ content: "nope", path: "../evil.txt" });
    }
    return files;
  }
  static lower() {
    return { $bundle: ["npm:tiny-lib"], $prototype: "Function", body: "return 1;", timing: "client" };
  }
}
