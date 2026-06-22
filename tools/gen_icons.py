#!/usr/bin/env python3
"""Генерация PNG-иконок PWA без сторонних библиотек (только stdlib).

Рисуем индиго-фон и две скруглённые «карточки» — узнаваемый значок колоды.
Запуск:  python3 tools/gen_icons.py
"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")

BG = (79, 70, 229)        # indigo-600
CARD_BACK = (165, 180, 252)  # indigo-300
WHITE = (255, 255, 255)
LINE = (99, 102, 241)     # indigo-500


def rrect(x, y, x0, y0, x1, y1, r):
    """Внутри ли точка (x,y) скруглённого прямоугольника."""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def over(dst, src, a):
    """Альфа-композитинг src поверх dst с покрытием a (0..1)."""
    return tuple(round(s * a + d * (1 - a)) for s, d in zip(src, dst))


def render(size, ss=3):
    """Рендер иконки size×size с суперсэмплингом ss для гладких краёв."""
    S = size * ss
    px = bytearray(size * size * 4)

    # Геометрия в долях от стороны.
    def rect(fx0, fy0, fx1, fy1, fr):
        return (fx0 * S, fy0 * S, fx1 * S, fy1 * S, fr * S)

    back = rect(0.34, 0.16, 0.80, 0.72, 0.07)
    front = rect(0.22, 0.26, 0.68, 0.82, 0.07)
    # Две «строки текста» на передней карточке.
    l1 = rect(0.29, 0.40, 0.61, 0.44, 0.02)
    l2 = rect(0.29, 0.52, 0.53, 0.56, 0.02)

    for oy in range(size):
        for ox in range(size):
            cov_back = cov_front = cov_l1 = cov_l2 = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = ox * ss + sx + 0.5
                    y = oy * ss + sy + 0.5
                    if rrect(x, y, *back):
                        cov_back += 1
                    if rrect(x, y, *front):
                        cov_front += 1
                        if rrect(x, y, *l1):
                            cov_l1 += 1
                        if rrect(x, y, *l2):
                            cov_l2 += 1
            n = ss * ss
            color = BG  # фон полностью залит (maskable-friendly)
            if cov_back:
                color = over(color, CARD_BACK, cov_back / n)
            if cov_front:
                color = over(color, WHITE, cov_front / n)
            if cov_l1:
                color = over(color, LINE, cov_l1 / n)
            if cov_l2:
                color = over(color, LINE, cov_l2 / n)

            i = (oy * size + ox) * 4
            px[i:i + 4] = bytes((*color, 255))
    return px


def write_png(path, size, px):
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)

    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # фильтр None
        raw.extend(px[y * stride:(y + 1) * stride])

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    data = (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(data)
    print("written", os.path.relpath(path), f"({len(data)} B)")


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, size in [("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)]:
        write_png(os.path.join(OUT, name), size, render(size))


if __name__ == "__main__":
    main()
