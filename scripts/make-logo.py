"""生成「数据查看大师」插件 logo：圆角方块 + 表格/数据条，200x200 PNG"""
from PIL import Image, ImageDraw
import os

W = H = 200
SS = 4  # supersample for smooth edges
w = h = W * SS

img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# rounded square background — indigo
pad = 8 * SS
radius = 42 * SS
bg = (79, 70, 229, 255)  # #4f46e5
draw.rounded_rectangle([pad, pad, w - pad, h - pad], radius=radius, fill=bg)

# subtle lighter panel
panel = [36 * SS, 40 * SS, w - 36 * SS, h - 36 * SS]
draw.rounded_rectangle(panel, radius=14 * SS, fill=(255, 255, 255, 28))

# table card
tx0, ty0, tx1, ty1 = 42 * SS, 48 * SS, w - 42 * SS, h - 44 * SS
draw.rounded_rectangle([tx0, ty0, tx1, ty1], radius=10 * SS, fill=(255, 255, 255, 255))

# header bar
hh = 22 * SS
draw.rounded_rectangle([tx0, ty0, tx1, ty0 + hh + 8 * SS], radius=10 * SS, fill=(224, 231, 255, 255))
draw.rectangle([tx0, ty0 + hh, tx1, ty0 + hh + 6 * SS], fill=(224, 231, 255, 255))

# header dots (columns)
cy = ty0 + hh // 2
for i, cx in enumerate([58 * SS, 90 * SS, 122 * SS, 148 * SS]):
    r = 4 * SS if i < 3 else 3 * SS
    draw.ellipse([cx * SS - r, cy - r, cx * SS + r, cy + r], fill=(79, 70, 229, 220))

# rows
row_top = ty0 + hh + 12 * SS
row_h = 16 * SS
for ri in range(4):
    y = row_top + ri * (row_h + 6 * SS)
    if y + row_h > ty1 - 8 * SS:
        break
    # row lines of different lengths
    lengths = [0.72, 0.88, 0.55, 0.80]
    lw = int((tx1 - tx0 - 28 * SS) * lengths[ri])
    draw.rounded_rectangle(
        [tx0 + 14 * SS, y + 3 * SS, tx0 + 14 * SS + lw, y + row_h - 3 * SS],
        radius=3 * SS,
        fill=(229, 231, 235, 255),
    )
    # accent cell on first rows
    if ri < 3:
        aw = 22 * SS
        ax = tx0 + 14 * SS + lw + 4 * SS
        if ax + aw < tx1 - 10 * SS:
            draw.rounded_rectangle(
                [ax, y + 3 * SS, ax + aw, y + row_h - 3 * SS],
                radius=3 * SS,
                fill=(129, 140, 248, 255),
            )

# magnifier bottom-right
mx, my, mr = w - 52 * SS, h - 52 * SS, 18 * SS
draw.ellipse([mx - mr, my - mr, mx + mr, my + mr], outline=(255, 255, 255, 255), width=5 * SS)
draw.ellipse([mx - mr + 4 * SS, my - mr + 4 * SS, mx + mr - 4 * SS, my + mr - 4 * SS], fill=(79, 70, 229, 255))
# handle
draw.line([mx + mr * 0.65, my + mr * 0.65, mx + mr + 12 * SS, my + mr + 12 * SS], fill=(255, 255, 255, 255), width=6 * SS)

out = img.resize((W, H), Image.Resampling.LANCZOS)
dest = os.path.join(os.path.dirname(__file__), "..", "public", "logo.png")
dest = os.path.abspath(dest)
out.save(dest, "PNG")
print("saved", dest, out.size)
