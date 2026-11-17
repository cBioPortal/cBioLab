// The Explore page's study header, as cBioPortal's study view writes it: the title, the
// description's first line with its PubMed link, and what ⊕ opens. The rules, case by case:
// docs/legacy-spec/parity/study-header-cases.md (SH). Browser-safe; text only.

/** a study as the header reads it */
export interface StudyAbout { id: string; name: string; description: string; pmid: string | null }

/** a run of description text, or a link */
export type DescPart = { text: string } | { text: string; href: string };

export interface StudyHeaderText {
  title: string;
  first: DescPart[];
  /** the PubMed link after the first line, or null */
  pubmed: string | null;
  /** what ⊕ opens: the description's other lines (one study), the studies (several), or null for no toggle */
  more: { lines: DescPart[] } | { studies: { id: string; name: string }[] } | null;
}

/** the header of the selected studies (at least one) */
export function studyHeaderText(studies: StudyAbout[]): StudyHeaderText {
  if (studies.length !== 1) return {
    title: "Combined Study",
    first: [{ text: "This combined study contains samples from " + studies.length + " studies" }],
    pubmed: null,
    more: { studies: studies.map((s) => ({ id: s.id, name: s.name })) },
  };
  const s = studies[0];
  const lines = s.description.split(/\n/g);
  const pmid = (s.pmid || "").trim();
  return {
    title: s.name,
    first: descriptionParts(s.description.split(/\n+/g)[0]),
    pubmed: pmid ? "https://www.ncbi.nlm.nih.gov/pubmed/" + pmid : null,
    more: lines.length > 1 ? { lines: descriptionParts(lines.slice(1).join("\n")) } : null,
  };
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'" };
/** text with its tags dropped and the common entities decoded */
const plain = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]);

/** a description's HTML as text and http(s) links: every other tag dropped, the common entities decoded */
export function descriptionParts(html: string): DescPart[] {
  const parts: DescPart[] = [];
  const push = (text: string, href?: string) => {
    if (!text && !href) return;
    if (href) parts.push({ text, href });
    else if (parts.length && !("href" in parts[parts.length - 1])) parts[parts.length - 1] = { text: parts[parts.length - 1].text + text };
    else parts.push({ text });
  };
  const link = /<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let at = 0;
  for (const m of html.matchAll(link)) {
    push(plain(html.slice(at, m.index)));
    const href = plain(m[1] ?? m[2] ?? "").trim(), text = plain(m[3]);
    if (/^https?:\/\//i.test(href)) push(text || href, href); else push(text);
    at = m.index + m[0].length;
  }
  push(plain(html.slice(at)));
  return parts;
}
