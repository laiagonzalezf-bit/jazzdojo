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
def enso(cx, cy, R, wmax, seed=7):
    rnd = random.Random(seed)
    a0, a1 = math.radians(-48), math.radians(-48 + 336)   # sweep, gap top-right
    n = 220; outer = []; inner = []
    jitter = [rnd.uniform(-1, 1) for _ in range(n+1)]
    for i in range(n+1):
        t = i/n; a = a0 + (a1-a0)*t
        # brush pressure: quick attack, full body, long dry taper
        w = wmax * (min(1, t/0.06) ** 0.5) * (1 - max(0, (t-0.62)/0.38)**1.6 * 0.75)
        r = R * (1 + 0.025*math.sin(3*a + 0.6))
        j = jitter[i]*wmax*0.025
        outer.append((cx + (r + w/2 + j)*math.cos(a), cy + (r + w/2 + j)*math.sin(a)))
        inner.append((cx + (r - w/2 + j*0.6)*math.cos(a), cy + (r - w/2 + j*0.6)*math.sin(a)))
    pts = outer + inner[::-1]
    return 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in pts) + ' Z'
def note(cx, cy, s, fill):
    hx, hy = cx - s*0.12, cy + s*0.30
    o = [f'<ellipse cx="{hx:.1f}" cy="{hy:.1f}" rx="{s*0.20:.1f}" ry="{s*0.145:.1f}" transform="rotate(-22 {hx:.1f} {hy:.1f})" fill="{fill}"/>']
    sx = hx + s*0.175; top = cy - s*0.48
    o.append(f'<rect x="{sx - s*0.034:.1f}" y="{top:.1f}" width="{s*0.068:.1f}" height="{hy - top:.1f}" fill="{fill}"/>')
    o.append(f'<path d="M{sx:.1f},{top:.1f} C{sx+s*0.06:.1f},{top+s*0.17:.1f} {sx+s*0.32:.1f},{top+s*0.18:.1f} {sx+s*0.25:.1f},{top+s*0.50:.1f} C{sx+s*0.22:.1f},{top+s*0.31:.1f} {sx+s*0.10:.1f},{top+s*0.26:.1f} {sx:.1f},{top+s*0.25:.1f} Z" fill="{fill}"/>')
    return '\n'.join(o)
S = 1024
icon = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}">
<rect width="{S}" height="{S}" fill="{INK}"/>
<path d="{enso(S/2, S/2, 330, 120)}" fill="{RED}"/>
{note(S/2, S/2, 420, PAPER)}
</svg>'''
open(os.path.join(OUT, 'icon.svg'), 'w').write(icon)
wm, w = text_path(FB, 'JAZZDOJO', 150, 0, 0, track=4)
W = 330 + w + 60; H = 300
logo = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H}">
<path d="{enso(150, 150, 110, 40)}" fill="{RED}"/>
{note(150, 150, 120, 'currentColor')}
<g transform="translate(320 0)"><path d="{text_path(FB,'JAZZDOJO',150,0,205,4)[0]}" fill="currentColor"/>
</g>
</svg>'''
open(os.path.join(OUT, 'logo.svg'), 'w').write(logo)
d2, w2 = text_path(FB, 'JAZZDOJO', 100, 0, 76, track=3)
open(os.path.join(OUT, 'wordmark.svg'), 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w2+4:.0f} 80"><path d="{d2}" fill="currentColor"/></svg>')
open(os.path.join(OUT, 'enso.svg'), 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path d="{enso(150,150,110,40)}" fill="{RED}"/>{note(150,150,120,PAPER)}</svg>')
print('ok')
