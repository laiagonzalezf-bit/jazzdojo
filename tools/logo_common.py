# Builds the JazzDojo logo SVGs: an ensō brush circle around an eighth note.
# Wordmark glyphs are converted to paths from Saira Semi Condensed (OFL), so the SVGs need no font.
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import sys, os, math, random
FONT_BOLD, FONT_MED, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
def loader(path):
    f = TTFont(path); return f.getGlyphSet(), f.getBestCmap(), f['head'].unitsPerEm
FB, FM = loader(FONT_BOLD), loader(FONT_MED)
def text_path(font, txt, size, x0, y0, track=0):
    gs, cmap, upm = font; sc = size/upm; x = x0; d = []
    for ch in txt:
        g = cmap[ord(ch)]; pen = SVGPathPen(gs)
        gs[g].draw(TransformPen(pen, (sc, 0, 0, -sc, x, y0)))
        d.append(pen.getCommands()); x += gs[g].width*sc + track
    return ' '.join(d), x - track - x0
INK, INK2, RED, PAPER = '#17140F', '#221E18', '#C8402E', '#F1ECE1'
