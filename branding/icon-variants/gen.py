import math, os, subprocess
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)

# ---------- geometry (glyph space 0..100) ----------
CX, CY = 48, 58
TURNS = 1.75
R0, R1 = 33, 3.5
W0, W1 = 21, 2.6
TH0 = -math.pi / 2  # start at top, sweep counter-clockwise on screen (theta decreasing)


def spiral(n=260):
    pts = []
    for i in range(n + 1):
        t = i / n
        th = TH0 - t * TURNS * 2 * math.pi
        e = t ** 0.85
        r = R0 + (R1 - R0) * e
        w = W0 + (W1 - W0) * (t ** 0.7)
        pts.append((th, r, w))
    return pts


def body_path():
    s = spiral()
    outer = [(CX + (r + w / 2) * math.cos(th), CY + (r + w / 2) * math.sin(th)) for th, r, w in s]
    inner = [(CX + (r - w / 2) * math.cos(th), CY + (r - w / 2) * math.sin(th)) for th, r, w in s]
    # round tail tip
    th, r, w = s[-1]
    tip = (CX + r * math.cos(th), CY + r * math.sin(th))
    d = "M %.2f %.2f " % outer[0]
    d += " ".join("L %.2f %.2f" % p for p in outer[1:])
    d += " A %.2f %.2f 0 0 1 %.2f %.2f " % (w / 2, w / 2, *inner[-1])
    d += " ".join("L %.2f %.2f" % p for p in reversed(inner))
    d += " Z"
    return d


# head attached at top-right of the body start (body start spans y = CY-R0-W0/2 .. CY-R0+W0/2)
TOP = CY - R0 - W0 / 2   # ~14.5
BOT = CY - R0 + W0 / 2   # ~35.5
HEAD = [(CX - 9, TOP + 0.8), (CX + 9, TOP - 9), (CX + 31, TOP + 13), (CX + 31, TOP + 17.5), (CX + 22, BOT - 1), (CX - 6, BOT + 0.4)]
EYE = (CX + 18, TOP + 9.5)


def head_path():
    return "M " + " L ".join("%.2f %.2f" % p for p in HEAD) + " Z"


def glyph(fill, eye_white="#fff", pupil="#111", eye_r=5.2, pupil_r=2.4, extra=""):
    return f'''<g>
  <path d="{body_path()}" fill="{fill}"/>
  <path d="{head_path()}" fill="{fill}" stroke="{fill}" stroke-width="1.2" stroke-linejoin="round"/>
  <circle cx="{EYE[0]}" cy="{EYE[1]}" r="{eye_r}" fill="{eye_white}"/>
  <circle cx="{EYE[0] + 1}" cy="{EYE[1]}" r="{pupil_r}" fill="{pupil}"/>
  {extra}
</g>'''


def lowpoly(palette):
    """Faceted body: split the spiral into quads, alternate shades (ref 2 style)."""
    s = spiral(56)
    parts = []
    for i in range(len(s) - 1):
        (a, ra, wa), (b, rb, wb) = s[i], s[i + 1]
        p1 = (CX + (ra + wa / 2) * math.cos(a), CY + (ra + wa / 2) * math.sin(a))
        p2 = (CX + (rb + wb / 2) * math.cos(b), CY + (rb + wb / 2) * math.sin(b))
        p3 = (CX + (rb - wb / 2) * math.cos(b), CY + (rb - wb / 2) * math.sin(b))
        p4 = (CX + (ra - wa / 2) * math.cos(a), CY + (ra - wa / 2) * math.sin(a))
        mid_a = (CX + ra * math.cos(a), CY + ra * math.sin(a))
        c1 = palette[(i * 2) % len(palette)]
        c2 = palette[(i * 2 + 3) % len(palette)]
        parts.append(f'<path d="M{p1[0]:.2f} {p1[1]:.2f} L{p2[0]:.2f} {p2[1]:.2f} L{p3[0]:.2f} {p3[1]:.2f} Z" fill="{c1}" stroke="{c1}" stroke-width=".4"/>')
        parts.append(f'<path d="M{p1[0]:.2f} {p1[1]:.2f} L{p3[0]:.2f} {p3[1]:.2f} L{p4[0]:.2f} {p4[1]:.2f} Z" fill="{c2}" stroke="{c2}" stroke-width=".4"/>')
    h = HEAD
    hp = [
        (palette[1], [h[0], h[1], (CX + 12, TOP + 10)]),
        (palette[0], [h[1], h[2], (CX + 12, TOP + 10)]),
        (palette[2], [h[0], (CX + 12, TOP + 10), h[5]]),
        (palette[3], [(CX + 12, TOP + 10), h[2], h[3], h[4]]),
        (palette[4], [(CX + 12, TOP + 10), h[4], h[5]]),
    ]
    for c, pts in hp:
        parts.append(f'<path d="M ' + " L ".join("%.2f %.2f" % p for p in pts) + f' Z" fill="{c}" stroke="{c}" stroke-width=".4"/>')
    parts.append(f'<circle cx="{EYE[0]}" cy="{EYE[1]}" r="5.6" fill="#fff"/><circle cx="{EYE[0] + 1}" cy="{EYE[1]}" r="2.6" fill="#111"/>')
    return "<g>" + "".join(parts) + "</g>"


SQ = "M100 285 C100 150 150 100 285 100 H739 C874 100 924 150 924 285 V739 C924 874 874 924 739 924 H285 C150 924 100 874 100 739 Z"  # superellipse-ish


def icon(name, bg_defs, bg_fill, inner, scale=6.6, dx=0, dy=0, squircle=True, overlay=""):
    tx = 512 - 50 * scale + dx
    ty = 512 - 52 * scale + dy
    shape = f'<path d="{SQ}" fill="{bg_fill}"/>' if squircle else f'<rect width="1024" height="1024" fill="{bg_fill}"/>'
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>{bg_defs}<clipPath id="sq"><path d="{SQ}"/></clipPath></defs>
{shape}
<g clip-path="url(#sq)">{overlay}<g transform="translate({tx:.1f} {ty:.1f}) scale({scale})">{inner}</g></g>
</svg>'''
    p = os.path.join(OUT, name + ".svg")
    open(p, "w").write(svg)
    subprocess.run(["rsvg-convert", "-w", "512", "-h", "512", p, "-o", p[:-4] + ".png"], check=True)
    return p[:-4] + ".png"


GREEN_TEAL = '<linearGradient id="gt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b6e94a"/><stop offset=".5" stop-color="#2fbf71"/><stop offset="1" stop-color="#0e8fa8"/></linearGradient>'
BODY_GRAD = '<linearGradient id="bg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c4ef3f"/><stop offset=".45" stop-color="#22c47a"/><stop offset="1" stop-color="#1a7fd6"/></linearGradient>'
DUSK = '<linearGradient id="dk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d2433"/><stop offset="1" stop-color="#0b0f17"/></linearGradient>'
POLY = ["#9be15d", "#3cba54", "#16a085", "#1fc8a5", "#2e86de", "#c7e94a", "#0f9b8e"]

made = []
# 1 white silhouette on green→teal
made.append(("silhouette", icon("01-silhouette", GREEN_TEAL, "url(#gt)", glyph("#ffffff", eye_white="#1b6f5a", pupil="#fff", pupil_r=2.2))))
# 2 gradient body on dark
made.append(("gradient-dark", icon("02-gradient-dark", DUSK + BODY_GRAD, "url(#dk)", glyph("url(#bg2)"))))
# 3 low-poly on white
made.append(("low-poly", icon("03-lowpoly", "", "#f6f8f4", lowpoly(POLY))))
# 4 eye = record button
made.append(("record-eye", icon("04-record-eye", GREEN_TEAL, "url(#gt)", glyph("#ffffff", eye_white="#ff3b30", pupil="#ff3b30", eye_r=6.2, pupil_r=0))))
# 5 viewfinder corners
corners = "".join(
    f'<path d="{d}" fill="none" stroke="#ffffff" stroke-opacity=".9" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>'
    for d in ["M215 330 V215 H330", "M694 215 H809 V330", "M809 694 V809 H694", "M330 809 H215 V694"])
made.append(("viewfinder", icon("05-viewfinder", DUSK + BODY_GRAD, "url(#dk)", glyph("url(#bg2)"), scale=5.0, overlay=corners)))
# 6 black silhouette (ref 1) on white with green eye
made.append(("mono", icon("06-mono", "", "#ffffff", glyph("#111111", eye_white="#fff", pupil="#111"))))
# 7 low-poly on dark
made.append(("low-poly-dark", icon("07-lowpoly-dark", DUSK, "url(#dk)", lowpoly(POLY))))
# 8 line art: stroke only
line = f'<g fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round"><path d="{body_path()}"/><path d="{head_path()}"/></g><circle cx="{EYE[0]}" cy="{EYE[1]}" r="4.2" fill="#ff3b30"/>'
made.append(("line + rec", icon("08-line", BODY_GRAD, "url(#bg2)", line)))

# contact sheet
tile = 512
cols = 4
rows = math.ceil(len(made) / cols)
pad, lab = 24, 40
sheet = Image.new("RGB", (cols * (tile + pad) + pad, rows * (tile + pad + lab) + pad), "#eceef2")
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 26)
except Exception:
    font = ImageFont.load_default()
for i, (label, png) in enumerate(made):
    x = pad + (i % cols) * (tile + pad)
    y = pad + (i // cols) * (tile + pad + lab)
    im = Image.open(png).convert("RGBA")
    sheet.paste(im, (x, y), im)
    d.text((x + 6, y + tile + 6), f"{i + 1}. {label}", fill="#222", font=font)
sheet.save(os.path.join(OUT, "sheet.png"))
print(os.path.join(OUT, "sheet.png"))
