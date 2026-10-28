import AppKit

// Package approved transparent artwork inside a fixed system-sized Dock tile.
// The template contains only a white tile and neutral shadow, no Calendar artwork.
guard CommandLine.arguments.count == 4 else {
  fatalError("usage: package-icon.swift template.png artwork.png output.png")
}
let tile = NSBitmapImageRep(
  data: try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))!
guard tile.pixelsWide == 1024 && tile.pixelsHigh == 1024 else {
  fatalError("Dock template must be 1024 × 1024")
}
let artwork = NSImage(contentsOfFile: CommandLine.arguments[2])!
NSGraphicsContext.saveGraphicsState()
let output = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8, samplesPerPixel: 4,
  hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
let context = NSGraphicsContext(bitmapImageRep: output)!
NSGraphicsContext.current = context
context.imageInterpolation = .high
NSImage(contentsOfFile: CommandLine.arguments[1])!.draw(
  in: NSRect(x: 0, y: 0, width: 1024, height: 1024))
// Native Calendar tile bounds: [100, 100, 924, 924) on a 1024-pixel canvas.
artwork.draw(
  in: NSRect(x: 100, y: 100, width: 824, height: 824), from: .zero, operation: .sourceOver,
  fraction: 1)
NSGraphicsContext.restoreGraphicsState()
// A restrained top-to-bottom material treatment, applied only inside the tile.
// Keep every alpha value and the neutral outer shadow identical to the template.
let inkTop: [CGFloat] = [0.36, 0.39, 0.45]
let inkBottom: [CGFloat] = [0.055, 0.065, 0.085]
for y in 0..<1024 {
  let progress = min(1, max(0, CGFloat(y - 100) / 823))
  let paper = 1 - progress * 0.075
  let ink = zip(inkTop, inkBottom).map { $0 + ($1 - $0) * progress }
  for x in 0..<1024 {
    let templateColor = tile.colorAt(x: x, y: y)!.usingColorSpace(.deviceRGB)!
    guard templateColor.redComponent > 0.5 else { continue }
    let pixel = output.colorAt(x: x, y: y)!.usingColorSpace(.deviceRGB)!
    let coverage = min(
      1, max(0, (pixel.redComponent + pixel.greenComponent + pixel.blueComponent) / 3))
    output.setColor(
      NSColor(
        deviceRed: ink[0] * (1 - coverage) + paper * coverage,
        green: ink[1] * (1 - coverage) + paper * coverage,
        blue: ink[2] * (1 - coverage) + paper * coverage,
        alpha: pixel.alphaComponent), atX: x, y: y)
  }
}
try output.representation(using: .png, properties: [:])!.write(
  to: URL(fileURLWithPath: CommandLine.arguments[3]))
