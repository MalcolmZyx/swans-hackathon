# swans-hackathon

Case Desk: a lawyer dashboard and a medical provider dashboard built from Clio Manage case data.

## Setup

1. Put your Clio app credentials in `.env` (see the top of `clio_quickstart.py`).
2. `python clio_quickstart.py`: approve access in the browser once. The token is saved to `.clio_token.json`.
3. `python explore_clio.py`: pulls every case resource with all fields into `data/raw/`, and every case PDF into `dashboard/data/documents/`.
4. `python build_dashboard_data.py`: normalizes it into `dashboard/data/case.json` and finds the PDF passage behind each value (`pdf_text.py`). Scanned pages are read with Windows OCR, which needs `pip install winrt-runtime winrt-Windows.Media.Ocr winrt-Windows.Graphics.Imaging winrt-Windows.Storage.Streams winrt-Windows.Foundation winrt-Windows.Foundation.Collections`. The first run OCRs about 500 pages in roughly 5 minutes; results are cached in `dashboard/data/pdf_text/`.

## Run the dashboards

```
cd dashboard
npm install
npm run dev
```

Open http://localhost:3000. **Refresh from Clio** in the header reruns steps 3 and 4.

- `/lawyer`: case stage, a one-minute brief, key numbers, tasks, records requests, the full timeline, parties, documents, costs and case facts.
- `/provider?provider=<contact id>`: one treating provider's view. Attorney notes, legal case facts, insurer correspondence and other providers' bills are filtered out on the server (`dashboard/lib/data.ts`, `providerView`).

Every value has a **source** chip. Clicking it opens a sidebar with the case PDF the value came from, scrolled to the page with the matching lines highlighted (`dashboard/components/SourceViewer.tsx`). Clio does not record page references, so passages are found by matching the record's wording; values with no matching passage show the Clio record they were read from. Providers only see passages in their own medical records.

`data/` and `dashboard/data/` hold client data and are git-ignored.
