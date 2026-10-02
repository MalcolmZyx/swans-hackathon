"""
Read every case PDF page by page and line by line, keeping each line's position on the page,
then find the passage that best supports a piece of dashboard text.

Pages with a text layer are read directly. Scanned pages are read with the Windows OCR engine
(Windows 10/11, see requirements below); on other systems scanned pages stay unsearchable.
Each document's text is cached in dashboard/data/pdf_text/<document id>.json, so OCR only
runs when a file is new or changed.

Windows OCR needs:  pip install winrt-runtime winrt-Windows.Media.Ocr winrt-Windows.Graphics.Imaging
                    winrt-Windows.Storage.Streams winrt-Windows.Foundation winrt-Windows.Foundation.Collections
"""
import asyncio
import json
import math
import os
import re

import pdfplumber
import pypdfium2 as pdfium

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, "dashboard", "data", "documents")
CACHE = os.path.join(HERE, "dashboard", "data", "pdf_text")
CACHE_VERSION = 1

# A page with fewer characters than this in its text layer is treated as a scan.
MIN_TEXT_CHARS = 200
# Longest side of the image handed to OCR, in pixels.
OCR_MAX_SIDE = 3200


# ---------- Reading pages ----------

def _norm_box(x0, y0, x1, y1, w, h):
    return [round(max(0, x0 / w), 4), round(max(0, y0 / h), 4), round(min(1, x1 / w), 4), round(min(1, y1 / h), 4)]


def _text_layer_lines(page):
    x_off, y_off = page.bbox[0], page.bbox[1]
    lines = []
    for ln in page.extract_text_lines(strip=True, return_chars=False):
        text = ln["text"].strip()
        if text:
            lines.append([text, *_norm_box(ln["x0"] - x_off, ln["top"] - y_off, ln["x1"] - x_off, ln["bottom"] - y_off, page.width, page.height)])
    return lines


class _WindowsOcr:
    def __init__(self):
        from winrt.windows.graphics.imaging import BitmapPixelFormat, SoftwareBitmap
        from winrt.windows.media.ocr import OcrEngine
        from winrt.windows.storage.streams import DataWriter

        self.engine = OcrEngine.try_create_from_user_profile_languages()
        if self.engine is None:
            raise RuntimeError("no OCR language installed")
        self._bitmap, self._gray, self._writer = SoftwareBitmap, BitmapPixelFormat.GRAY8, DataWriter

    def lines(self, image):
        """OCR a PIL image; returns [text, x0, y0, x1, y1] per line, positions as page fractions."""
        img = image.convert("L")
        w, h = img.size
        writer = self._writer()
        writer.write_bytes(img.tobytes())
        bitmap = self._bitmap.create_copy_from_buffer(writer.detach_buffer(), self._gray, w, h)
        result = asyncio.run(self._recognize(bitmap))
        out = []
        for line in result.lines:
            rects = [word.bounding_rect for word in line.words]
            if not rects:
                continue
            x0 = min(r.x for r in rects)
            y0 = min(r.y for r in rects)
            x1 = max(r.x + r.width for r in rects)
            y1 = max(r.y + r.height for r in rects)
            out.append([line.text.strip(), *_norm_box(x0, y0, x1, y1, w, h)])
        # Reading order: top to bottom, then left to right.
        out.sort(key=lambda ln: (round((ln[2] + ln[4]) / 2, 2), ln[1]))
        return out

    async def _recognize(self, bitmap):
        return await self.engine.recognize_async(bitmap)


_ocr = None


def _get_ocr():
    global _ocr
    if _ocr is None:
        try:
            _ocr = _WindowsOcr()
        except Exception as e:  # not on Windows, bindings missing, or no OCR language
            print(f"    OCR unavailable ({e}); scanned pages will not be searchable")
            _ocr = False
    return _ocr or None


def read_document(doc_id):
    """Pages of one PDF: [{"w", "h", "ocr", "lines": [[text, x0, y0, x1, y1], ...]}]."""
    path = os.path.join(DOCS, f"{doc_id}.pdf")
    rendered = pdfium.PdfDocument(path)
    pages = []
    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages):
            r = rendered[i]
            w, h = r.get_size()  # as displayed, after any page rotation
            entry = {"w": round(w, 1), "h": round(h, 1), "ocr": False, "lines": []}
            if len(page.chars) >= MIN_TEXT_CHARS and r.get_rotation() == 0:
                entry["lines"] = _text_layer_lines(page)
            elif (ocr := _get_ocr()) is not None:
                scale = min(2.0, OCR_MAX_SIDE / max(w, h))
                entry["lines"] = ocr.lines(r.render(scale=scale).to_pil())
                entry["ocr"] = True
            pages.append(entry)
    return pages


def load_documents(doc_ids):
    """{doc id: pages} for every downloaded document, read from cache where possible."""
    os.makedirs(CACHE, exist_ok=True)
    out = {}
    for doc_id in doc_ids:
        pdf_path = os.path.join(DOCS, f"{doc_id}.pdf")
        if not os.path.exists(pdf_path):
            continue
        size = os.path.getsize(pdf_path)
        cache_path = os.path.join(CACHE, f"{doc_id}.json")
        cached = None
        if os.path.exists(cache_path):
            with open(cache_path, encoding="utf-8") as f:
                cached = json.load(f)
        # Rebuild if the file changed, or if OCR is now available for pages that were skipped.
        stale = not cached or cached["size"] != size or cached["version"] != CACHE_VERSION
        if not stale and any(not p["lines"] and not p["ocr"] for p in cached["pages"]):
            stale = _get_ocr() is not None
        if stale:
            print(f"    reading {doc_id}.pdf ...", flush=True)
            cached = {"version": CACHE_VERSION, "size": size, "pages": read_document(doc_id)}
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(cached, f, ensure_ascii=False, separators=(",", ":"))
        out[doc_id] = cached["pages"]
    return out


# ---------- Finding passages ----------

MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
_MONTH = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
_DATES = [
    (re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b"), lambda m: (m[1], m[2], m[3])),
    (re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4}|\d{2})\b"), lambda m: (m[3], m[1], m[2])),
    (re.compile(r"\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b"), lambda m: (m[3], m[1], m[2])),  # 7.26.23 in file names
    (re.compile(rf"\b{_MONTH}\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})\b", re.I), lambda m: (m[3], MONTHS[m[1][:3].lower()], m[2])),
    (re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+{_MONTH},?\s+(\d{{4}})\b", re.I), lambda m: (m[3], MONTHS[m[2][:3].lower()], m[1])),
]
_NUMBER = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+")
_WORD = re.compile(r"[a-z0-9]+")
STOPWORDS = set("""
a about above after again against all also am an and any are as at be because been before being below between both but by
can could did do does doing down during each few for from further had has have having he her here hers him his how i if in
into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should so
some such than that the their them then there these they this those through to too under until up very was we were what
when where which while who whom why will with would you your yours yes per via re mr ms dr
""".split())


def _date_token(y, m, d):
    y = int(y)
    if y < 100:
        y += 2000 if y < 50 else 1900
    try:
        m, d = int(m), int(d)
    except ValueError:
        return " "
    if not (1 <= m <= 12 and 1 <= d <= 31):
        return " "
    return f" d{y:04d}{m:02d}{d:02d}"  # no trailing space, so a full stop after it still ends the sentence


def _number_token(m):
    n = m[0].replace(",", "")
    if "." in n:
        whole, frac = n.split(".", 1)
        n = whole if set(frac) == {"0"} else n.replace(".", "p")
    return f" {n}"


def _stem(w):
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss") and not w[-2].isdigit():
        return w[:-1]
    return w


def _normalize(text):
    """Dates and amounts in one canonical form, lowercased."""
    t = text.replace("’", "'").replace("—", " ").replace("–", " ")
    for pattern, parts in _DATES:
        t = pattern.sub(lambda m: _date_token(*parts(m)), t)
    return _NUMBER.sub(_number_token, t).lower()


def _words(normalized):
    return [_stem(w) for w in _WORD.findall(normalized) if len(w) > 1 and w not in STOPWORDS]


def tokens(text):
    """Comparable terms: dates and amounts in one canonical form, light stemming, no stopwords."""
    return _words(_normalize(text))


# A sentence ends at . ! ? or ; after a whole word or number, not after an initial or a short
# abbreviation ("Melinda L. Miller", "Dr. Capiola", "M.D.", "P.O. Box").
_SENTENCE = re.compile(r"(?<=[a-z0-9)\]]{3})[.!?;]\s+|\n")


def sentence_tokens(text):
    """Terms per sentence, so word pairs never span two sentences. Splits after dates and amounts
    are normalized, so "Apr. 23" and "$118,400.00" survive."""
    return [_words(s) for s in _SENTENCE.split(_normalize(text))]


_YEAR = re.compile(r"^(19|20)\d\d$")


def _pairs(toks, gap=2):
    """Ordered word pairs up to `gap` apart: phrases shared with a passage, tolerant of a word or so in between."""
    out = set()
    for i, a in enumerate(toks):
        for b in toks[i + 1:i + 1 + gap]:
            if a != b:
                out.add((a, b))
    return out


def _is_anchor(t):
    """A specific identifier: a date, an amount, a claim or plate number. Bare years are too common."""
    return len(t) >= 3 and any(c.isdigit() for c in t) and not _YEAR.match(t)


def strip_phrases(toks, phrases):
    """Drop every occurrence of the given token sequences (longest first) from a token list."""
    out, i = [], 0
    ordered = sorted(phrases, key=len, reverse=True)
    while i < len(toks):
        for p in ordered:
            if toks[i:i + len(p)] == list(p):
                i += len(p)
                break
        else:
            out.append(toks[i])
            i += 1
    return out


class PassageFinder:
    """
    Finds the passage a piece of case text came from. Each page is scanned in windows of up to
    five lines. A window counts as support only when it shares the text's wording, not just its
    vocabulary: several ordered word pairs, or specific identifiers (dates, amounts, claim
    numbers). Rare terms weigh more than common ones.
    """

    WINDOW = 5  # lines

    def __init__(self, documents, titles=None):
        """documents: {doc id: pages from load_documents}. titles: {doc id: file name}, so a record
        that names a document ("HIPAA authorization") prefers the document named that way."""
        self.titles = {doc_id: set(tokens(t)) for doc_id, t in (titles or {}).items()}
        self.pages = []  # (doc id, page index, [token set per line], [word pairs per line], lines)
        df = {}
        for doc_id, pages in documents.items():
            for i, page in enumerate(pages):
                texts = [ln[0] for ln in page["lines"]]
                line_tokens = [tokens(t) for t in texts]
                if not any(line_tokens):
                    continue
                # A phrase can run onto the next line, but not into the next sentence.
                pairs = []
                for j, t in enumerate(texts):
                    joined = t + " " + " ".join(texts[j + 1].split()[:3]) if j + 1 < len(texts) else t
                    pairs.append(set().union(*(_pairs(seg) for seg in sentence_tokens(joined))))
                self.pages.append((doc_id, i, [set(t) for t in line_tokens], pairs, page["lines"]))
                for t in set().union(*map(set, line_tokens)):
                    df[t] = df.get(t, 0) + 1
        n = len(self.pages)
        self.idf = {t: math.log((n + 1) / (c + 0.5)) for t, c in df.items()}

    def query(self, text, ignore=()):
        """The query's terms, minus `ignore` phrases (token tuples) such as the names of the parties."""
        segments = [strip_phrases(seg, ignore) if ignore else seg for seg in sentence_tokens(text)]
        segments = [[t for t in seg if t in self.idf] for seg in segments]
        q = {t for seg in segments for t in seg}
        q_pairs = set().union(*(_pairs(seg) for seg in segments)) if segments else set()
        return q, q_pairs, sum(self.idf[t] for t in q)

    def best_window(self, page, q, q_pairs, require=None):
        """Highest-ranked window on one page: (rank, u, n_phrases, pw, anchors, start, end), or None."""
        idf = self.idf
        _, _, line_sets, line_pairs, lines = page
        per_line = [s & q for s in line_sets]
        best = None
        for start in range(len(lines)):
            if not per_line[start]:
                continue  # windows start and end on a matching line
            found, phrases, end = set(), set(), start
            for j in range(start, min(start + self.WINDOW, len(lines))):
                if per_line[j]:
                    found |= per_line[j]
                    phrases |= line_pairs[j] & q_pairs
                    end = j
            if require and not (found & require):
                continue
            u = sum(idf[t] for t in found)
            pw = sum(min(idf[a], idf[b]) for a, b in phrases)
            anchors = sorted(t for t in found if _is_anchor(t))
            rank = u + pw + 2 * sum(idf[t] for t in anchors)
            if best is None or rank > best[0]:
                # Phrase strength: distinct words the shared pairs cover, less one, so a three-word
                # phrase counts 2 however many of its pairs match.
                n_phrases = max(0, len({t for pair in phrases for t in pair}) - 1)
                best = (rank, u, n_phrases, pw, anchors, start, end)
        return best

    # An identifier on fewer pages than this (by idf) is specific enough to count on its own; the
    # date of the accident or the claim number in every letterhead is not.
    RARE_IDF = 3.0

    def supported(self, window, q, total, title_weight=0.0):
        """Whether a window shares enough of the query's wording to count as its source."""
        rank, u, n_phrases, pw, anchors, start, end = window
        rare = [t for t in anchors if self.idf[t] >= self.RARE_IDF]
        return bool(
            # Shares the wording: a few ordered word pairs carrying a fair share of the query's weight.
            (n_phrases >= 3 and pw >= max(min(8.0, 0.6 * total), 0.1 * total))
            # The value is an identifier (a date, a claim number) and it is all here.
            or (anchors and u >= 0.8 * total)
            # Rare identifiers alongside the query's wording.
            or (rare and (n_phrases >= 2 or (len(rare) >= 2 and n_phrases >= 1)))
            # A short name or value, found whole and in order.
            or (len(q) <= 5 and u >= 0.9 * total and n_phrases >= 1)
            # The document is named for the query and this page mentions it.
            or (title_weight >= 0.6 * total and u >= 0.6 * total)
        )

    def find(self, text, ignore=(), require=None, doc_ids=None, limit=3, accept_any=False):
        """
        Passages supporting `text`, best first, at most one per document:
        [{"doc", "page" (1-based), "rects", "text", "score"}].
        ignore: phrases (token tuples) that do not count as support, such as the parties' names.
        require: terms a passage must contain, such as a bill's amount.
        accept_any: return the best window even when weak, for a search already narrowed to the right document.
        """
        q, q_pairs, total = self.query(text, ignore)
        if not q:
            return []
        if require is not None:
            require = {t for t in require if t in q}
            if not require:
                return []
        hits = []
        title_weight = {d: sum(self.idf[t] for t in q & toks) for d, toks in self.titles.items()}
        for page in self.pages:
            doc_id, page_index, line_sets, _, lines = page
            if doc_ids is not None and doc_id not in doc_ids:
                continue
            window = self.best_window(page, q, q_pairs, require)
            tw = title_weight.get(doc_id, 0.0)
            if window and (accept_any or self.supported(window, q, total, tw)):
                hits.append(((window[0] + tw, *window[1:]), doc_id, page_index, lines))
        hits.sort(key=lambda h: -h[0][0])
        out, seen_docs = [], set()
        for window, doc_id, page_index, lines in hits:
            if doc_id in seen_docs:
                continue  # one passage per document; the rest of the list shows other documents
            seen_docs.add(doc_id)
            start, end = window[5], window[6]
            span = lines[start:end + 1]
            out.append({"doc": doc_id, "page": page_index + 1, "rects": [ln[1:] for ln in span],
                        "text": " ".join(ln[0] for ln in span), "score": round(min(1.0, window[1] / total), 2)})
            if len(out) == limit:
                break
        return out
