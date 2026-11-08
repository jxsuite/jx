import { describe, expect, test } from "bun:test";
import {
  XmpParseError,
  cleanTags,
  emptyMediaRecord,
  readMediaRecord,
  sameMediaRecord,
  writeMediaRecord,
} from "../src/files/xmp-packet";

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
      tags: ["Garden", "Spring"],
    });
  });

  test("resolves namespaces by URI, not by the prefix a tool chose", () => {
    const packet = `<a:xmpmeta xmlns:a="adobe:ns:meta/"><r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><r:Description xmlns:p="http://purl.org/dc/elements/1.1/" xmlns:i="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"><p:subject><r:Bag><r:li>One</r:li></r:Bag></p:subject><i:AltTextAccessibility><r:Alt><r:li xml:lang="fr">Une</r:li></r:Alt></i:AltTextAccessibility></r:Description></r:RDF></a:xmpmeta>`;
    // No x-default entry: the first language stands in.
    expect(readMediaRecord(packet)).toEqual({ alt: "Une", tags: ["One"] });
  });

  test("reads the attribute form and properties spread over several descriptions", () => {
    const packet = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/" Iptc4xmpCore:AltTextAccessibility="Plain"/><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:subject><rdf:Seq><rdf:li> a </rdf:li><rdf:li>A</rdf:li><rdf:li></rdf:li><rdf:li>b</rdf:li></rdf:Seq></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>`;
    expect(readMediaRecord(packet)).toEqual({ alt: "Plain", tags: ["a", "b"] });
  });

  test("an alt property with no container reads its text; an unbound prefix is ignored", () => {
    const packet = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"><Iptc4xmpCore:AltTextAccessibility> Bare </Iptc4xmpCore:AltTextAccessibility><zz:subject/></rdf:Description></rdf:RDF>`;
    expect(readMediaRecord(packet)).toEqual({ alt: "Bare", tags: [] });
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
    const packet = writeMediaRecord(null, { alt: 'A <bold> & "quoted" claim', tags: ["x", "y"] });
    expect(packet.startsWith("<?xpacket begin=")).toBe(true);
    expect(packet.endsWith('<?xpacket end="w"?>')).toBe(true);
    expect(readMediaRecord(packet)).toEqual({ alt: 'A <bold> & "quoted" claim', tags: ["x", "y"] });
  });

  test("keeps every other property, comment and translation", () => {
    const packet = writeMediaRecord(LIGHTROOM, { alt: "New alt", tags: ["Bees"] });
    expect(readMediaRecord(packet)).toEqual({ alt: "New alt", tags: ["Bees"] });
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
    expect(readMediaRecord(cleared)).toEqual({ alt: "Tomatensetzlinge", tags: [] });
    const bare = writeMediaRecord(null, emptyMediaRecord());
    expect(bare).not.toContain("AltTextAccessibility");
    expect(bare).not.toContain("subject");
  });

  test("removes the properties from every description and writes them to the first", () => {
    const packet = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""/><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/" Iptc4xmpCore:AltTextAccessibility="Old"><dc:subject><rdf:Bag><rdf:li>old</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>`;
    const written = writeMediaRecord(packet, { alt: "New", tags: ["new"] });
    expect(written).not.toContain("Old");
    expect(written).not.toContain(">old<");
    expect(readMediaRecord(written)).toEqual({ alt: "New", tags: ["new"] });
  });

  test("binds a fresh prefix when the preferred one means something else", () => {
    const packet = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="urn:other" xmlns:dc1="urn:other-too"/></rdf:RDF>`;
    const written = writeMediaRecord(packet, { alt: "", tags: ["t"] });
    expect(written).toContain('xmlns:dc2="http://purl.org/dc/elements/1.1/"');
    expect(readMediaRecord(written).tags).toEqual(["t"]);
  });

  test("gives an RDF with no description one, in its own prefix, and refuses a packet with no RDF", () => {
    const packet = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF></x:xmpmeta>`;
    expect(readMediaRecord(writeMediaRecord(packet, { alt: "Hi", tags: [] })).alt).toBe("Hi");
    const prefixed = `<r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>`;
    const written = writeMediaRecord(prefixed, { alt: "", tags: ["t"] });
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
    expect(sameMediaRecord({ alt: " a ", tags: ["x"] }, { alt: "a", tags: ["x"] })).toBe(true);
    expect(sameMediaRecord({ alt: "a", tags: ["x"] }, { alt: "a", tags: ["y"] })).toBe(false);
    expect(sameMediaRecord({ alt: "a", tags: ["x"] }, { alt: "a", tags: [] })).toBe(false);
    expect(sameMediaRecord({ alt: "a", tags: [] }, { alt: "b", tags: [] })).toBe(false);
  });
});
