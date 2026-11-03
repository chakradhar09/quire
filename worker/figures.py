"""Perceptual hashes (pHash) of a draft's pictures, to spot a figure reused in another of your uploads.
Nothing is searched on the web: the hashes stay in the figures table and are compared there.

pHash: the picture in grey at 32 x 32, its 2-D DCT, and one bit for each of the 8 x 8 lowest
frequencies: above or below their median, the constant term left out of the median. Resizing,
recompression and small colour changes leave most bits alone; another picture flips about half.
"""
import numpy as np

SIZE, LOW = 32, 8
SAME = 10  # bits of 64; in figures_test copies were 0-6 apart, different charts 16 or more
_k = np.arange(SIZE)
DCT = np.cos(np.pi * (2 * _k[None, :] + 1) * _k[:, None] / (2 * SIZE))  # DCT-II basis, rows are frequencies


def phash(image):
    """16 hex digits."""
    from PIL import Image
    grey = np.asarray(image.convert("L").resize((SIZE, SIZE), Image.Resampling.LANCZOS), dtype=float)
    low = (DCT @ grey @ DCT.T)[:LOW, :LOW].flatten()
    bits = low > np.median(low[1:])
    return f"{int(''.join('1' if b else '0' for b in bits), 2):016x}"


def distance(a, b):
    """Bits that differ between two hashes."""
    return (int(a, 16) ^ int(b, 16)).bit_count()
