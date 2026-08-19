"""Prepare the approved NexEstate logo reference as a transparent runtime asset.

The scanner overlay in the supplied reference hides part of the lower-right skyline.
Those pixels are made transparent deliberately; the obscured geometry is never guessed.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


def remove_white_matte(image: Image.Image) -> Image.Image:
    source = image.convert("RGB")
    result = Image.new("RGBA", source.size)
    pixels = []
    for red, green, blue in source.get_flattened_data():
        alpha = max(255 - red, 255 - green, 255 - blue)
        if alpha <= 7:
            pixels.append((255, 255, 255, 0))
            continue
        alpha = min(255, alpha)
        pixels.append((red, green, blue, alpha))
    result.putdata(pixels)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()

    prepared = remove_white_matte(Image.open(args.source))

    # The scanner badge occupies this supplied-reference region. Erasing it is the
    # only faithful treatment: the skyline below the badge is not present in source.
    scale_x = prepared.width / 640
    scale_y = prepared.height / 640
    mask = Image.new("L", prepared.size, 255)
    draw = ImageDraw.Draw(mask)
    draw.rectangle(
        (
            round(565 * scale_x),
            round(498 * scale_y),
            prepared.width,
            prepared.height,
        ),
        fill=0,
    )
    prepared.putalpha(Image.composite(prepared.getchannel("A"), Image.new("L", prepared.size), mask))

    bbox = prepared.getbbox()
    if not bbox:
        raise RuntimeError("The prepared reference contains no visible pixels")
    prepared = prepared.crop(bbox)
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    prepared.save(args.destination, "PNG", optimize=True)


if __name__ == "__main__":
    main()
