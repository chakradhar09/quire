"""Read an uploaded file's text. Every way a file can fail becomes Rejected(reason), with a reason
the schema knows (documents.reject_reason), so a draft is never left stuck at "extracting".

These are your own files, so the realistic failure is a broken export, not an attack; the zip and
page caps still stop a pathological file from eating the worker.

Besides paragraphs and table rows (cells split by a tab), a DOCX gives its text boxes, the titles, axis
titles, series and categories of its charts, and the text OCR finds in its pictures, each where it sits;
a PDF gives the OCR text of its pictures between the lines above and below them. OCR is RapidOCR, run on
this PC; pictures under MIN_IMAGE_INCHES on a side (icons, logos) are skipped, and a document gets at most
OCR_SECONDS of it.
"""
import io
import pathlib
import time
import zipfile

from text import normalize

MAX_PAGES = 800
MAX_UNZIPPED = 200 * 1024 * 1024
MIN_IMAGE_INCHES = 0.75
OCR_SECONDS = 60
OCR_MAX_SIDE = 2000  # pixels; bigger pictures are scaled down first, which keeps OCR to a few seconds each


class Rejected(Exception):
    def __init__(self, reason, detail=""):
        super().__init__(detail or reason)
        self.reason = reason


MATH = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
CHART = "{http://schemas.openxmlformats.org/drawingml/2006/chart}"
WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
FALLBACK = "{http://schemas.openxmlformats.org/markup-compatibility/2006}Fallback"
EMU_PER_INCH = 914400

_engine = None


def _ocr(image):
    """Lines of text in a PIL image, top to bottom, read on this PC."""
    global _engine
    import numpy as np
    from PIL import Image
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _engine = RapidOCR()
    if image.mode in ("RGBA", "LA", "P"):  # transparent pixels would turn black and hide black text
        image = image.convert("RGBA")
        flat = Image.new("RGB", image.size, "white")
        flat.paste(image, mask=image.getchannel("A"))
        image = flat
    image = image.convert("RGB")
    image.thumbnail((OCR_MAX_SIDE, OCR_MAX_SIDE))
    found, _ = _engine(np.array(image))
    lines = []  # boxes whose middles are within half a box height of each other are one line
    for box, text, score in sorted(found or [], key=lambda r: r[0][0][1] + r[0][2][1]):
        if score < 0.5:
            continue
        mid, height = (box[0][1] + box[2][1]) / 2, box[2][1] - box[0][1]
        if lines and abs(mid - lines[-1][0]) < height / 2:
            lines[-1][1].append((box[0][0], text))
        else:
            lines.append([mid, [(box[0][0], text)]])
    return [" ".join(t for _, t in sorted(parts)) for _, parts in lines]


class _Pictures:
    """A document's pictures as they are read: each one's pHash (figures.py) kept in order, and its OCR lines
    while the document's OCR_SECONDS last, so a file full of pictures can't hold the worker."""
    def __init__(self, hashes):
        self.until, self.hashes = time.monotonic() + OCR_SECONDS, hashes

    def read(self, image):
        from figures import phash
        self.hashes.append(phash(image))
        return _ocr(image) if time.monotonic() < self.until else []


def _chart(blob):
    """A Word chart's title, axis titles, series names and category labels, a line each (the latter two joined)."""
    from lxml import etree
    root = etree.fromstring(blob, etree.XMLParser(resolve_entities=False, no_network=True))

    def text(node):
        return "".join(t.text or "" for t in node.iter(f"{A}t", f"{CHART}v")).strip() if node is not None else ""
    lines = [text(root.find(f"{CHART}chart/{CHART}title"))]
    for ax in root.iterfind(f"{CHART}chart/{CHART}plotArea/*"):
        if ax.tag in (f"{CHART}catAx", f"{CHART}valAx", f"{CHART}dateAx", f"{CHART}serAx"):
            lines.append(text(ax.find(f"{CHART}title")))
    series = list(root.iter(f"{CHART}ser"))
    lines.append(", ".join(filter(None, (text(s.find(f"{CHART}tx")) for s in series))))
    if series and series[0].find(f"{CHART}cat") is not None:
        lines.append(", ".join(v.text or "" for v in series[0].find(f"{CHART}cat").iter(f"{CHART}v")))
    return [line for line in lines if line]


WEB_IMAGES = {"PNG": "png", "JPEG": "jpg", "GIF": "gif", "WEBP": "webp"}


def _web_image(image, blob):
    """(extension, bytes) a browser can show: the picture as stored, or converted to PNG (TIFF, BMP...)."""
    if image.format in WEB_IMAGES:
        return WEB_IMAGES[image.format], blob
    out = io.BytesIO()
    image.save(out, "PNG")
    return "png", out.getvalue()


def _extras(element, part, pictures):
    """What a paragraph holds outside its runs' text, in order: ("box", lines) for a text box, ("chart", lines),
    and ("img", OCR lines, (extension, bytes), width in CSS pixels) for a picture. A text box is written twice,
    as DrawingML in mc:Choice and as VML in mc:Fallback; only the first is read. Every picture a browser can
    show is kept for the viewer; only those of at least MIN_IMAGE_INCHES are hashed and OCRed."""
    from PIL import Image
    items = []
    for child in element:
        if child.tag == FALLBACK:
            continue
        if child.tag == f"{W}txbxContent":
            lines = ["".join(t.text or "" for t in p.iter(f"{W}t", f"{MATH}t")) for p in child.iter(f"{W}p")]
            if any(lines):
                items.append(("box", [line for line in lines if line]))
        elif child.tag == f"{CHART}chart" and child.get(f"{REL}id") in part.related_parts:
            items.append(("chart", _chart(part.related_parts[child.get(f"{REL}id")].blob)))
        elif child.tag == f"{A}blip" and child.get(f"{REL}embed") in part.related_parts:
            frame = next(child.iterancestors(f"{WP}inline", f"{WP}anchor"), None)
            extent = frame.find(f"{WP}extent") if frame is not None else None
            cx, cy = (int(extent.get("cx")), int(extent.get("cy"))) if extent is not None else (0, 0)
            blob = part.related_parts[child.get(f"{REL}embed")].blob
            try:
                image = Image.open(io.BytesIO(blob))
                image.load()
            except Exception:  # EMF, WMF and the like: no pixels to read or show
                continue
            shown = _web_image(image, blob)
            lines = pictures.read(image) if min(cx, cy) >= MIN_IMAGE_INCHES * EMU_PER_INCH else []
            items.append(("img", lines, shown, round(cx * 96 / EMU_PER_INCH) or None))
        else:
            items += _extras(child, part, pictures)
    return items


class _Layout:
    """The text a DOCX reads as, built part by part (a part per line), and the blocks the viewer draws it
    from, each pointing at its text as [start, end] offsets. Parts are normalized as they are added, so
    main.extract's normalize leaves the text, and with it every offset, as it is."""
    def __init__(self):
        self.parts, self.size, self.blocks, self.pictures = [], 0, [], []

    def _add(self, text):
        start = self.size + (1 if self.parts else 0)
        self.parts.append(text)
        self.size = start + len(text)
        return start

    def line(self, text):
        start = self._add(normalize(text))
        return [start, self.size]

    def paragraph(self, kind, text, align=None):
        self.blocks.append({"t": kind, "r": self.line(text), **({"align": align} if align else {})})

    def row(self, cells):
        """A table row as one line, cells split by a tab; the cells' [start, end]."""
        cells = [normalize(c) for c in cells]
        pos, ranges = self._add("\t".join(cells)), []
        for c in cells:
            ranges.append([pos, pos + len(c)])
            pos += len(c) + 1
        return ranges

    def extra(self, item):
        kind, lines = item[0], [self.line(line) for line in item[1]]
        if kind != "img":
            self.blocks.append({"t": kind, "lines": lines})
            return
        self.pictures.append(item[2])
        self.blocks.append({"t": "img", "n": len(self.pictures), "w": item[3], "ocr": lines})

    def text(self):
        return "\n".join(self.parts)


def _kind(p):
    """How the viewer draws a paragraph, from its Word style: title, h1-h4, li, caption or p."""
    try:
        name = p.style.name if p.style is not None else ""
    except Exception:  # a style the document names but doesn't define
        name = ""
    if name == "Title":
        return "title"
    if name.startswith("Heading ") and name[8:].isdigit():
        return f"h{min(max(int(name[8:]), 1), 4)}"
    if name == "Caption":
        return "caption"
    if name.startswith("List") or (p._p.pPr is not None and p._p.pPr.numPr is not None):
        return "li"
    return "p"


def _paragraph(p):
    """A paragraph's text with its equations, which python-docx's .text skips. An equation reads as its
    symbols in order, so a fraction h over 2π comes out as h2π."""
    # ponytail: symbols only, no linear form (h/(2π)); add it if equations ever need to match exactly
    from docx.oxml.text.hyperlink import CT_Hyperlink
    from docx.oxml.text.run import CT_R
    from docx.text.hyperlink import Hyperlink
    from docx.text.run import Run
    parts = []
    for child in p._p:
        if child.tag == f"{MATH}oMath" or child.tag == f"{MATH}oMathPara":
            parts.append("".join(t.text or "" for t in child.iter(f"{MATH}t")))
        elif isinstance(child, CT_R):
            parts.append(Run(child, p).text)
        elif isinstance(child, CT_Hyperlink):
            parts.append(Hyperlink(child, p).text)
    return "".join(parts)


ALIGN = {1: "center", 2: "right"}  # WD_ALIGN_PARAGRAPH.CENTER, .RIGHT


def _docx(path, _max_pages, figures, layout):
    import docx
    from docx.table import Table, _Cell
    document, pictures, built = docx.Document(str(path)), _Pictures(figures), _Layout()
    for block in document.iter_inner_content():
        if isinstance(block, Table):
            rows, extras = [], []
            for row in block.rows:
                tcs = row._tr.tc_lst  # each cell once: row.cells repeats a merged cell for every column it spans
                ranges = built.row(["\n".join(map(_paragraph, _Cell(tc, block).paragraphs)) for tc in tcs])
                rows.append([{"r": r, **({"span": tc.grid_span} if tc.grid_span > 1 else {})} for r, tc in zip(ranges, tcs)])
                extras += _extras(row._tr, document.part, pictures)
            built.blocks.append({"t": "table", "rows": rows})
            for item in extras:
                built.extra(item)
        else:
            text, extras = _paragraph(block), _extras(block._p, document.part, pictures)
            if text or not extras:
                built.paragraph(_kind(block), text, None if block.alignment is None else ALIGN.get(int(block.alignment)))
            for item in extras:
                built.extra(item)
    layout.update(blocks=built.blocks, pictures=built.pictures)
    return built.text(), None


def _odt(path, _max_pages, _figures, _layout):
    from odf import teletype
    from odf.namespaces import TEXTNS
    from odf.opendocument import load
    parts = []

    def walk(node):  # paragraphs and headings in document order, also inside lists, sections and tables
        for child in node.childNodes:
            if child.nodeType != child.ELEMENT_NODE:
                continue
            if child.qname in ((TEXTNS, "p"), (TEXTNS, "h")):
                parts.append(teletype.extractText(child))
            else:
                walk(child)
    walk(load(str(path)).text)
    return "\n".join(parts), None


def _pdf(path, max_pages, figures, _layout):
    import pdfplumber
    with pdfplumber.open(path) as pdf:
        count = len(pdf.pages)
        if count > max_pages:
            raise Rejected("too_many_pages", f"{count} pages; the limit is {max_pages}")
        texts, chars, pictures = [], 0, _Pictures(figures)
        for page in pdf.pages:
            chars += len(page.chars)
            texts.append(_pdf_page(page, pictures))
            page.close()  # drop the page's parsed objects; long PDFs otherwise pile up in memory
    if count and not chars:
        raise Rejected("image_only_pdf", "no selectable text on any page")
    return "\n\n".join(texts), count


def _pdf_page(page, pictures):
    """A page's text, with the OCR text of each picture placed by its top among the lines. A page with no
    text at all is a scan, not a page with figures: it is left to the image_only_pdf check."""
    side = MIN_IMAGE_INCHES * 72
    shown = [i for i in page.images if i["x1"] - i["x0"] >= side and i["bottom"] - i["top"] >= side] if page.chars else []
    if not shown:
        return page.extract_text() or ""
    lines = [(line["top"], line["text"]) for line in page.extract_text_lines()]
    for i in shown:
        box = (max(i["x0"], page.bbox[0]), max(i["top"], page.bbox[1]), min(i["x1"], page.bbox[2]), min(i["bottom"], page.bbox[3]))
        found = pictures.read(page.crop(box).to_image(resolution=150).original)
        if found:
            lines.append((i["top"], "\n".join(found)))
    return "\n".join(text for _, text in sorted(lines, key=lambda t: t[0]))


def _rtf(path, _max_pages, _figures, _layout):
    from striprtf.striprtf import rtf_to_text
    return rtf_to_text(path.read_bytes().decode("cp1252", errors="replace")), None


def _txt(path, _max_pages, _figures, _layout):
    data = path.read_bytes()
    try:
        return data.decode("utf-8-sig"), None
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace"), None


READERS = {".docx": _docx, ".odt": _odt, ".pdf": _pdf, ".rtf": _rtf, ".txt": _txt}


def read_file(path, max_unzipped=MAX_UNZIPPED, max_pages=MAX_PAGES, figures=None, layout=None):
    """(text, page_count or None) of a .docx, .odt, .pdf, .rtf or .txt file, or raise Rejected. A list passed
    as figures gets the pHash of each DOCX or PDF picture big enough to read, in document order. A dict passed
    as layout gets, for a DOCX, "blocks" (see _Layout) and "pictures", [(extension, bytes)] for the viewer."""
    path = pathlib.Path(path)
    reader = READERS.get(path.suffix.lower())
    if reader is None:
        raise Rejected("unsupported_type", path.suffix or "no extension")
    try:
        if path.suffix.lower() in (".docx", ".odt"):
            with zipfile.ZipFile(path) as z:
                size = sum(info.file_size for info in z.infolist())
            if size > max_unzipped:
                raise Rejected("extraction_failed", f"uncompressed size {size} bytes is over the {max_unzipped} limit")
        return reader(path, max_pages, [] if figures is None else figures, {} if layout is None else layout)
    except Rejected:
        raise
    except Exception as e:  # any parser failure: the file is unreadable, not the worker broken
        raise Rejected("extraction_failed", f"{type(e).__name__}: {e}") from e
