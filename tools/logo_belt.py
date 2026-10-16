# JazzDojo, alternative mark: a martial-arts belt knot whose two tails end in note heads, so the whole reads as ♫.
import sys, os, math
sys.argv = [sys.argv[0]] + sys.argv[1:]
exec(open(os.path.join(os.path.dirname(__file__), 'logo_common.py')).read())
def belt(cx, cy, s, band, head, knot):
    o = []
    bw = s*0.16            # belt width
    top = cy - s*0.42
    # belt across (the beam), slightly tilted like a beam
    L, R = cx - s*0.62, cx + s*0.62
    tilt = s*0.07
    o.append(f'<path d="M{L:.1f},{top+tilt:.1f} L{R:.1f},{top-tilt:.1f} L{R:.1f},{top-tilt+bw:.1f} L{L:.1f},{top+tilt+bw:.1f} Z" fill="{band}"/>')
    # tails (the stems), from the knot down to the heads
    def tail(x0, x1, y1):
        dx, dy = x1-x0, y1-(top+bw*0.5); ln = math.hypot(dx, dy); nx, ny = -dy/ln*bw*0.42, dx/ln*bw*0.42
        y0 = top + bw*0.5
        return f'<path d="M{x0+nx:.1f},{y0+ny:.1f} L{x1+nx:.1f},{y1+ny:.1f} L{x1-nx:.1f},{y1-ny:.1f} L{x0-nx:.1f},{y0-ny:.1f} Z" fill="{band}"/>'
    hl = (cx - s*0.40, cy + s*0.40); hr = (cx + s*0.48, cy + s*0.30)
    o.append(tail(cx - s*0.03, hl[0] + s*0.15, hl[1] - s*0.02))
    o.append(tail(cx + s*0.03, hr[0] + s*0.15, hr[1] - s*0.02))
    # knot
    k = s*0.25
    o.append(f'<rect x="{cx-k/2:.1f}" y="{top - s*0.045:.1f}" width="{k:.1f}" height="{bw + s*0.09:.1f}" rx="{s*0.03:.1f}" fill="{band}" transform="rotate(-8 {cx:.1f} {top+bw/2:.1f})"/>')
    o.append(f'<path d="M{cx-k*0.38:.1f},{top+bw*0.95:.1f} L{cx+k*0.38:.1f},{top+bw*0.05:.1f}" stroke="{knot}" stroke-width="{s*0.025:.1f}" stroke-linecap="round"/>')
    # note heads
    for hx, hy in (hl, hr):
        o.append(f'<ellipse cx="{hx:.1f}" cy="{hy:.1f}" rx="{s*0.18:.1f}" ry="{s*0.13:.1f}" transform="rotate(-22 {hx:.1f} {hy:.1f})" fill="{head}"/>')
    return '\n'.join(o)
S = 1024
open(os.path.join(OUT, 'icon-belt.svg'), 'w').write(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}">
<rect width="{S}" height="{S}" fill="{INK}"/>
{belt(S/2 - 10, S/2 + 40, 600, PAPER, RED, INK)}
</svg>''')
d, w = text_path(FB, 'JAZZDOJO', 150, 0, 0, track=4)
W = 330 + w + 40
open(os.path.join(OUT, 'logo-belt.svg'), 'w').write(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} 300">
{belt(150, 160, 210, 'currentColor', RED, 'var(--knot, #17140F)')}
<g transform="translate(320 0)"><path d="{text_path(FB,'JAZZDOJO',150,0,205,4)[0]}" fill="currentColor"/></g>
</svg>''')
print('ok')
