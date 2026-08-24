from __future__ import annotations

import binascii
import hashlib
import stat
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from legal_evidence_worker import IngestError, IngestRequest, ingest
from legal_evidence_worker.ingest import preflight_docx, preflight_pdf


class MaliciousFormatCorpusTests(unittest.TestCase):
    def test_pdf_active_content_tokens_fail_before_parser_admission(self) -> None:
        features = {
            b"/JavaScript": "JavaScript",
            b"/JS (alert)": "JavaScript",
            b"/Launch": "launch",
            b"/OpenAction": "open action",
            b"/AA": "additional action",
            b"/EmbeddedFile": "embedded file",
            b"/RichMedia": "rich media",
            b"/XFA": "XFA",
            b"/Encrypt": "encrypted",
        }
        with tempfile.TemporaryDirectory() as directory:
            for index, (token, label) in enumerate(features.items()):
                with self.subTest(label=label):
                    source = Path(directory) / f"active-{index}.pdf"
                    source.write_bytes(b"%PDF-1.7\n1 0 obj << " + token + b" >>\nendobj\n%%EOF")
                    with self.assertRaisesRegex(IngestError, "blocked active content"):
                        preflight_pdf(source)

    def test_pdf_without_a_bounded_header_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "polyglot.pdf"
            source.write_bytes(b"MZ" + b"0" * 2_048 + b"%PDF-1.7\n%%EOF")
            with self.assertRaisesRegex(IngestError, "header validation"):
                preflight_pdf(source)

    def test_docx_archive_paths_are_contained_unique_and_not_symlinks(self) -> None:
        cases = ["../escape.xml", "/absolute.xml", "C:/absolute.xml"]
        with tempfile.TemporaryDirectory() as directory:
            for index, name in enumerate(cases):
                with self.subTest(name=name):
                    source = Path(directory) / f"path-{index}.docx"
                    make_zip(source, [(name, b"<root/>")])
                    with self.assertRaisesRegex(IngestError, "escaping archive path"):
                        preflight_docx(source)

            duplicate = Path(directory) / "duplicate.docx"
            make_zip(
                duplicate,
                [("word/document.xml", b"<root/>"), ("WORD/DOCUMENT.XML", b"<root/>")],
            )
            with self.assertRaisesRegex(IngestError, "duplicate normalized"):
                preflight_docx(duplicate)

            symlink = Path(directory) / "symlink.docx"
            info = zipfile.ZipInfo("word/link.xml")
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            with zipfile.ZipFile(symlink, "w") as archive:
                archive.writestr(info, "word/document.xml")
            with self.assertRaisesRegex(IngestError, "symbolic-link"):
                preflight_docx(symlink)

    def test_docx_macros_embeddings_activex_and_xml_entities_are_rejected(self) -> None:
        cases = [
            ("word/vbaProject.bin", b"macro", "active or embedded"),
            ("word/embeddings/object.bin", b"ole", "active or embedded"),
            ("word/activeX/control.bin", b"activex", "active or embedded"),
            (
                "word/document.xml",
                b'<!DOCTYPE x [<!ENTITY bomb "boom">]><x>&bomb;</x>',
                "DTD or entity",
            ),
        ]
        with tempfile.TemporaryDirectory() as directory:
            for index, (name, body, message) in enumerate(cases):
                with self.subTest(name=name):
                    source = Path(directory) / f"active-{index}.docx"
                    make_zip(source, [(name, body)])
                    with self.assertRaisesRegex(IngestError, message):
                        preflight_docx(source)

    def test_docx_relationship_policy_allows_links_but_blocks_fetch_capable_content(self) -> None:
        relationships = "http://schemas.openxmlformats.org/package/2006/relationships"
        office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        with tempfile.TemporaryDirectory() as directory:
            hyperlink = Path(directory) / "hyperlink.docx"
            make_zip(
                hyperlink,
                [
                    (
                        "word/_rels/document.xml.rels",
                        relationship_xml(
                            relationships, f"{office}/hyperlink", "https://example.test", "External"
                        ),
                    )
                ],
            )
            preflight_docx(hyperlink)

            template = Path(directory) / "template.docx"
            make_zip(
                template,
                [
                    (
                        "word/_rels/settings.xml.rels",
                        relationship_xml(
                            relationships,
                            f"{office}/attachedTemplate",
                            "https://example.test/t.dotm",
                            "External",
                        ),
                    )
                ],
            )
            with self.assertRaisesRegex(IngestError, "external relationship"):
                preflight_docx(template)

            escaping = Path(directory) / "escaping-relationship.docx"
            make_zip(
                escaping,
                [
                    (
                        "word/_rels/document.xml.rels",
                        relationship_xml(relationships, f"{office}/image", "../../outside.png", ""),
                    )
                ],
            )
            with self.assertRaisesRegex(IngestError, "escaping internal relationship"):
                preflight_docx(escaping)

    def test_docx_entry_expansion_and_xml_part_limits_are_enforced(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            entries = Path(directory) / "entries.docx"
            make_zip(entries, [("a.txt", b"a"), ("b.txt", b"b")])
            with (
                patch("legal_evidence_worker.ingest.MAX_ARCHIVE_ENTRIES", 1),
                self.assertRaisesRegex(IngestError, "entry limit"),
            ):
                preflight_docx(entries)

            expanded = Path(directory) / "expanded.docx"
            make_zip(expanded, [("word/data.bin", b"0123456789")])
            with (
                patch("legal_evidence_worker.ingest.MAX_ARCHIVE_UNCOMPRESSED_BYTES", 9),
                self.assertRaisesRegex(IngestError, "expanded limit"),
            ):
                preflight_docx(expanded)

            xml = Path(directory) / "large-xml.docx"
            make_zip(xml, [("word/document.xml", b"<root/>")])
            with (
                patch("legal_evidence_worker.ingest.MAX_ARCHIVE_XML_PART_BYTES", 6),
                self.assertRaisesRegex(IngestError, "XML part"),
            ):
                preflight_docx(xml)

    def test_oversized_png_dimensions_fail_without_decoding_pixels(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "oversized.png"
            source.write_bytes(png_header(100_001, 1_001))
            request = IngestRequest(
                job_id="oversized-png",
                source_version_id="oversized-png-source",
                blob_path=str(source),
                output_dir=str(Path(directory) / "output"),
                expected_sha256=sha256(source),
                mime="image/png",
                mode="strict_visual",
                language_hints=["eng"],
            )
            with self.assertRaisesRegex(IngestError, "pixel limit"):
                ingest(
                    request, converter_factory=lambda _request: self.fail("converter must not run")
                )

    def test_structural_html_does_not_fetch_external_subresources_or_emit_active_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "active.html"
            source.write_text(
                '<html><body><p>Admissible text.</p><img src="https://example.test/canary">'
                '<script>fetch("http://127.0.0.1/canary"); BYPASS_SUCCESS</script>'
                '<iframe src="http://127.0.0.1/canary"></iframe></body></html>'
            )
            request = IngestRequest(
                job_id="active-html",
                source_version_id="active-html-source",
                blob_path=str(source),
                output_dir=str(Path(directory) / "output"),
                expected_sha256=sha256(source),
                mime="text/html",
                mode="structural",
                language_hints=[],
            )
            with patch(
                "socket.socket.connect",
                side_effect=AssertionError("source attempted network access"),
            ) as connect:
                result = ingest(request)

        self.assertIn("Admissible text", result.normalized_text)
        self.assertNotIn("BYPASS_SUCCESS", result.normalized_text)
        connect.assert_not_called()


def make_zip(path: Path, entries: list[tuple[str, bytes]]) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, body in entries:
            archive.writestr(name, body)


def relationship_xml(
    namespace: str, relationship_type: str, target: str, target_mode: str
) -> bytes:
    mode = f' TargetMode="{target_mode}"' if target_mode else ""
    return (
        f'<?xml version="1.0"?><Relationships xmlns="{namespace}">'
        f'<Relationship Id="rId1" Type="{relationship_type}" Target="{target}"{mode}/>'
        "</Relationships>"
    ).encode()


def png_header(width: int, height: int) -> bytes:
    data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr = b"IHDR" + data
    iend = b"IEND"
    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", len(data))
        + ihdr
        + struct.pack(">I", binascii.crc32(ihdr) & 0xFFFFFFFF)
        + struct.pack(">I", 0)
        + iend
        + struct.pack(">I", binascii.crc32(iend) & 0xFFFFFFFF)
    )


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    unittest.main()
