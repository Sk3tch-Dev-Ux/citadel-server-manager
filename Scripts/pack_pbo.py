#!/usr/bin/env python3
"""
Minimal, dependency-free DayZ/Arma PBO packer for SCRIPT-ONLY addons.

Packs a source addon folder (containing a $PBOPREFIX$ + config.cpp + Enforce
.c scripts) into an uncompressed "Vers"-format .pbo with a SHA1 trailer.
Script mods need no binarization, so this runs anywhere (no DayZ Tools).

Produces an UNSIGNED pbo — fine for a server-side mod loaded via -servermod
where client signature verification doesn't apply. For client-distributed
mods, sign with DSSignFile (Windows) afterwards.

Usage: pack_pbo.py <addon_src_dir> <output.pbo>
"""
import os, struct, sys, hashlib

def collect_files(root):
    out = []
    for dirpath, _dirs, files in os.walk(root):
        for f in sorted(files):
            if f == "$PBOPREFIX$":
                continue  # consumed as the prefix property, not a packed file
            full = os.path.join(dirpath, f)
            rel = os.path.relpath(full, root).replace("/", "\\")
            out.append((rel, full))
    return sorted(out, key=lambda x: x[0].lower())

def entry(name_bytes, mime, orig, reserved, ts, datasize):
    # mime/packing method as uint32: 0 = uncompressed file entry.
    return name_bytes + b"\x00" + struct.pack("<IIIII", mime, orig, reserved, ts, datasize)

def main():
    src, out = sys.argv[1], sys.argv[2]
    prefix_path = os.path.join(src, "$PBOPREFIX$")
    prefix = open(prefix_path, "rb").read().split(b"\n")[0].strip().decode("latin-1") if os.path.exists(prefix_path) else ""

    files = collect_files(src)
    body = bytearray()

    # Header extension entry: empty name, mime 'Vers', then prefix property.
    body += b"\x00"
    body += struct.pack("<4sIIII", b"Vers", 0, 0, 0, 0)
    if prefix:
        body += b"prefix\x00" + prefix.encode("latin-1") + b"\x00"
    body += b"\x00"  # end of properties

    # File header entries (uncompressed: mime 0, original size 0).
    datas = []
    for rel, full in files:
        data = open(full, "rb").read()
        datas.append(data)
        body += entry(rel.encode("latin-1"), 0, 0, 0, 0, len(data))

    # Terminating (empty) entry.
    body += entry(b"", 0, 0, 0, 0, 0)

    # File data blocks, same order.
    for data in datas:
        body += data

    # Trailer: 0x00 + SHA1 of everything so far.
    digest = hashlib.sha1(bytes(body)).digest()
    body += b"\x00" + digest

    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "wb").write(bytes(body))
    print(f"packed {len(files)} files -> {out} ({len(body)} bytes), prefix='{prefix}'")

if __name__ == "__main__":
    main()
