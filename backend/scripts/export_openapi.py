"""openapi.json書き出しスクリプト。

フロントエンドの型生成（`npm run generate-types`。docs/spec.md 3.2 / ADR-005）は
`backend/openapi.json` を入力とする。サーバー起動なしで`app.openapi()`を直接呼び出し
JSONへダンプすることで、フロント側はバックエンドプロセスを立ち上げずに型生成できる。
`python scripts/export_openapi.py` で実行する。
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import app  # noqa: E402

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "openapi.json"


def main() -> int:
    schema = app.openapi()
    OUTPUT_PATH.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"openapi.jsonを書き出しました: {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
