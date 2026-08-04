package xrpl

import "encoding/binary"

// RIPEMD-160, implemented here rather than pulled from golang.org/x/crypto/ripemd160.
//
// XRPL account IDs are RIPEMD160(SHA256(pubkey)), so the enclave needs this hash to
// derive an address. The x/crypto package that provides it has been deprecated since
// 2019 and is a candidate for removal; vendoring ~150 lines of a frozen, fully
// specified algorithm is cheaper than carrying that risk into a TEE image that has to
// build reproducibly. Correctness is pinned by the published test vectors in
// ripemd160_test.go.
//
// Reference: Dobbertin, Bosselaers, Preneel — "RIPEMD-160: A Strengthened Version of
// RIPEMD" (1996).

// Message word order for the left and right lines.
var ripemdRL = [80]uint8{
	0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
	7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
	3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
	1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
	4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
}

var ripemdRR = [80]uint8{
	5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
	6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
	15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
	8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
	12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
}

// Rotate-left amounts for the left and right lines.
var ripemdSL = [80]uint8{
	11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
	7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
	11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
	11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
	9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
}

var ripemdSR = [80]uint8{
	8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
	9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
	9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
	15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
	8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
}

// Per-round additive constants for the left and right lines.
var ripemdKL = [5]uint32{0x00000000, 0x5A827999, 0x6ED9EBA1, 0x8F1BBCDC, 0xA953FD4E}
var ripemdKR = [5]uint32{0x50A28BE6, 0x5C4DD124, 0x6D703EF3, 0x7A6D76E9, 0x00000000}

// ripemdF is the round function; which boolean expression applies depends on the
// round index j.
func ripemdF(j int, x, y, z uint32) uint32 {
	switch {
	case j < 16:
		return x ^ y ^ z
	case j < 32:
		return (x & y) | (^x & z)
	case j < 48:
		return (x | ^y) ^ z
	case j < 64:
		return (x & z) | (y & ^z)
	default:
		return x ^ (y | ^z)
	}
}

func rotl32(x uint32, n uint8) uint32 {
	return (x << n) | (x >> (32 - n))
}

// ripemd160 returns the 20-byte RIPEMD-160 digest of data.
func ripemd160(data []byte) []byte {
	h := [5]uint32{0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0}

	// Pad: 0x80, then zeros, until length ≡ 56 (mod 64), then the bit length as a
	// little-endian uint64.
	msgLen := uint64(len(data)) * 8
	padded := make([]byte, 0, len(data)+72)
	padded = append(padded, data...)
	padded = append(padded, 0x80)
	for len(padded)%64 != 56 {
		padded = append(padded, 0x00)
	}
	var lenBytes [8]byte
	binary.LittleEndian.PutUint64(lenBytes[:], msgLen)
	padded = append(padded, lenBytes[:]...)

	var x [16]uint32
	for block := 0; block < len(padded); block += 64 {
		for i := range x {
			x[i] = binary.LittleEndian.Uint32(padded[block+i*4 : block+i*4+4])
		}

		al, bl, cl, dl, el := h[0], h[1], h[2], h[3], h[4]
		ar, br, cr, dr, er := h[0], h[1], h[2], h[3], h[4]

		for j := 0; j < 80; j++ {
			round := j / 16

			t := rotl32(al+ripemdF(j, bl, cl, dl)+x[ripemdRL[j]]+ripemdKL[round], ripemdSL[j]) + el
			al, el, dl, cl, bl = el, dl, rotl32(cl, 10), bl, t

			t = rotl32(ar+ripemdF(79-j, br, cr, dr)+x[ripemdRR[j]]+ripemdKR[round], ripemdSR[j]) + er
			ar, er, dr, cr, br = er, dr, rotl32(cr, 10), br, t
		}

		t := h[1] + cl + dr
		h[1] = h[2] + dl + er
		h[2] = h[3] + el + ar
		h[3] = h[4] + al + br
		h[4] = h[0] + bl + cr
		h[0] = t
	}

	out := make([]byte, 20)
	for i, v := range h {
		binary.LittleEndian.PutUint32(out[i*4:], v)
	}
	return out
}
