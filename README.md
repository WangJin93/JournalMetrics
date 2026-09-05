# JournalMetrics

JournalMetrics is a Chrome (MV3) browser extension for PubMed that helps researchers quickly **analyze and summarize PubMed search results**:
journal information retrieval, literature screening/filtering, and result analytics.

## Features (v1.2.0)

### 🔍 Journal info badges
On PubMed search-result lists and article pages, inject badges: Impact Factor (IF), JCR quartile, CAS block, TOP journal, self-citation rate, website, OA status, publisher, country, annual article count, research-article proportion and APC. Toggle each field from the extension popup — changes apply to an already-open page immediately (no reload needed).

### 🎚 Filter (per-search)
Floating **Filter** panel: IF range, JCR quartile, CAS block, TOP journal and OA status, with live per-option counts. Filter settings are scoped to the current search query and restored automatically for that query, never leaking into other searches.

### 📊 Analyze & summarize
Click the green **Analyze** button on any PubMed results page:

- **Analyze current page** — statistics over the visible results with truthful figures: recognized SCI (JCR/CAS-listed) articles, other known journals, unrecognized journals, average/median IF, JCR/CAS/discipline/year/IF/OA distributions and a top-journals table.
- **Analyze all search results** — fetch the whole search via NCBI E-utilities (`esearch` + batched `esummary`, ≤3 req/s), match every PMID against the local journal database and produce the same statistics across the result set (progress bar + cancel). The number of articles pulled is capped by the **Analysis Settings** limit (default **1000**, configurable 1–10000 in the extension popup); the stats page notes whenever the limit cut off a larger search.

The statistics page lets you:
- copy a one-click text summary (English or Chinese),
- export the journal list (with unrecognized journals) as CSV for Excel,
- sort the journal table, link out to PubMed per journal,
- see unrecognized journals so you can report them to improve coverage.

### ⚙️ Access helper (advanced)
Optional network helper (redirects Google reCAPTCHA frames to recaptcha.net etc.) used when NCBI serves an anti-bot check. It can be turned off in the popup (Network / Advanced); note that it involves browser-detection workarounds and should be used at your own discretion.

## Data
`data/filter_data.json` (18,979 SCI journals with IF/JCR/CAS metrics) and `data/pubmed_abb_data.json` (35,859 PubMed journal abbreviations) are bundled as a local snapshot and may lag the latest JCR/CAS releases.

## Development
Plain MV3 extension, no build step. Load the folder via `chrome://extensions` → Developer mode → Load unpacked.
