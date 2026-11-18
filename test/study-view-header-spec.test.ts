// Written from docs/legacy-spec/parity/study-header-cases.md (one test per row these pure
// functions cover, named by its id), without reference to the implementation.
// Covered elsewhere, not here (UI): the ⊕ / ⊖ toggle's state, links opening in a new tab, and
// SH9 (no study download link).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  studyHeaderText, descriptionParts, type StudyAbout, type DescPart,
} from "../lib/study-view-header.ts";

const study = (id: string, over: Partial<StudyAbout> = {}): StudyAbout =>
  ({ id, name: `Study ${id}`, description: `About ${id}.`, pmid: null, ...over });

const joined = (parts: DescPart[]) => parts.map((p) => p.text).join("");
const links = (parts: DescPart[]) => parts.filter((p) => "href" in p);

const TWO_LINES = "Line one.\n\nLine two\nLine three";

test("SH1 title: one study is its name, several are \"Combined Study\"", () => {
  assert.equal(studyHeaderText([study("a", { name: "Alpha Study" })]).title, "Alpha Study");
  assert.equal(studyHeaderText([study("a"), study("b")]).title, "Combined Study");
});

test("SH2 first line, one study: the description up to its first run of line breaks", () => {
  assert.deepEqual(studyHeaderText([study("a", { description: TWO_LINES })]).first, [{ text: "Line one." }]);
  const one = studyHeaderText([study("a", { description: "Just one line of text." })]).first;
  assert.equal(joined(one), "Just one line of text.");
  assert.equal(links(one).length, 0);
  const empty = studyHeaderText([study("a", { description: "" })]).first;
  assert.ok(
    JSON.stringify(empty) === "[]" || JSON.stringify(empty) === JSON.stringify([{ text: "" }]),
    `empty description gave ${JSON.stringify(empty)}`,
  );
});

test("SH3 PubMed: a link to the trimmed id, null without one or with several studies", () => {
  assert.equal(studyHeaderText([study("a", { pmid: "12345" })]).pubmed,
    "https://www.ncbi.nlm.nih.gov/pubmed/12345");
  assert.equal(studyHeaderText([study("a", { pmid: " 123 " })]).pubmed,
    "https://www.ncbi.nlm.nih.gov/pubmed/123");
  assert.equal(studyHeaderText([study("a", { pmid: null })]).pubmed, null);
  assert.equal(studyHeaderText([study("a", { pmid: "" })]).pubmed, null);
  assert.equal(studyHeaderText([study("a", { pmid: "1" }), study("b", { pmid: "2" })]).pubmed, null);
});

test("SH4 first line, several studies: \"This combined study contains samples from N studies\"", () => {
  assert.deepEqual(studyHeaderText([study("a"), study("b"), study("c")]).first,
    [{ text: "This combined study contains samples from 3 studies" }]);
});

test("SH5 more: shown for several studies or a description of more than one line", () => {
  assert.equal(studyHeaderText([study("a", { description: "One line." })]).more, null);
  const two = studyHeaderText([study("a", { description: TWO_LINES })]).more;
  assert.ok(two && "lines" in two, `two lines gave ${JSON.stringify(two)}`);
  const several = studyHeaderText([study("a"), study("b")]).more;
  assert.ok(several && "studies" in several, `several studies gave ${JSON.stringify(several)}`);
  assert.notEqual(studyHeaderText([study("a", { description: "a\n\n" })]).more, null);
});

test("SH6 more, one study: the lines after the first, kept as written", () => {
  const more = studyHeaderText([study("a", { description: TWO_LINES })]).more;
  assert.ok(more && "lines" in more, `got ${JSON.stringify(more)}`);
  assert.deepEqual(more.lines, [{ text: "\nLine two\nLine three" }]);
});

test("SH7 more, several studies: the studies' ids and names in the given order", () => {
  const more = studyHeaderText([
    study("z", { name: "Zeta" }), study("a", { name: "Alpha" }), study("m", { name: "Mu" }),
  ]).more;
  assert.ok(more && "studies" in more, `got ${JSON.stringify(more)}`);
  assert.deepEqual(more.studies,
    [{ id: "z", name: "Zeta" }, { id: "a", name: "Alpha" }, { id: "m", name: "Mu" }]);
});

test("SH8 HTML in a description: plain text is one text part", () => {
  assert.deepEqual(descriptionParts("Plain words, nothing else."), [{ text: "Plain words, nothing else." }]);
});

test("SH8 HTML in a description: an http(s) <a href> stays a link", () => {
  assert.deepEqual(descriptionParts('See <a href="https://x.org/a">the site</a> now.'),
    [{ text: "See " }, { text: "the site", href: "https://x.org/a" }, { text: " now." }]);
});

test("SH8 HTML in a description: single-quoted and uppercase hrefs are links too", () => {
  const single = descriptionParts("Go <a href='http://y.org/b'>there</a>.");
  assert.equal(joined(single), "Go there.");
  assert.deepEqual(links(single), [{ text: "there", href: "http://y.org/b" }]);
  const upper = descriptionParts('Go <A HREF="https://z.org/c">here</A>.');
  assert.equal(joined(upper), "Go here.");
  assert.deepEqual(links(upper), [{ text: "here", href: "https://z.org/c" }]);
});

test("SH8 HTML in a description: a non-http link is text, not a link", () => {
  const parts = descriptionParts('<a href="javascript:alert(1)">x</a>');
  assert.equal(links(parts).length, 0);
  assert.equal(joined(parts), "x");
});

test("SH8 HTML in a description: every other tag is dropped", () => {
  const text = joined(descriptionParts("<b>bold</b> and <script>bad()</script>"));
  assert.ok(text.includes("bold and "), `got ${JSON.stringify(text)}`);
  assert.ok(!text.includes("<"), `got ${JSON.stringify(text)}`);
});

test("SH8 HTML in a description: the common entities are decoded", () => {
  assert.equal(joined(descriptionParts("A &amp; B &lt;C&gt; &quot;q&quot; &#39;s")), "A & B <C> \"q\" 's");
});

test("SH8 HTML in a description: the first line goes through the same rules", () => {
  const first = studyHeaderText([study("a", {
    description: 'Data from <a href="https://x.org/a">the site</a> &amp; <i>more</i>.\nSecond line.',
  })]).first;
  assert.equal(joined(first), "Data from the site & more.");
  assert.deepEqual(links(first), [{ text: "the site", href: "https://x.org/a" }]);
});

// ---- SH8 (rewritten) ----

test("SH8 <br>, <p>, </p>, <div>, <li> keep the words they separate apart", () => {
  for (const tag of ["<br>", "<br/>", "<p>", "</p>", "<div>", "<li>"]) {
    const t = joined(descriptionParts(`one${tag}two`));
    assert.match(t, /one\s+two/, tag);
  }
});

test("SH8 <script> and <style> are removed with their contents", () => {
  const t = joined(descriptionParts("a <script>alert('x')</script>b <style>.c{color:red}</style>c"));
  assert.ok(!/alert|color|script|style/.test(t), t);
  assert.match(t, /a\s+b\s+c/);
});

test("SH8 comments are removed", () => {
  const t = joined(descriptionParts("a <!-- hidden --> b"));
  assert.ok(!t.includes("hidden") && !t.includes("<!--"), t);
  assert.match(t, /a\s+b/);
});

test("SH8 a bare < in text stays: p < 0.05 and q > 1", () => {
  assert.equal(joined(descriptionParts("p < 0.05 and q > 1")), "p < 0.05 and q > 1");
});

test("SH8 each listed named entity is decoded", () => {
  const ents: [string, string][] = [
    ["&amp;", "&"], ["&lt;", "<"], ["&gt;", ">"], ["&quot;", "\""], ["&apos;", "'"], ["&nbsp;", " "],
    ["&ndash;", "–"], ["&mdash;", "—"], ["&hellip;", "…"], ["&lsquo;", "‘"], ["&rsquo;", "’"],
    ["&ldquo;", "“"], ["&rdquo;", "”"], ["&deg;", "°"], ["&times;", "×"], ["&plusmn;", "±"],
    ["&micro;", "µ"], ["&middot;", "·"], ["&alpha;", "α"], ["&beta;", "β"], ["&gamma;", "γ"],
    ["&delta;", "δ"], ["&kappa;", "κ"],
  ];
  for (const [e, ch] of ents) {
    const t = joined(descriptionParts(`x${e}y`));
    // &nbsp; may be normalised to a plain space; either is a decoded entity
    if (e === "&nbsp;") assert.ok(t === "x y" || t === "x y", `${e} → ${JSON.stringify(t)}`);
    else assert.equal(t, `x${ch}y`, e);
  }
});

test("SH8 numeric entities, decimal and hex, are decoded", () => {
  assert.equal(joined(descriptionParts("it&#8217;s")), "it’s");
  assert.equal(joined(descriptionParts("1&#x2013;2")), "1–2");
});

test("SH8 an unknown or invalid entity stays as written", () => {
  for (const e of ["&foo;", "&#xD800;", "&#1114112;"]) assert.equal(joined(descriptionParts(`a${e}b`)), `a${e}b`, e);
});

test("SH8 a link is an <a> whose own href is http(s), not data-href", () => {
  assert.equal(links(descriptionParts('<a data-href="https://x">t</a>')).length, 0);
  assert.equal(joined(descriptionParts('<a data-href="https://x">t</a>')), "t");
  const l = links(descriptionParts('<a class="c" href="https://x">t</a>'));
  assert.deepEqual(l, [{ text: "t", href: "https://x" }]);
});

test("SH8 a link's text has its whitespace collapsed", () => {
  const l = links(descriptionParts('<a href="https://x">  two\n   words  </a>'));
  assert.equal(l.length, 1);
  assert.equal(l[0].text.trim(), "two words");
  assert.ok(!/\s{2}|\n/.test(l[0].text), JSON.stringify(l[0].text));
});

test("SH8 a javascript: href is not a link", () => {
  const p = descriptionParts('<a href="javascript:alert(1)">t</a>');
  assert.equal(links(p).length, 0);
  assert.equal(joined(p), "t");
});

test("SH8 studyHeaderText carries the decoded, tag-free text", () => {
  const h = studyHeaderText([study("a", { description: "A &amp; B<br>C" })]);
  assert.match(joined(h.first), /A & B\s+C/);
});
