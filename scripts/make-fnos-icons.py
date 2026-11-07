#!/usr/bin/env python3
"""从 web/public/icons/icon-512.png 生成 fnOS 需要的四个图标。

fnOS 约定图标是圆角矩形、四角透明、图块铺满画布，而应用内母图是满幅不透明的
PWA 图标，所以这里只套一层圆角遮罩，不改设计本身。换了应用图标后手动跑一次：

    python scripts/make-fnos-icons.py

打包脚本不会自动调用它（打包机上不一定装了 Pillow）。
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web/public/icons/icon-512.png"
OUT = {
    ROOT / "packaging/ICON.PNG": 64,
    ROOT / "packaging/ICON_256.PNG": 256,
    ROOT / "packaging/app/ui/images/icon_64.png": 64,
    ROOT / "packaging/app/ui/images/icon_256.png": 256,
}


def main() -> int:
    src = Image.open(SRC).convert("RGBA")
    side = min(src.size)
    if src.width != src.height:
        squared = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        squared.paste(src, ((side - src.width) // 2, (side - src.height) // 2), src)
        src = squared

    mask = Image.new("L", src.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, side - 1, side - 1), radius=round(side * 0.225), fill=255)
    master = Image.new("RGBA", src.size, (0, 0, 0, 0))
    master.paste(src, (0, 0), mask)

    for path, size in OUT.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        master.resize((size, size), Image.LANCZOS).save(path)
        print(f"  {path.relative_to(ROOT)}  {size}x{size}")

    a = master.getchannel("A")
    corners = [a.getpixel((0, 0)), a.getpixel((side - 1, 0)),
               a.getpixel((0, side - 1)), a.getpixel((side - 1, side - 1))]
    if any(c > 40 for c in corners) or a.getpixel((side // 2, side // 2)) < 200:
        print(f"校验失败：四角 {corners}，中心 {a.getpixel((side // 2, side // 2))}")
        return 1
    print("四角透明 / 中心不透明：通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
