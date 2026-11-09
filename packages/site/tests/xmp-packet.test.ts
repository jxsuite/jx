import { describe, expect, test } from "bun:test";
import {
  XmpParseError,
  cleanTags,
  emptyMediaRecord,
  readMediaRecord,
  sameFocus,
  sameMediaRecord,
  writeMediaRecord,
} from "../src/xmp-packet";

/** A packet as Lightroom writes one: attribute-form simple properties, element-form lists. */
const LIGHTROOM = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
    xmp:Rating="4">
   <dc:subject>
    <rdf:Bag>
     <rdf:li>Garden</rdf:li>
     <rdf:li>Spring</rdf:li>
    </rdf:Bag>
   </dc:subject>
   <Iptc4xmpCore:AltTextAccessibility>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">Rows of tomato seedlings &amp; a cold frame</rdf:li>
     <rdf:li xml:lang="de">Tomatensetzlinge</rdf:li>
    </rdf:Alt>
   </Iptc4xmpCore:AltTextAccessibility>
   <!-- kept -->
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

describe("readMediaRecord", () => {
  test("no packet is the empty record", () => {
    expect(readMediaRecord(null)).toEqual(emptyMediaRecord());
  });

  test("reads the x-default alt text and the subject bag", () => {
    expect(readMediaRecord(LIGHTROOM)).toEqual({
      alt: "Rows of tomato seedlings & a cold frame",
      focus: null,
      tags: ["Garden", "Spring"],
    });
  });

  test("resolves namespaces by URI, not by the prefix a tool chose", () => {
    const packet = `<a:xmpmeta xmlns:a="adobe:ns:meta/"><r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><r:Description xmlns:p="http://purl.org/dc/elements/1.1/" xmlns:i="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"><p:subject><r:Bag><r:li>One</r:li></r:Bag></p:subject><i:AltTextAccessibility><r:Alt><r:li xml:lang="fr">Une</r:li></r:Alt></i:AltTextAccessibility></r:Description></r:RDF></a:xmpmeta>`;
    // No x-default entry: the first language stands in.
    expect(readMediaRecord(packet)).toEqual({ alt: "Une", focus: null, tags: ["One"] });
  });

  test("reads the attribute form and properties spread over several descriptions", () => {
    const packet = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/" Iptc4xmpCore:AltTextAccessibility="Plain"/><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:subject><rdf:Seq><rdf:li> a </rdf:li><rdf:li>A</rdf:li><rdf:li></rdf:li><rdf:li>b</rdf:li></rdf:Seq></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>`;
    expect(readMediaRecord(packet)).toEqual({ alt: "Plain", focus: null, tags: ["a", "b"] });
  });

  test("an alt property with no container reads its text; an unbound prefix is ignored", () => {
    const packet = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"><Iptc4xmpCore:AltTextAccessibility> Bare </Iptc4xmpCore:AltTextAccessibility><zz:subject/></rdf:Description></rdf:RDF>`;
    expect(readMediaRecord(packet)).toEqual({ alt: "Bare", focus: null, tags: [] });
  });

  test("decodes numeric references and keeps CDATA and processing instructions intact", () => {
    const packet = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><?pi x?><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><![CDATA[ignored]]><dc:subject><rdf:Bag><rdf:li>&#233;t&#xE9; &apos;&quot;&lt;&gt;</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF>`;
    expect(readMediaRecord(packet).tags).toEqual([`été '"<>`]);
  });

  test.each([
    ["an unclosed element", "<a><b></a>"],
    ["an element never closed", "<a>"],
    ["a stray end tag", "</a>"],
    ["an unknown entity", "<a>&nbsp;</a>"],
    ["a character reference beyond Unicode", "<a>&#x110000;</a>"],
    ["a document type", "<!DOCTYPE a><a/>"],
    ["an unquoted attribute", "<a b=c/>"],
    ["an attribute with no value", "<a b/>"],
    ["an unterminated comment", "<a><!-- x</a>"],
    ["a nameless tag", "< a/>"],
    ["an unfinished tag", "<a b='c'"],
    ["an unclosed attribute", "<a b='c/>"],
    ["an unclosed end tag", "<a></a"],
    ["a malformed attribute", "<a 1='x'/>"],
  ])("refuses %s", (_label, packet) => {
    expect(() => readMediaRecord(packet)).toThrow(XmpParseError);
  });

  test("tolerates space around an attribute's equals sign", () => {
    const packet = `<rdf:RDF xmlns:rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/" Iptc4xmpCore:AltTextAccessibility =  'Spaced'/></rdf:RDF>`;
    expect(readMediaRecord(packet).alt).toBe("Spaced");
  });

  test("text outside the root is kept as text", () => {
    expect(readMediaRecord("<a/> tail")).toEqual(emptyMediaRecord());
  });
});

describe("writeMediaRecord", () => {
  test("a file with no packet is given a fresh one holding the record", () => {
    const packet = writeMediaRecord(null, {
      alt: 'A <bold> & "quoted" claim',
      focus: null,
      tags: ["x", "y"],
    });
    expect(packet.startsWith("<?xpacket begin=")).toBe(true);
    expect(packet.endsWith('<?xpacket end="w"?>')).toBe(true);
    expect(readMediaRecord(packet)).toEqual({
      alt: 'A <bold> & "quoted" claim',
      focus: null,
      tags: ["x", "y"],
    });
  });

  test("keeps every other property, comment and translation", () => {
    const packet = writeMediaRecord(LIGHTROOM, { alt: "New alt", focus: null, tags: ["Bees"] });
    expect(readMediaRecord(packet)).toEqual({ alt: "New alt", focus: null, tags: ["Bees"] });
    expect(packet).toContain('xmp:Rating="4"');
    expect(packet).toContain("<!-- kept -->");
    expect(packet).toContain('x:xmptk="Adobe XMP Core 7.0"');
    expect(packet).toContain('<rdf:li xml:lang="de">Tomatensetzlinge</rdf:li>');
    // The old values are gone rather than doubled.
    expect(packet).not.toContain("Garden");
    expect(packet.match(/AltTextAccessibility>/g)).toHaveLength(2);
  });

  test("clearing removes the properties; a translation alone keeps the alt container", () => {
    const cleared = writeMediaRecord(LIGHTROOM, emptyMediaRecord());
    expect(cleared).not.toContain("dc:subject");
    expect(cleared).toContain("Tomatensetzlinge");
    expect(readMediaRecord(cleared)).toEqual({ alt: "Tomatensetzlinge", focus: null, tags: [] });
    const bare = writeMediaRecord(null, emptyMediaRecord());
    expect(bare).not.toContain("AltTextAccessibility");
    expect(bare).not.toContain("subject");
  });

  test("removes the properties from every description and writes them to the first", () => {
    const packet = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""/><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/" Iptc4xmpCore:AltTextAccessibility="Old"><dc:subject><rdf:Bag><rdf:li>old</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>`;
    const written = writeMediaRecord(packet, { alt: "New", focus: null, tags: ["new"] });
    expect(written).not.toContain("Old");
    expect(written).not.toContain(">old<");
    expect(readMediaRecord(written)).toEqual({ alt: "New", focus: null, tags: ["new"] });
  });

  test("binds a fresh prefix when the preferred one means something else", () => {
    const packet = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="urn:other" xmlns:dc1="urn:other-too"/></rdf:RDF>`;
    const written = writeMediaRecord(packet, { alt: "", focus: null, tags: ["t"] });
    expect(written).toContain('xmlns:dc2="http://purl.org/dc/elements/1.1/"');
    expect(readMediaRecord(written).tags).toEqual(["t"]);
  });

  test("gives an RDF with no description one, in its own prefix, and refuses a packet with no RDF", () => {
    const packet = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF></x:xmpmeta>`;
    expect(
      readMediaRecord(writeMediaRecord(packet, { alt: "Hi", focus: null, tags: [] })).alt,
    ).toBe("Hi");
    const prefixed = `<r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>`;
    const written = writeMediaRecord(prefixed, { alt: "", focus: null, tags: ["t"] });
    expect(written).toContain('<r:Description r:about="" xmlns:dc=');
    expect(readMediaRecord(written).tags).toEqual(["t"]);
    expect(() =>
      writeMediaRecord("<x:xmpmeta xmlns:x='adobe:ns:meta/'/>", emptyMediaRecord()),
    ).toThrow(XmpParseError);
  });

  test("refuses to rewrite a packet it cannot read", () => {
    expect(() => writeMediaRecord("<a><b></a>", emptyMediaRecord())).toThrow(XmpParseError);
  });
});

describe("helpers", () => {
  test("cleanTags trims, drops blanks, and keeps the first spelling of a repeat", () => {
    expect(cleanTags([" Garden", "garden", "", "  ", "Bees"])).toEqual(["Garden", "Bees"]);
  });

  test("sameMediaRecord compares trimmed alt text and ordered tags", () => {
    expect(
      sameMediaRecord(
        { alt: " a ", focus: null, tags: ["x"] },
        { alt: "a", focus: null, tags: ["x"] },
      ),
    ).toBe(true);
    expect(
      sameMediaRecord(
        { alt: "a", focus: null, tags: ["x"] },
        { alt: "a", focus: null, tags: ["y"] },
      ),
    ).toBe(false);
    expect(
      sameMediaRecord({ alt: "a", focus: null, tags: ["x"] }, { alt: "a", focus: null, tags: [] }),
    ).toBe(false);
    expect(
      sameMediaRecord({ alt: "a", focus: null, tags: [] }, { alt: "b", focus: null, tags: [] }),
    ).toBe(false);
  });
});

const EXT = `xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"`;
const RDF = `xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"`;
const ROLE = `<Iptc4xmpExt:rRole><rdf:Bag><rdf:li rdf:parseType="Resource"><xmp:Identifier><rdf:Bag><rdf:li>http://cv.iptc.org/newscodes/imageregionrole/areaOfInterest</rdf:li></rdf:Bag></xmp:Identifier></rdf:li></rdf:Bag></Iptc4xmpExt:rRole>`;
const FACE = `<rdf:li rdf:parseType="Resource"><Iptc4xmpExt:rId>face</Iptc4xmpExt:rId><Iptc4xmpExt:RegionBoundary rdf:parseType="Resource"><Iptc4xmpExt:rbShape>rectangle</Iptc4xmpExt:rbShape><Iptc4xmpExt:rbUnit>relative</Iptc4xmpExt:rbUnit><Iptc4xmpExt:rbX>0.1</Iptc4xmpExt:rbX><Iptc4xmpExt:rbY>0.1</Iptc4xmpExt:rbY><Iptc4xmpExt:rbW>0.2</Iptc4xmpExt:rbW><Iptc4xmpExt:rbH>0.2</Iptc4xmpExt:rbH></Iptc4xmpExt:RegionBoundary></rdf:li>`;

/** A one-vertex region with the given unit, vertices and role, written with nested descriptions. */
function pointRegion(vertices: string, unit = "relative", role = ROLE): string {
  return `<rdf:li><rdf:Description><Iptc4xmpExt:RegionBoundary><rdf:Description Iptc4xmpExt:rbShape="polygon" Iptc4xmpExt:rbUnit="${unit}"><Iptc4xmpExt:rbVertices><rdf:Seq>${vertices}</rdf:Seq></Iptc4xmpExt:rbVertices></rdf:Description></Iptc4xmpExt:RegionBoundary>${role}</rdf:Description></rdf:li>`;
}

function vertex(x: string, y: string): string {
  return `<rdf:li Iptc4xmpExt:rbX="${x}" Iptc4xmpExt:rbY="${y}"/>`;
}

function regions(...items: string[]): string {
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF ${RDF}><rdf:Description ${EXT}><Iptc4xmpExt:ImageRegion><rdf:Bag>${items.join("")}</rdf:Bag></Iptc4xmpExt:ImageRegion></rdf:Description></rdf:RDF></x:xmpmeta>`;
}

describe("the focal point", () => {
  test("is a relative one-vertex polygon whose role is the area of interest, in any struct form", () => {
    const quarter = pointRegion(vertex("0.25", "0.75"));
    expect(readMediaRecord(regions(FACE, quarter)).focus).toEqual({
      x: 0.25,
      y: 0.75,
    });
    // The https spelling of the role and an attribute-form identifier both count.
    const https = `<Iptc4xmpExt:rRole><rdf:Bag><rdf:li rdf:parseType="Resource" xmp:Identifier="https://cv.iptc.org/newscodes/imageregionrole/areaOfInterest"/></rdf:Bag></Iptc4xmpExt:rRole>`;
    const corner = pointRegion(vertex("1", "0"), "relative", https);
    expect(readMediaRecord(regions(corner)).focus).toEqual({ x: 1, y: 0 });
  });

  test.each([
    ["a region in pixels", pointRegion(vertex("10", "10"), "pixel")],
    ["two vertices", pointRegion(vertex("0.1", "0.1") + vertex("0.2", "0.2"))],
    ["a coordinate off the picture", pointRegion(vertex("1.5", "0.5"))],
    ["a missing coordinate", pointRegion(`<rdf:li Iptc4xmpExt:rbX="0.5"/>`)],
    ["an empty coordinate", pointRegion(vertex("", "0.5"))],
    [
      "another role",
      pointRegion(vertex("0.5", "0.5"), "relative", ROLE.replace("areaOfInterest", "cropping")),
    ],
    ["no role", pointRegion(vertex("0.5", "0.5"), "relative", "")],
    ["a rectangle", FACE],
    [
      "no vertices",
      `<rdf:li rdf:parseType="Resource"><Iptc4xmpExt:RegionBoundary rdf:parseType="Resource"><Iptc4xmpExt:rbShape>polygon</Iptc4xmpExt:rbShape><Iptc4xmpExt:rbUnit>relative</Iptc4xmpExt:rbUnit></Iptc4xmpExt:RegionBoundary>${ROLE}</rdf:li>`,
    ],
    ["no boundary", `<rdf:li rdf:parseType="Resource">${ROLE}</rdf:li>`],
  ])("is not %s", (_label, item) => {
    expect(readMediaRecord(regions(item)).focus).toBeNull();
  });

  test("is written as a new region, read back, and changed in place", () => {
    const packet = writeMediaRecord(null, { alt: "", focus: { x: 0.123456, y: 0.5 }, tags: [] });
    expect(packet).toContain("<Iptc4xmpExt:rbX>0.1235</Iptc4xmpExt:rbX>");
    expect(packet).toContain('xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"');
    expect(readMediaRecord(packet).focus).toEqual({ x: 0.1235, y: 0.5 });
    const moved = writeMediaRecord(packet, { alt: "", focus: { x: 0.9, y: 0.1 }, tags: [] });
    expect(readMediaRecord(moved).focus).toEqual({ x: 0.9, y: 0.1 });
    expect(moved.match(/ImageRegion>/g)).toHaveLength(2);
    expect(moved.match(/RegionBoundary /g)).toHaveLength(1);
  });

  test("keeps every other region, joins their bag, and clearing leaves them alone", () => {
    const packet = regions(FACE, pointRegion(vertex("0.2", "0.2")));
    const moved = writeMediaRecord(packet, { alt: "", focus: { x: 0.6, y: 0.4 }, tags: [] });
    expect(moved).toContain("<Iptc4xmpExt:rId>face</Iptc4xmpExt:rId>");
    expect(moved.match(/ImageRegion>/g)).toHaveLength(2);
    expect(readMediaRecord(moved).focus).toEqual({ x: 0.6, y: 0.4 });
    const cleared = writeMediaRecord(moved, { alt: "", focus: null, tags: [] });
    expect(cleared).toContain("face");
    expect(readMediaRecord(cleared).focus).toBeNull();
    // A bag that held only the focal point goes with it.
    const only = pointRegion(vertex("0.2", "0.2"));
    const alone = writeMediaRecord(regions(only), emptyMediaRecord());
    expect(alone).not.toContain("ImageRegion");
  });

  test("joins the image regions of a later description rather than writing the property twice", () => {
    const packet = `<rdf:RDF ${RDF}><rdf:Description rdf:about=""/><rdf:Description ${EXT}><Iptc4xmpExt:ImageRegion><rdf:Bag>${FACE}</rdf:Bag></Iptc4xmpExt:ImageRegion></rdf:Description></rdf:RDF>`;
    const written = writeMediaRecord(packet, { alt: "", focus: { x: 0.5, y: 0.5 }, tags: [] });
    expect(written.match(/<Iptc4xmpExt:ImageRegion>/g)).toHaveLength(1);
    expect(readMediaRecord(written).focus).toEqual({ x: 0.5, y: 0.5 });
  });

  test("sameFocus compares to four places, and null only with null", () => {
    expect(sameFocus(null, null)).toBe(true);
    expect(sameFocus({ x: 0.5, y: 0.5 }, null)).toBe(false);
    expect(sameFocus(null, { x: 0.5, y: 0.5 })).toBe(false);
    expect(sameFocus({ x: 0.50001, y: 0.5 }, { x: 0.5, y: 0.5 })).toBe(true);
    expect(sameFocus({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.6 })).toBe(false);
    expect(
      sameMediaRecord({ alt: "", focus: { x: 0.1, y: 0.1 }, tags: [] }, emptyMediaRecord()),
    ).toBe(false);
  });
});
