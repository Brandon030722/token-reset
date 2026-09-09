#!/usr/bin/env python3
"""Rebuild original Tibo desktop icons with macOS AppKit, no Python packages.

Run on macOS: python3 desktop/assets/generate_icons.py
The SVG is editable geometry; no game artwork, fonts or remote assets are used.
All tools run at build time. The application only loads its packaged icon.
"""
from pathlib import Path
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <title>Tibo 观察站</title>
  <desc>原创蓝黄圆角徽章，几何字母 T 与感叹号。</desc>
  <rect x="49" y="60" width="408" height="408" rx="92" fill="#243047"/>
  <rect x="48" y="44" width="404" height="404" rx="90" fill="#3d91f5" stroke="#243047" stroke-width="12"/>
  <g transform="rotate(-7 253 251)">
    <rect x="107" y="119" width="310" height="292" rx="66" fill="#243047"/>
    <rect x="98" y="105" width="310" height="292" rx="66" fill="#ffce3b" stroke="#243047" stroke-width="10"/>
    <path d="M149 176H286V225H244V356H191V225H149Z" fill="#243047"/>
    <path d="M313 176H364L356 294H321Z" fill="#243047"/>
    <circle cx="338" cy="337" r="25" fill="#243047"/>
  </g>
</svg>
"""

SWIFT = r"""
import AppKit
import Foundation

let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let ink = CGColor(red: 36/255, green: 48/255, blue: 71/255, alpha: 1)
let blue = CGColor(red: 61/255, green: 145/255, blue: 245/255, alpha: 1)
let yellow = CGColor(red: 255/255, green: 206/255, blue: 59/255, alpha: 1)

func render(_ size: Int, _ filename: String) throws {
    guard let context = CGContext(
        data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { fatalError("Cannot create bitmap") }
    context.setAllowsAntialiasing(true)
    context.setShouldAntialias(true)
    context.translateBy(x: 0, y: CGFloat(size))
    context.scaleBy(x: CGFloat(size)/512, y: -CGFloat(size)/512)

    func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat,
              _ radius: CGFloat, _ fill: CGColor, _ line: CGFloat = 0) {
        let path = CGPath(roundedRect: CGRect(x: x, y: y, width: w, height: h),
                          cornerWidth: radius, cornerHeight: radius, transform: nil)
        context.addPath(path)
        context.setFillColor(fill)
        context.setStrokeColor(ink)
        context.setLineWidth(line)
        context.drawPath(using: line > 0 ? .fillStroke : .fill)
    }
    func polygon(_ points: [(CGFloat, CGFloat)]) {
        context.beginPath()
        context.move(to: CGPoint(x: points[0].0, y: points[0].1))
        for p in points.dropFirst() { context.addLine(to: CGPoint(x: p.0, y: p.1)) }
        context.closePath()
        context.setFillColor(ink)
        context.fillPath()
    }
    rect(49, 60, 408, 408, 92, ink)
    rect(48, 44, 404, 404, 90, blue, 12)
    context.saveGState()
    context.translateBy(x: 253, y: 251)
    context.rotate(by: -7 * .pi / 180)
    context.translateBy(x: -253, y: -251)
    rect(107, 119, 310, 292, 66, ink)
    rect(98, 105, 310, 292, 66, yellow, 10)
    polygon([(149,176),(286,176),(286,225),(244,225),(244,356),
             (191,356),(191,225),(149,225)])
    polygon([(313,176),(364,176),(356,294),(321,294)])
    context.setFillColor(ink)
    context.fillEllipse(in: CGRect(x: 313, y: 312, width: 50, height: 50))
    context.restoreGState()
    guard let image = context.makeImage(),
          let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    else { fatalError("Cannot encode PNG") }
    try png.write(to: output.appendingPathComponent(filename))
}

for size in [16, 32, 48, 64, 128, 256, 512, 1024] {
    try render(size, "\(size).png")
}
"""


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / "app-icon.svg").write_text(SVG, encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="tibo-icons-") as tmp:
        workspace = Path(tmp)
        source = workspace / "render.swift"
        source.write_text(SWIFT, encoding="utf-8")
        subprocess.run(["swift", str(source), str(workspace)], check=True)
        iconset = workspace / "AppIcon.iconset"
        iconset.mkdir()
        for base in [16, 32, 128, 256, 512]:
            for scale in [1, 2]:
                name = f"icon_{base}x{base}" + ("@2x" if scale == 2 else "") + ".png"
                (iconset / name).write_bytes((workspace / f"{base * scale}.png").read_bytes())
        subprocess.run(["iconutil", "-c", "icns", str(iconset),
                        "-o", str(ROOT / "AppIcon.icns")], check=True)
        # Vista and later support PNG-compressed images directly in ICO files.
        sizes = [16, 32, 48, 64, 128, 256]
        offset = 6 + 16 * len(sizes)
        entries, images = [], []
        for size in sizes:
            data = (workspace / f"{size}.png").read_bytes()
            entries.append(struct.pack("<BBBBHHII", size % 256, size % 256,
                                       0, 0, 1, 32, len(data), offset))
            images.append(data)
            offset += len(data)
        (ROOT / "AppIcon.ico").write_bytes(
            struct.pack("<HHH", 0, 1, len(sizes)) + b"".join(entries) + b"".join(images)
        )
        (ROOT / "icon-preview.png").write_bytes((workspace / "512.png").read_bytes())
    for name in ["app-icon.svg", "AppIcon.icns", "AppIcon.ico", "icon-preview.png"]:
        path = ROOT / name
        print(f"{name}: {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
