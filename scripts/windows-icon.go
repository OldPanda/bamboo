//go:build ignore

// Convert the existing transparent product artwork into a Windows icon resource.
package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"log"
	"os"
)

func main() {
	if len(os.Args) != 3 {
		log.Fatal("usage: windows-icon input.png output.ico")
	}
	f, err := os.Open(os.Args[1])
	if err != nil {
		log.Fatal(err)
	}
	src, err := png.Decode(f)
	f.Close()
	if err != nil {
		log.Fatal(err)
	}
	icon := image.NewNRGBA(image.Rect(0, 0, 256, 256))
	bounds := src.Bounds()
	// Box-average the original artwork, retaining transparency and its proportions.
	for y := 0; y < 256; y++ {
		for x := 0; x < 256; x++ {
			x0, x1 := x*bounds.Dx()/256, max(x*bounds.Dx()/256+1, (x+1)*bounds.Dx()/256)
			y0, y1 := y*bounds.Dy()/256, max(y*bounds.Dy()/256+1, (y+1)*bounds.Dy()/256)
			var r, g, b, a, n uint64
			for sy := y0; sy < y1; sy++ {
				for sx := x0; sx < x1; sx++ {
					cr, cg, cb, ca := src.At(bounds.Min.X+sx, bounds.Min.Y+sy).RGBA()
					r += uint64(cr)
					g += uint64(cg)
					b += uint64(cb)
					a += uint64(ca)
					n++
				}
			}
			if a > 0 {
				icon.SetNRGBA(x, y, color.NRGBA{uint8(r * 255 / a), uint8(g * 255 / a), uint8(b * 255 / a), uint8(a / n / 257)})
			}
		}
	}
	var data bytes.Buffer
	if err := png.Encode(&data, icon); err != nil {
		log.Fatal(err)
	}
	header := []uint16{0, 1, 1}
	var out bytes.Buffer
	if err := binary.Write(&out, binary.LittleEndian, header); err != nil {
		log.Fatal(err)
	}
	out.Write([]byte{0, 0, 0, 0})
	if err := binary.Write(&out, binary.LittleEndian, []uint16{1, 32}); err != nil {
		log.Fatal(err)
	}
	if err := binary.Write(&out, binary.LittleEndian, []uint32{uint32(data.Len()), 22}); err != nil {
		log.Fatal(err)
	}
	out.Write(data.Bytes())
	if err := os.WriteFile(os.Args[2], out.Bytes(), 0600); err != nil {
		log.Fatal(err)
	}
}
