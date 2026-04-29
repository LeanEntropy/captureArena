"""Unity-flavored YAML loader.

Unity writes multi-document YAML with custom tags (`!u!N`) and anchors (`&fileID`)
that standard PyYAML chokes on without a constructor. We register a noop constructor
for the `!u!` tag family and split on document markers so each object is accessible
by its fileID.
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

_DOC_HEADER = re.compile(r"^---\s+!u!(?P<classId>\d+)\s+&(?P<fileId>-?\d+)(?:\s+stripped)?\s*$", re.MULTILINE)


class _UnityLoader(yaml.SafeLoader):
    pass


def _unity_tag_ctor(loader, tag_suffix, node):
    if isinstance(node, yaml.MappingNode):
        return loader.construct_mapping(node, deep=True)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node, deep=True)
    return loader.construct_scalar(node)


_UnityLoader.add_multi_constructor("tag:unity3d.com,2011:", _unity_tag_ctor)
_UnityLoader.add_multi_constructor("!u!", _unity_tag_ctor)


def load_unity_yaml(path: Path | str) -> dict[str, dict]:
    """Return {fileID: {classId, kind, body}} for every document in a Unity YAML file.

    `kind` is the top-level key inside the document (GameObject, RectTransform, ...).
    `body` is the parsed mapping under that key.
    """
    text = Path(path).read_text(encoding="utf-8")
    headers = [
        (m.start(), m.group("classId"), m.group("fileId"))
        for m in _DOC_HEADER.finditer(text)
    ]
    if not headers:
        return {}

    result: dict[str, dict] = {}
    for i, (start, class_id, file_id) in enumerate(headers):
        end = headers[i + 1][0] if i + 1 < len(headers) else len(text)
        # Drop the header line so PyYAML doesn't see the !u! tag
        chunk = text[start:end]
        chunk = chunk.split("\n", 1)[1] if "\n" in chunk else ""
        try:
            doc = yaml.load(chunk, Loader=_UnityLoader)
        except yaml.YAMLError as exc:
            raise ValueError(f"failed to parse fileID {file_id} in {path}: {exc}") from exc
        if not isinstance(doc, dict) or not doc:
            continue
        kind, body = next(iter(doc.items()))
        result[file_id] = {"class_id": class_id, "kind": kind, "body": body}
    return result


if __name__ == "__main__":
    import json
    import sys

    objs = load_unity_yaml(sys.argv[1])
    print(f"parsed {len(objs)} objects")
    kinds: dict[str, int] = {}
    for o in objs.values():
        kinds[o["kind"]] = kinds.get(o["kind"], 0) + 1
    print(json.dumps(kinds, indent=2, sort_keys=True))
