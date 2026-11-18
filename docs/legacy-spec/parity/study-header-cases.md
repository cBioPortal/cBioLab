# Study View header: cases

The Explore page's study name and description, as the portal's study view header writes them
(`cbioportal-frontend` at `cd8c6df`). Each row is a test. ⚠ marks a deliberate difference.

Source: SS = `src/pages/studyView/studyPageHeader/studySummary/StudySummary.tsx`. The text is built in
`lib/study-view-header.ts`; the study's description and PubMed id come from `/api/catalog`
(`cancer_study`).

| # | Case | Rule | Source |
|---|---|---|---|
| SH1 | Title | One study: its name. Several: "Combined Study" | SS:39-45 |
| SH2 | First line, one study | The description up to its first run of line breaks (`split(/\n+/)[0]`) | SS:47-56 |
| SH3 | PubMed | When the study has a PubMed id, a "PubMed" link after the first line to `https://www.ncbi.nlm.nih.gov/pubmed/<pmid>` (the id as stored, trimmed), in a new tab. None when it has no id | SS:57-70 |
| SH4 | First line, several studies | "This combined study contains samples from N studies" | SS:73-77 |
| SH5 | More | A ⊕ / ⊖ toggle, closed at first, shown when there are several studies or the description has more than one line (`split(/\n/)` longer than 1) | SS:80-90, 165-180 |
| SH6 | More, one study | The lines after the first (`split(/\n/).slice(1)`), kept as written (white-space: pre) | SS:84-98 |
| SH7 | More, several studies | A list of the studies' names, each a link opening that study's Explore page in a new tab | SS:99-112 |
| SH8 | ⚠ HTML in a description | The portal renders the description as HTML. Here it is text: a link `<a href="http(s)://…">text</a>` stays a link (new tab); every other tag is dropped, so a description cannot inject markup. In detail: `<br>`, `<p>`, `</p>`, `<div>`, `<li>` become a space (words they separate stay apart); `<script>` and `<style>` go with their contents; comments go; only a real tag (`<` then a letter or `/`) is dropped, so a bare `<` in text (`p < 0.05`) stays; named entities `&amp; &lt; &gt; &quot; &apos; &nbsp; &ndash; &mdash; &hellip; &lsquo; &rsquo; &ldquo; &rdquo; &deg; &times; &plusmn; &micro; &middot;` and Greek `&alpha; &beta; &gamma; &delta; &kappa;` are decoded, as are numeric ones (`&#8217;`, `&#x2013;`); an unknown or invalid entity stays as written. A link is an `<a>` whose own `href` attribute (not `data-href`) is http(s); its text has its whitespace collapsed | SS:52, 92 (`dangerouslySetInnerHTML`) |
| SH9 | ⚠ The study download | Not shown: the portal's ⤓ links its download server's archive when the study is in that server's list, which this deployment cannot read | SS:118-125 |
