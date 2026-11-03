"""extract.read_file on files built in the test: no fixtures checked in, nothing downloaded."""
import pathlib
import tempfile
import unittest
import zipfile

import docx
from odf.opendocument import OpenDocumentText
from odf.text import H, List, ListItem, P

from extract import Rejected, read_file


def make_pdf(pages, image_at=None, after=()):
    """A minimal valid PDF. Each page is a list of text lines; an empty list draws a line and no text,
    which is what a scanned page looks like to a text extractor. image_at puts a 300 x 150 pt grey image
    with its top at that height on the first page, and `after` lines below it."""
    objects = {1: "<< /Type /Catalog /Pages 2 0 R >>", 3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"}
    kids, num = [], 4
    for n, lines in enumerate(pages):
        body = ("BT /F1 12 Tf 14 TL 72 720 Td " + " T* ".join(f"({line}) Tj" for line in lines) + " ET") if lines \
            else "0 0 m 200 200 l S"
        if image_at is not None and n == 0:
            body += f" q 300 0 0 150 72 {image_at - 150} cm BI /W 2 /H 2 /CS /G /BPC 8 ID \x80\x80\x80\x80 EI Q"
            body += f" BT /F1 12 Tf 14 TL 72 {image_at - 180} Td " + " T* ".join(f"({line}) Tj" for line in after) + " ET"
        objects[num] = (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {num + 1} 0 R"
                        " /Resources << /Font << /F1 3 0 R >> >> >>")
        objects[num + 1] = f"<< /Length {len(body)} >>\nstream\n{body}\nendstream"
        kids.append(f"{num} 0 R")
        num += 2
    objects[2] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
    out, offsets = b"%PDF-1.4\n", {}
    for i in sorted(objects):
        offsets[i] = len(out)
        out += f"{i} 0 obj\n{objects[i]}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {num}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{offsets[i]:010d} 00000 n \n".encode() for i in range(1, num))
    out += f"trailer\n<< /Size {num} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


class ReadFileTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(tmp.cleanup)
        self.dir = pathlib.Path(tmp.name)

    def path(self, name, data=None):
        p = self.dir / name
        if data is not None:
            p.write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))
        return p

    def test_docx_paragraphs_and_tables_in_order(self):
        d = docx.Document()
        d.add_heading("Mangroves", level=1)
        d.add_paragraph("Their tangled roots slow the tide.")
        table = d.add_table(rows=1, cols=2)
        table.rows[0].cells[0].text = "Carbon"
        table.rows[0].cells[1].text = "stored per hectare"
        d.add_paragraph("They shelter young fish.")
        d.save(self.path("essay.docx"))

        text, pages = read_file(self.path("essay.docx"))

        # A tab between cells, as Word copies a row, so the AI estimate can tell a table row from prose.
        self.assertEqual(text.split("\n"), ["Mangroves", "Their tangled roots slow the tide.",
                                            "Carbon\tstored per hectare", "They shelter young fish."])
        self.assertIsNone(pages)

    def test_docx_layout_points_each_block_at_its_text(self):
        # The viewer draws the draft from these blocks, so each [start, end] must cut exactly its own text.
        import io
        from unittest import mock
        from PIL import Image
        d = docx.Document()
        d.add_heading("Mangroves", level=1)
        d.add_paragraph("Their tangled roots slow the tide.").alignment = 1  # centred
        d.add_paragraph("Roots trap silt", style="List Bullet")
        a, b, c = d.add_table(rows=1, cols=3).rows[0].cells
        a.merge(b).text = "Carbon"
        c.text = "stored per hectare"
        picture = io.BytesIO()
        Image.new("RGB", (200, 100), "white").save(picture, "PNG")
        d.add_picture(io.BytesIO(picture.getvalue()), width=docx.shared.Inches(2))
        d.save(self.path("laid.docx"))

        layout = {}
        with mock.patch("extract._ocr", return_value=["Figure 1: silt"]):
            text, _ = read_file(self.path("laid.docx"), layout=layout)

        def cut(r):
            return text[r[0]:r[1]]
        h, p, li, table, img = layout["blocks"]
        self.assertEqual([(x["t"], cut(x["r"])) for x in (h, p, li)],
                         [("h1", "Mangroves"), ("p", "Their tangled roots slow the tide."), ("li", "Roots trap silt")])
        self.assertEqual(p.get("align"), "center")
        self.assertEqual([[(cut(cell["r"]), cell.get("span", 1)) for cell in row] for row in table["rows"]],
                         [[("Carbon", 2), ("stored per hectare", 1)]])  # a merged cell once, not twice
        self.assertEqual((img["t"], img["n"], img["w"], [cut(r) for r in img["ocr"]]), ("img", 1, 192, ["Figure 1: silt"]))
        ((ext, data),) = layout["pictures"]
        self.assertEqual((ext, data), ("png", picture.getvalue()))

    def test_docx_text_box_once_and_not_its_vml_fallback(self):
        from docx.oxml import parse_xml
        box = ('<w:p><w:r><w:t>Boxed note on mangroves.</w:t></w:r></w:p>')
        ns = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
              'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
              'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
              'xmlns:v="urn:schemas-microsoft-com:vml"')
        d = docx.Document()
        p = d.add_paragraph("Their roots slow the tide.")
        p._p.append(parse_xml(
            f'<w:r {ns}><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:wsp><wps:txbx><w:txbxContent>{box}'
            f'</w:txbxContent></wps:txbx></wps:wsp></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox>'
            f'<w:txbxContent>{box}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>'))
        d.add_paragraph("They shelter young fish.")
        d.save(self.path("boxed.docx"))

        text, _ = read_file(self.path("boxed.docx"))

        self.assertEqual(text.split("\n"), ["Their roots slow the tide.", "Boxed note on mangroves.", "They shelter young fish."])

    def test_docx_chart_title_axes_series_and_categories(self):
        from docx.opc.constants import RELATIONSHIP_TYPE as RT
        from docx.opc.packuri import PackURI
        from docx.opc.part import Part
        from docx.oxml import parse_xml
        c = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'

        def title(t):
            return f"<c:title><c:tx><c:rich><a:p><a:r><a:t>{t}</a:t></a:r></a:p></c:rich></c:tx></c:title>"

        def ser(name):
            return (f"<c:ser><c:tx><c:strRef><c:strCache><c:pt idx=\"0\"><c:v>{name}</c:v></c:pt></c:strCache></c:strRef></c:tx>"
                    "<c:cat><c:strRef><c:strCache><c:pt idx=\"0\"><c:v>2019</c:v></c:pt><c:pt idx=\"1\"><c:v>2020</c:v></c:pt>"
                    "</c:strCache></c:strRef></c:cat></c:ser>")
        chart = (f'<c:chartSpace {c}><c:chart>{title("Carbon stored by forest type")}<c:plotArea><c:barChart>'
                 f'{ser("Mangrove")}{ser("Rainforest")}</c:barChart><c:catAx>{title("Year")}</c:catAx>'
                 f'<c:valAx>{title("Tonnes per hectare")}</c:valAx></c:plotArea></c:chart></c:chartSpace>')
        d = docx.Document()
        part = Part(PackURI("/word/charts/chart1.xml"), "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
                    chart.encode(), d.part.package)
        rid = d.part.relate_to(part, RT.CHART)
        d.add_paragraph("Mangroves store the most.")._p.append(parse_xml(
            '<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            f'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><w:drawing><a:graphic><a:graphicData>'
            f'<c:chart r:id="{rid}"/></a:graphicData></a:graphic></w:drawing></w:r>'))
        d.save(self.path("chart.docx"))

        text, _ = read_file(self.path("chart.docx"))

        self.assertEqual(text.split("\n"), ["Mangroves store the most.", "Carbon stored by forest type", "Year",
                                            "Tonnes per hectare", "Mangrove, Rainforest", "2019, 2020"])

    def test_docx_image_text_sits_where_the_image_is_and_icons_are_skipped(self):
        from unittest import mock
        d = docx.Document()
        d.add_paragraph("Their roots slow the tide.")
        d.add_picture(str(self.png("figure.png", 600, 300)), width=docx.shared.Inches(4))
        d.add_picture(str(self.png("icon.png", 32, 32)), width=docx.shared.Inches(0.3))
        d.add_paragraph("They shelter young fish.")
        d.save(self.path("figure.docx"))

        with mock.patch("extract._ocr", return_value=["Figure 1. Root density", "by depth"]) as ocr:
            text, _ = read_file(self.path("figure.docx"))

        self.assertEqual(ocr.call_count, 1)
        self.assertEqual([line for line in text.split("\n") if line],  # the icon's paragraph stays an empty line
                         ["Their roots slow the tide.", "Figure 1. Root density", "by depth", "They shelter young fish."])

    def test_pdf_image_text_sits_between_the_lines_around_it(self):
        from unittest import mock
        pdf = make_pdf([["Mangrove forests grow along tropical coasts."]], image_at=600, after=["Their roots slow the tide."])
        with mock.patch("extract._ocr", return_value=["Figure 1. Root density"]):
            text, _ = read_file(self.path("figure.pdf", pdf))
        self.assertEqual([line for line in text.split("\n") if line],
                         ["Mangrove forests grow along tropical coasts.", "Figure 1. Root density", "Their roots slow the tide."])

    def test_ocr_reads_text_in_an_image(self):
        from PIL import Image, ImageDraw, ImageFont
        from extract import _ocr
        img = Image.new("RGB", (900, 120), "white")
        ImageDraw.Draw(img).text((20, 30), "Mangrove roots trap sediment", fill="black", font=ImageFont.load_default(48))
        self.assertIn("Mangrove roots trap sediment", " ".join(_ocr(img)))

    def png(self, name, w, h):
        from PIL import Image
        p = self.dir / name
        Image.new("RGB", (w, h), "white").save(p)
        return p

    def test_docx_keeps_word_equations_in_place(self):
        # python-docx's .text skips Word's equations (m:oMath), which left "only discrete values ()".
        from docx.oxml import parse_xml
        m = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'

        def equation(*pieces):
            return parse_xml(f'<m:oMath {m}>' + "".join(f"<m:r><m:t>{p}</m:t></m:r>" for p in pieces) + "</m:oMath>")
        d = docx.Document()
        p = d.add_paragraph("A photon carries energy ")
        p._p.append(equation("E", "=", "hν"))
        p.add_run(" and no more.")
        cell = d.add_table(rows=1, cols=1).rows[0].cells[0]
        cell.paragraphs[0].add_run("Momentum ")
        cell.paragraphs[0]._p.append(equation("p", "=", "h/λ"))
        display = d.add_paragraph()._p
        display.append(parse_xml(f"<m:oMathPara {m}><m:oMath><m:r><m:t>ΔxΔp≥ħ/2</m:t></m:r></m:oMath></m:oMathPara>"))
        d.save(self.path("physics.docx"))

        text, _ = read_file(self.path("physics.docx"))

        self.assertEqual(text.split("\n"), ["A photon carries energy E=hν and no more.", "Momentum p=h/λ", "ΔxΔp≥ħ/2"])

    def test_odt_headings_paragraphs_and_lists(self):
        doc = OpenDocumentText()
        doc.text.addElement(H(outlinelevel=1, text="Mangroves"))
        doc.text.addElement(P(text="Their tangled roots slow the tide."))
        bullets = List()
        for line in ("Fish", "Crabs"):
            item = ListItem()
            item.addElement(P(text=line))
            bullets.addElement(item)
        doc.text.addElement(bullets)
        doc.text.addElement(P(text="They store carbon."))
        doc.save(str(self.path("essay.odt")))
        text, _ = read_file(self.path("essay.odt"))
        self.assertEqual(text.split("\n"), ["Mangroves", "Their tangled roots slow the tide.", "Fish", "Crabs", "They store carbon."])

    def test_pdf_text_and_page_count(self):
        text, pages = read_file(self.path("essay.pdf", make_pdf([["Mangrove forests grow", "along tropical coasts"], ["Second page text"]])))
        self.assertEqual(pages, 2)
        self.assertIn("Mangrove forests grow", text)
        self.assertIn("Second page text", text)

    def test_a_pdf_without_any_text_is_image_only(self):
        with self.assertRaises(Rejected) as caught:
            read_file(self.path("scan.pdf", make_pdf([[], []])))
        self.assertEqual(caught.exception.reason, "image_only_pdf")

    def test_a_pdf_over_800_pages_is_refused(self):
        with self.assertRaises(Rejected) as caught:
            read_file(self.path("huge.pdf", make_pdf([["page"]] * 801)))
        self.assertEqual(caught.exception.reason, "too_many_pages")

    def test_rtf(self):
        rtf = r"{\rtf1\ansi{\fonttbl\f0\fswiss Helvetica;}\f0\pard Mangrove forests grow.\par Their roots slow the tide.\par}"
        text, _ = read_file(self.path("essay.rtf", rtf))
        self.assertIn("Mangrove forests grow.", text)
        self.assertIn("Their roots slow the tide.", text)

    def test_txt_as_utf8_with_or_without_bom_then_cp1252(self):
        self.assertEqual(read_file(self.path("a.txt", "café ☕"))[0], "café ☕")
        self.assertEqual(read_file(self.path("b.txt", "﻿café".encode("utf-8")))[0], "café")
        self.assertEqual(read_file(self.path("c.txt", "café".encode("cp1252")))[0], "café")

    def test_a_zip_that_unpacks_too_big_is_refused_before_reading(self):
        with zipfile.ZipFile(self.path("bomb.docx"), "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("word/document.xml", b"0" * 2_000_000)
        with self.assertRaises(Rejected) as caught:
            read_file(self.path("bomb.docx"), max_unzipped=1_000_000)
        self.assertEqual(caught.exception.reason, "extraction_failed")
        self.assertIn("uncompressed", str(caught.exception))

    def test_a_corrupt_file_is_refused_with_the_parser_error(self):
        for name in ("broken.docx", "broken.odt", "broken.pdf"):
            with self.subTest(name=name), self.assertRaises(Rejected) as caught:
                read_file(self.path(name, b"this is not really that kind of file"))
            self.assertEqual(caught.exception.reason, "extraction_failed")

    def test_an_unknown_extension_is_unsupported(self):
        with self.assertRaises(Rejected) as caught:
            read_file(self.path("essay.pages", b"x"))
        self.assertEqual(caught.exception.reason, "unsupported_type")


if __name__ == "__main__":
    unittest.main()
