"""Perceptual hashes of a draft's pictures: the same figure resized or recompressed hashes alike, another does not."""
import io
import unittest

from PIL import Image, ImageDraw

from figures import distance, phash


def chart(seed, size=(640, 400)):
    """A bar chart-like picture whose bars depend on seed."""
    img = Image.new("RGB", size, "white")
    d = ImageDraw.Draw(img)
    for i in range(6):
        h = 40 + (seed * 37 + i * 53) % 300
        d.rectangle((40 + i * 95, size[1] - 20 - h, 100 + i * 95, size[1] - 20), fill=(30 + i * 30, 90, 160))
    d.line((30, 20, 30, size[1] - 20), fill="black", width=3)
    return img


class PhashTest(unittest.TestCase):
    def test_hex_of_64_bits(self):
        self.assertRegex(phash(chart(1)), r"^[0-9a-f]{16}$")

    def test_resized_and_recompressed_copies_stay_close(self):
        original = chart(1)
        buf = io.BytesIO()
        original.resize((320, 200)).save(buf, "JPEG", quality=40)
        copy = Image.open(io.BytesIO(buf.getvalue()))
        self.assertLessEqual(distance(phash(original), phash(copy)), 6)

    def test_a_different_figure_is_far(self):
        self.assertGreater(distance(phash(chart(1)), phash(chart(2))), 12)


if __name__ == "__main__":
    unittest.main()
