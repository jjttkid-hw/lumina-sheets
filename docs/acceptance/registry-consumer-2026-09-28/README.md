# Registry consumer verification — 2026-09-28

The accepted r21 `lumina-report-sdk@0.29.0` archive was served by a local HTTP
registry fixture and passed `scripts/check-npm-registry.mjs`. The retained
[result](result.json) binds its 721,954 bytes and SHA-256
`8e150872f59d69b336ce5728d0f2835956e5ebdf43778a1fae3691f91fbc1885`.

The check downloaded and verified integrity and exact candidate bytes, installed
offline into a temporary consumer with a fresh npm cache, and imported the ESM
entry point. It then computed a cross-sheet formula (180) and exported/reimported
XLSX, checking both sheets, Chinese/emoji text, input values, formulas and results.
This exercises the package's dynamically loaded XLSX code without host dependencies.

The registry and release workflow tests passed (7 checks), including an importable
fake SDK missing required APIs, tampered bytes, missing versions and an unusable
user cache. This is release-tool verification, not evidence of public publication,
browser rendering, provenance or complete Excel compatibility. On this date the
public package request still returned HTTP 404 and local identity validation E401.
