"""Рисует аватарку бота (640x640) и баннер приветствия (1280x640)."""
import math, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
FB = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FR = "/System/Library/Fonts/Supplemental/Arial.ttf"
NAVY, BLUE = (18, 40, 92), (36, 92, 180)
GOLD, GOLD_D, GOLD_L = (245, 182, 46), (196, 128, 20), (255, 222, 120)
RED = (200, 46, 52)


def grad(w, h, c1, c2):
    im = Image.new("RGB", (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w):
            t = (x / w * 0.4 + y / h * 0.6)
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return im


def coin(d, cx, cy, r, font_size):
    d.ellipse([cx - r, cy - r + r * 0.08, cx + r, cy + r + r * 0.08], fill=GOLD_D)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GOLD)
    ri = r * 0.82
    d.ellipse([cx - ri, cy - ri, cx + ri, cy + ri], outline=GOLD_D, width=max(3, int(r * 0.05)))
    d.arc([cx - ri * 0.9, cy - ri * 0.9, cx + ri * 0.9, cy + ri * 0.9], 200, 260, fill=GOLD_L, width=max(4, int(r * 0.07)))
    # знак рубля рисуем фигурами (в Arial его нет)
    u = r / 100.0
    lw = 13 * u
    x0 = cx - 22 * u
    d.rectangle([x0 - lw / 2, cy - 48 * u, x0 + lw / 2, cy + 50 * u], fill=NAVY)
    d.rectangle([x0, cy - 48 * u, x0 + 20 * u, cy - 48 * u + lw], fill=NAVY)
    d.rectangle([x0, cy + 2 * u - lw, x0 + 20 * u, cy + 2 * u], fill=NAVY)
    d.arc([x0 - 5 * u, cy - 48 * u, x0 + 50 * u, cy + 2 * u], 270, 90, fill=NAVY, width=int(lw))
    d.rectangle([x0 - 22 * u, cy + 16 * u, x0 + 32 * u, cy + 16 * u + lw * 0.85], fill=NAVY)


def ticket(base, cx, cy, w, h, angle, text, size):
    t = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    td = ImageDraw.Draw(t)
    td.rounded_rectangle([0, 0, w - 1, h - 1], radius=int(h * 0.12), fill=RED)
    for yy in (0, h - 1):
        pass
    r = int(h * 0.16)
    td.ellipse([-r, h / 2 - r, r, h / 2 + r], fill=(0, 0, 0, 0))
    td.ellipse([w - r, h / 2 - r, w + r, h / 2 + r], fill=(0, 0, 0, 0))
    for i in range(8):
        y = h * 0.12 + i * h * 0.1
        td.rectangle([w * 0.72, y, w * 0.735, y + h * 0.05], fill=(255, 255, 255, 170))
    f = ImageFont.truetype(FB, size)
    td.text((w * 0.37, h / 2), text, font=f, fill="white", anchor="mm")
    t = t.rotate(angle, expand=True, resample=Image.BICUBIC)
    sh = Image.new("RGBA", t.size, (0, 0, 0, 0))
    sh.paste((0, 0, 0, 90), mask=t.split()[3])
    sh = sh.filter(ImageFilter.GaussianBlur(8))
    base.alpha_composite(sh, (int(cx - t.width / 2 + 6), int(cy - t.height / 2 + 10)))
    base.alpha_composite(t, (int(cx - t.width / 2), int(cy - t.height / 2)))


def sparkles(d, pts):
    for x, y, s in pts:
        d.polygon([(x, y - s), (x + s * 0.25, y - s * 0.25), (x + s, y), (x + s * 0.25, y + s * 0.25),
                   (x, y + s), (x - s * 0.25, y + s * 0.25), (x - s, y), (x - s * 0.25, y - s * 0.25)], fill=GOLD_L)


# ---------- аватарка ----------
S = 640
av = grad(S, S, BLUE, NAVY).convert("RGBA")
ticket(av, 360, 175, 380, 170, 14, "КУРСК", 60)
d = ImageDraw.Draw(av)
coin(d, 280, 415, 170, 230)
sparkles(d, [(520, 470, 26), (110, 160, 20), (545, 110, 16)])
av.convert("RGB").save(os.path.join(OUT, "avatar.png"))
av.convert("RGB").resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, "icon-192.png"))

# ---------- баннер ----------
W, H = 1280, 640
bn = grad(W, H, BLUE, NAVY).convert("RGBA")
ticket(bn, 1010, 230, 380, 180, 12, "КУРСК", 60)
d = ImageDraw.Draw(bn)
coin(d, 980, 420, 165, 220)
sparkles(d, [(1200, 520, 26), (800, 120, 18), (1230, 90, 14)])
fT = ImageFont.truetype(FB, 72)
fS = ImageFont.truetype(FR, 36)
d.text((80, 190), "Умный карман", font=fT, fill="white")
d.text((80, 275), "курского школьника", font=fT, fill=GOLD)
d.text((80, 390), "Копим на театр, музей и концерт", font=fS, fill=(220, 230, 250))
d.text((80, 440), "без лишних трат", font=fS, fill=(220, 230, 250))
bn.convert("RGB").save(os.path.join(OUT, "banner.png"))
print("ok")
