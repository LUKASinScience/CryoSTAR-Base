"""Extract tilt angles, dose, and defocus from Warp XML files for PyTom.
CryoSTAR-Base — 2026
No Warp installation needed — reads XML files directly using Python stdlib.
"""

import xml.etree.ElementTree as ET
import os
import argparse
from pathlib import Path


def write_values(output_file: str, values: list, label: str = "Values"):
    """Write a list of values to a file, one per line."""
    with open(output_file, "w") as f:
        for value in values:
            f.write(str(value) + "\n")
    print(f"  {label} → {output_file}")


def extract_from_xml(xml_path: str, flip_angles: bool = True) -> dict:
    """
    Extract tilt angles, dose, and defocus from one Warp XML file.

    Args:
        xml_path:    Path to the .xml file
        flip_angles: If True, negate tilt angles (default for most WarpTools data)

    Returns:
        dict with paths to generated files and extracted values
    """
    xml_path = str(xml_path)
    if not xml_path.endswith(".xml"):
        return {"status": "skipped", "msg": f"Not an XML file: {xml_path}"}

    ts   = ET.parse(xml_path)
    root = ts.getroot()
    base = xml_path.replace(".xml", "")

    # ── Angles ──
    angle_element = root.find("Angles")
    if angle_element is None or not angle_element.text:
        return {"status": "error", "msg": f"No Angles element in {xml_path}"}
    angle_values = [float(v) for v in angle_element.text.strip().split()]
    if flip_angles:
        angle_values = [-v for v in angle_values]
    write_values(base + ".tlt", angle_values, "Angles")

    # ── Dose ──
    dose_element = root.find("Dose")
    if dose_element is None or not dose_element.text:
        return {"status": "error", "msg": f"No Dose element in {xml_path}"}
    write_values(base + "_dose.txt", dose_element.text.strip().split(), "Dose")

    # ── Defocus ──
    gridctf = root.find("GridCTF")
    if gridctf is None:
        return {"status": "error", "msg": f"No GridCTF element in {xml_path}"}
    def_values = []
    for node in gridctf.iter("Node"):
        zv = node.attrib["Z"]
        n_ctf   = root.find(f"./GridCTF/Node/[@Z='{zv}']")
        n_delta = root.find(f"./GridCTFDefocusDelta/Node/[@Z='{zv}']")
        defv = float(n_ctf.attrib["Value"])
        defu = float(n_delta.attrib["Value"]) + defv
        def_values.append((defu + defv) / 2)
    write_values(base + "_defocus.txt", def_values, "Defocus")

    return {
        "status":   "ok",
        "xml":      xml_path,
        "tlt":      base + ".tlt",
        "dose":     base + "_dose.txt",
        "defocus":  base + "_defocus.txt",
        "n_tilts":  len(angle_values),
        "flipped":  flip_angles,
    }


def extract_all(xml_dir: str, flip_angles: bool = True) -> list[dict]:
    """Extract info from all XML files in a directory."""
    results = []
    for xml_file in sorted(Path(xml_dir).glob("*.xml")):
        print(f"─── {xml_file.name}")
        results.append(extract_from_xml(str(xml_file), flip_angles))
    return results


def main():
    parser = argparse.ArgumentParser(
        description="Extract tilt angles, dose, defocus from Warp XML files for PyTom. "
                    "No Warp installation needed.",
        epilog="Original script by Huy Bui, extended for CryoSTAR-Base",
    )
    # Mutually exclusive: directory (batch) or file(s)
    grp = parser.add_mutually_exclusive_group()
    grp.add_argument("--xml-dir",  type=str, default=None,
                     help="Directory containing XML files — process all *.xml (batch mode)")
    grp.add_argument("xml_files",  nargs="*", default=[],
                     help="One or more XML file paths (single/multi mode)")

    parser.add_argument("--no-flip", action="store_true",
                        help="Do NOT negate tilt angles (use for linux Warp / WarpTools)")

    args = parser.parse_args()
    flip = not args.no_flip

    print("=" * 56)
    print("  Extract Warp XML info for PyTom template matching")
    print("=" * 56)
    print(f"  Flip angles: {'No (--no-flip)' if not flip else 'Yes (default)'}")
    print()

    ok = err = skip = 0

    if args.xml_dir:
        # Batch mode: process all XMLs in directory
        results = extract_all(args.xml_dir, flip)
    else:
        # Single/multi mode: process given file(s), support glob strings
        results = []
        for xml_path in args.xml_files:
            expanded = list(Path().glob(xml_path)) if "*" in xml_path else [Path(xml_path)]
            for xf in expanded:
                print(f"─── {xf.name}")
                results.append(extract_from_xml(str(xf), flip))

    for result in results:
        if result["status"] == "ok":
            ok += 1
        elif result["status"] == "error":
            print(f"  ERROR: {result['msg']}")
            err += 1
        else:
            skip += 1

    print()
    print(f"Done: {ok} processed, {err} errors, {skip} skipped")


if __name__ == "__main__":
    main()