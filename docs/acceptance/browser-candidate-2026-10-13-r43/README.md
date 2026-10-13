# Lumina Sheets 0.29.0 candidate r43

Executed 2026-10-13 for the v2.0 development milestone. This candidate adds bounded stored-cell find/replace across the editor, report example and SDK. Search is row-major over stored source text, supports formula-source opt-in, literal replacement and empty deletion. Replacement is one atomic undo transaction with validation, selection preservation and formula invalidation; budget overflow rejects the whole operation.

The site SHA-256 is `854ccb9cd6624d33c31787c2c28f098a962e622a5fb284656b6c07d6661a1c32`; the SDK archive SHA-256 is `e06f1a889f35db43fb11babd0cb275f55a43ab086210556777ddd5577ce1423d`. The archive contains 41 files and is 733123 bytes. Core browser checks passed in Chromium, Firefox and WebKit, including find/replace, undo, literal `$&` handling, empty replacement, XLSX round trip and the workspace dialog. Framework, XLSX, WPS and business corpus checks also passed.

This is development evidence, not stable v2.0 approval. Native IME, physical touch, real screen readers, target-device performance and independent commercial/legal review remain open. npm publication is separate from product acceptance.
