"""MockAIClient（app/services/ai_client.py）が返す高品質な帳票モック（ADR-020）。

ADR-020の決定に基づき、モックは用紙の向き（縦/横）だけで2種類を出し分ける。
「縦（ポートレート）」は納品書、「横（ランドスケープ）」は請求書とし、
A4/B5/A5のどのプリセットでも同じHTML/CSS/JSONを返す（用紙サイズごとの内容分岐は行わない）。
CSSのフォントサイズ・余白はpx固定ではなくvw単位（用紙の実寸幅に対する相対値）にすることで、
A4よりページ幅が狭いA5でも文字が用紙からはみ出さず、同じHTML/CSSのままA4/B5/A5の
いずれでも破綻なく収まるようにしている（frontend/src/components/PreviewPanel.tsxが
用紙の実寸pxでiframeを組版するため、vwは用紙の実寸幅に連動する）。

CLAUDE.mdの「固定情報と業務データの分離」規約に合わせ、自社情報（発行者）やラベル文言・
「御中」等の敬称はHTMLへ直書きの固定テキストとし、明細行を含む業務データのみを
{{key}}のテンプレート変数にする。フロントのテンプレート置換（frontend/src/lib/template.ts）は
トップレベルキーの単純な文字列置換のみに対応するため、ネスト・配列は使わず、
明細行は行番号を含んだキー名（例: item_1_qty）でフラットに表現する。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MockDocument:
    """1種類のモック帳票（HTML/CSS/業務データJSON）をまとめて保持する。"""

    html: str
    css: str
    data: dict


# --- 縦（ポートレート）: 納品書 -------------------------------------------------

_PORTRAIT_HTML = """<!doctype html>
<html lang="ja">
<body>
<div class="sheet-page">
  <header class="sheet-header">
    <div class="doc-title-block">
      <h1 class="doc-title">納品書</h1>
      <table class="doc-meta">
        <tr><th>文書番号</th><td>{{document_no}}</td></tr>
        <tr><th>発行日</th><td>{{issue_date}}</td></tr>
        <tr><th>納品日</th><td>{{delivery_date}}</td></tr>
      </table>
    </div>
    <div class="issuer-block">
      <strong class="issuer-name">アダプトシート株式会社</strong>
      <p class="issuer-address">〒100-0005 東京都千代田区丸の内1-1-1<br>丸の内タワー12F</p>
      <p class="issuer-contact">TEL 03-1234-5678 / FAX 03-1234-5679</p>
    </div>
  </header>

  <section class="recipient-block">
    <p class="recipient-name">{{recipient_name}} <span class="honorific">御中</span></p>
    <p class="recipient-meta">納品場所：{{delivery_location}} ／ ご担当：{{person_in_charge}} 様</p>
    <p class="lead-text">下記の通り納品いたしましたので、ご査収のほどよろしくお願い申し上げます。</p>
  </section>

  <table class="items-table">
    <thead>
      <tr>
        <th class="col-name">品名</th>
        <th class="col-spec">仕様</th>
        <th class="col-num">数量</th>
        <th class="col-num">単位</th>
        <th class="col-num">単価</th>
        <th class="col-num">金額</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>{{item_1_name}}</td><td class="spec">{{item_1_spec}}</td>
        <td class="num">{{item_1_qty}}</td><td class="num">{{item_1_unit}}</td>
        <td class="num">{{item_1_unit_price}}</td><td class="num">{{item_1_amount}}</td>
      </tr>
      <tr>
        <td>{{item_2_name}}</td><td class="spec">{{item_2_spec}}</td>
        <td class="num">{{item_2_qty}}</td><td class="num">{{item_2_unit}}</td>
        <td class="num">{{item_2_unit_price}}</td><td class="num">{{item_2_amount}}</td>
      </tr>
      <tr>
        <td>{{item_3_name}}</td><td class="spec">{{item_3_spec}}</td>
        <td class="num">{{item_3_qty}}</td><td class="num">{{item_3_unit}}</td>
        <td class="num">{{item_3_unit_price}}</td><td class="num">{{item_3_amount}}</td>
      </tr>
      <tr>
        <td>{{item_4_name}}</td><td class="spec">{{item_4_spec}}</td>
        <td class="num">{{item_4_qty}}</td><td class="num">{{item_4_unit}}</td>
        <td class="num">{{item_4_unit_price}}</td><td class="num">{{item_4_amount}}</td>
      </tr>
      <tr>
        <td>{{item_5_name}}</td><td class="spec">{{item_5_spec}}</td>
        <td class="num">{{item_5_qty}}</td><td class="num">{{item_5_unit}}</td>
        <td class="num">{{item_5_unit_price}}</td><td class="num">{{item_5_amount}}</td>
      </tr>
    </tbody>
  </table>

  <section class="totals-block">
    <table class="totals-table">
      <tr><th>小計</th><td class="num">&yen;{{subtotal}}</td></tr>
      <tr><th>消費税（10%）</th><td class="num">&yen;{{tax}}</td></tr>
      <tr class="total-row"><th>合計金額</th><td class="num">&yen;{{total}}</td></tr>
    </table>
  </section>

  <section class="remarks-block">
    <h2 class="remarks-title">備考</h2>
    <p class="remarks-body">{{remarks}}</p>
  </section>

  <footer class="sheet-footer">
    <p>本納品書に関するお問い合わせは、上記発行者までご連絡ください。</p>
  </footer>
</div>
</body>
</html>
"""

# vw単位を基準にしたフォント/余白は、用紙の実寸幅(px)に連動して自動的に縮尺される
# （PreviewPanel.tsxがiframeを用紙の実寸pxで組版するため）。A4よりページ幅が狭いA5・B5でも
# 同じCSSのまま文字がはみ出さず、逆にA4では読みやすい実寸フォントサイズになる。
_PORTRAIT_CSS = """
* { box-sizing: border-box; }
html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  color: #1f2933;
  font-family: "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif;
  font-size: 2.05vw;
  line-height: 1.6;
}
.sheet-page {
  width: 100%;
  height: 100%;
  padding: 4.4vw 4.8vw;
  display: flex;
  flex-direction: column;
  gap: 2.4vw;
}
.sheet-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 3vw;
  border-bottom: 0.3vw solid #2f5d50;
  padding-bottom: 1.8vw;
}
.doc-title {
  margin: 0 0 1.2vw;
  font-size: 1.9em;
  font-weight: 700;
  letter-spacing: 0.4em;
  text-indent: 0.4em;
}
.doc-meta { border-collapse: collapse; font-size: 0.82em; color: #3e4c59; }
.doc-meta th { text-align: left; font-weight: 500; color: #6b7785; padding: 0.15em 0.8em 0.15em 0; white-space: nowrap; }
.doc-meta td { text-align: left; padding: 0.15em 0; }
.issuer-block { text-align: right; font-size: 0.82em; color: #52606d; line-height: 1.7; }
.issuer-name { display: block; font-size: 1.2em; color: #1f2933; margin-bottom: 0.4em; }
.recipient-block { display: flex; flex-direction: column; gap: 0.5vw; }
.recipient-name { margin: 0; font-size: 1.35em; font-weight: 700; border-bottom: 0.15vw solid #1f2933; display: inline-block; padding-bottom: 0.25em; }
.honorific { font-weight: 500; }
.recipient-meta, .lead-text { margin: 0; font-size: 0.9em; color: #3e4c59; }
.items-table { width: 100%; border-collapse: collapse; font-size: 0.88em; }
.items-table th, .items-table td { border: 0.08vw solid #c7ccd1; padding: 0.7em 0.8em; }
.items-table thead th { background: #2f5d50; color: #fff; font-weight: 500; }
.items-table td.num, .items-table th.col-num { text-align: right; white-space: nowrap; }
.items-table td.spec { color: #52606d; font-size: 0.92em; }
.totals-block { display: flex; justify-content: flex-end; }
.totals-table { border-collapse: collapse; font-size: 0.95em; min-width: 45%; }
.totals-table th { text-align: left; font-weight: 500; color: #52606d; padding: 0.5em 1.2em 0.5em 0.4em; }
.totals-table td { text-align: right; padding: 0.5em 0.4em; }
.totals-table .total-row th, .totals-table .total-row td {
  border-top: 0.15vw solid #1f2933;
  font-size: 1.15em;
  font-weight: 700;
  padding-top: 0.7em;
}
.remarks-block { border-top: 0.08vw dashed #c7ccd1; padding-top: 1.6vw; }
.remarks-title { margin: 0 0 0.5em; font-size: 0.95em; font-weight: 700; color: #2f5d50; }
.remarks-body { margin: 0; font-size: 0.85em; color: #3e4c59; white-space: pre-wrap; }
.sheet-footer { margin-top: auto; text-align: center; font-size: 0.72em; color: #9aa5b1; }
"""

_PORTRAIT_DATA: dict = {
    "recipient_name": "株式会社サンプル商事",
    "document_no": "NS-2026-0311",
    "issue_date": "2026年7月11日",
    "delivery_date": "2026年7月15日",
    "delivery_location": "東京都千代田区大手町1-1-1 サンプルビル3F",
    "person_in_charge": "山田 太郎",
    "item_1_name": "オフィスチェア（メッシュバック）",
    "item_1_spec": "ブラック / W620×D620×H960",
    "item_1_qty": "10",
    "item_1_unit": "脚",
    "item_1_unit_price": "18,000",
    "item_1_amount": "180,000",
    "item_2_name": "折りたたみ会議テーブル",
    "item_2_spec": "W1800×D450×H700",
    "item_2_qty": "4",
    "item_2_unit": "台",
    "item_2_unit_price": "22,000",
    "item_2_amount": "88,000",
    "item_3_name": "LEDデスクライト",
    "item_3_spec": "調光3段階 / USB Type-C給電",
    "item_3_qty": "10",
    "item_3_unit": "個",
    "item_3_unit_price": "3,200",
    "item_3_amount": "32,000",
    "item_4_name": "キャビネット（3段）",
    "item_4_spec": "W400×D450×H700 / 鍵付き",
    "item_4_qty": "3",
    "item_4_unit": "台",
    "item_4_unit_price": "15,000",
    "item_4_amount": "45,000",
    "item_5_name": "配送・設置作業費",
    "item_5_spec": "搬入設置一式",
    "item_5_qty": "1",
    "item_5_unit": "式",
    "item_5_unit_price": "12,000",
    "item_5_amount": "12,000",
    "subtotal": "357,000",
    "tax": "35,700",
    "total": "392,700",
    "remarks": "納品後、検収書のご返送をお願いいたします。不明点は下記担当までご連絡ください。",
}

PORTRAIT_DELIVERY_NOTE = MockDocument(html=_PORTRAIT_HTML, css=_PORTRAIT_CSS, data=_PORTRAIT_DATA)


# --- 横（ランドスケープ）: 請求書 -----------------------------------------------

_LANDSCAPE_HTML = """<!doctype html>
<html lang="ja">
<body>
<div class="sheet-page">
  <header class="sheet-header">
    <div class="doc-title-block">
      <h1 class="doc-title">請求書</h1>
      <table class="doc-meta">
        <tr><th>請求書番号</th><td>{{invoice_no}}</td></tr>
        <tr><th>発行日</th><td>{{issue_date}}</td></tr>
        <tr><th>お支払期限</th><td>{{due_date}}</td></tr>
        <tr><th>対象期間</th><td>{{billing_period}}</td></tr>
      </table>
    </div>
    <div class="issuer-block">
      <strong class="issuer-name">アダプトシート株式会社</strong>
      <p class="issuer-address">〒100-0005 東京都千代田区丸の内1-1-1 丸の内タワー12F</p>
      <p class="issuer-contact">TEL 03-1234-5678 ／ 登録番号 T1234567890123</p>
    </div>
  </header>

  <div class="body-columns">
    <section class="recipient-block">
      <p class="recipient-name">{{recipient_name}} <span class="honorific">御中</span></p>
      <p class="lead-text">下記の通りご請求申し上げます。ご確認のほどよろしくお願い申し上げます。</p>
    </section>

    <section class="bank-block">
      <h2 class="bank-title">お振込先</h2>
      <table class="bank-table">
        <tr><th>銀行</th><td>{{bank_name}}</td></tr>
        <tr><th>支店</th><td>{{branch_name}}</td></tr>
        <tr><th>種別</th><td>{{account_type}}</td></tr>
        <tr><th>口座番号</th><td>{{account_number}}</td></tr>
        <tr><th>口座名義</th><td>{{account_holder}}</td></tr>
      </table>
    </section>
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th class="col-name">品名</th>
        <th class="col-num">数量</th>
        <th class="col-num">単位</th>
        <th class="col-num">単価</th>
        <th class="col-num">税率</th>
        <th class="col-num">金額</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>{{item_1_name}}</td><td class="num">{{item_1_qty}}</td><td class="num">{{item_1_unit}}</td>
        <td class="num">{{item_1_unit_price}}</td><td class="num">{{item_1_tax_rate}}</td><td class="num">{{item_1_amount}}</td>
      </tr>
      <tr>
        <td>{{item_2_name}}</td><td class="num">{{item_2_qty}}</td><td class="num">{{item_2_unit}}</td>
        <td class="num">{{item_2_unit_price}}</td><td class="num">{{item_2_tax_rate}}</td><td class="num">{{item_2_amount}}</td>
      </tr>
      <tr>
        <td>{{item_3_name}}</td><td class="num">{{item_3_qty}}</td><td class="num">{{item_3_unit}}</td>
        <td class="num">{{item_3_unit_price}}</td><td class="num">{{item_3_tax_rate}}</td><td class="num">{{item_3_amount}}</td>
      </tr>
      <tr>
        <td>{{item_4_name}}</td><td class="num">{{item_4_qty}}</td><td class="num">{{item_4_unit}}</td>
        <td class="num">{{item_4_unit_price}}</td><td class="num">{{item_4_tax_rate}}</td><td class="num">{{item_4_amount}}</td>
      </tr>
      <tr>
        <td>{{item_5_name}}</td><td class="num">{{item_5_qty}}</td><td class="num">{{item_5_unit}}</td>
        <td class="num">{{item_5_unit_price}}</td><td class="num">{{item_5_tax_rate}}</td><td class="num">{{item_5_amount}}</td>
      </tr>
    </tbody>
  </table>

  <div class="bottom-columns">
    <section class="remarks-block">
      <h2 class="remarks-title">備考</h2>
      <p class="remarks-body">{{remarks}}</p>
    </section>

    <section class="totals-block">
      <table class="totals-table">
        <tr><th>小計</th><td class="num">&yen;{{subtotal}}</td></tr>
        <tr><th>消費税（10%）</th><td class="num">&yen;{{tax}}</td></tr>
        <tr class="total-row"><th>ご請求金額</th><td class="num">&yen;{{total}}</td></tr>
      </table>
    </section>
  </div>
</div>
</body>
</html>
"""

# 横は用紙の縦幅が狭い（A4横=210mm高）ため、縦版よりvw係数をやや小さくし、
# 明細行数が変わらなくても1ページ内に収まるようにしている。
_LANDSCAPE_CSS = """
* { box-sizing: border-box; }
html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  color: #1f2933;
  font-family: "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif;
  font-size: 1.5vw;
  line-height: 1.55;
}
.sheet-page {
  width: 100%;
  height: 100%;
  padding: 2.6vw 3.2vw;
  display: flex;
  flex-direction: column;
  gap: 1.6vw;
}
.sheet-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 3vw;
  border-bottom: 0.22vw solid #1d4ed8;
  padding-bottom: 1.1vw;
}
.doc-title {
  margin: 0 0 0.8vw;
  font-size: 1.9em;
  font-weight: 700;
  letter-spacing: 0.4em;
  text-indent: 0.4em;
}
.doc-meta { border-collapse: collapse; font-size: 0.82em; color: #3e4c59; }
.doc-meta th { text-align: left; font-weight: 500; color: #6b7785; padding: 0.1em 0.8em 0.1em 0; white-space: nowrap; }
.doc-meta td { text-align: left; padding: 0.1em 0; }
.issuer-block { text-align: right; font-size: 0.82em; color: #52606d; line-height: 1.6; }
.issuer-name { display: block; font-size: 1.2em; color: #1f2933; margin-bottom: 0.3em; }
.body-columns { display: flex; justify-content: space-between; gap: 3vw; }
.recipient-block { flex: 1 1 60%; display: flex; flex-direction: column; gap: 0.4vw; }
.recipient-name { margin: 0; font-size: 1.3em; font-weight: 700; border-bottom: 0.13vw solid #1f2933; display: inline-block; padding-bottom: 0.2em; }
.honorific { font-weight: 500; }
.lead-text { margin: 0; font-size: 0.88em; color: #3e4c59; }
.bank-block { flex: 0 0 34%; background: #f4f6f8; border-radius: 0.4vw; padding: 0.9vw 1.2vw; }
.bank-title { margin: 0 0 0.4em; font-size: 0.85em; font-weight: 700; color: #1d4ed8; }
.bank-table { border-collapse: collapse; font-size: 0.8em; width: 100%; }
.bank-table th { text-align: left; font-weight: 500; color: #6b7785; padding: 0.15em 0.8em 0.15em 0; white-space: nowrap; }
.bank-table td { text-align: left; padding: 0.15em 0; }
.items-table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
.items-table th, .items-table td { border: 0.06vw solid #c7ccd1; padding: 0.55em 0.7em; }
.items-table thead th { background: #1d4ed8; color: #fff; font-weight: 500; }
.items-table td.num, .items-table th.col-num { text-align: right; white-space: nowrap; }
.bottom-columns { display: flex; justify-content: space-between; align-items: flex-start; gap: 3vw; margin-top: auto; }
.remarks-block { flex: 1 1 55%; border-top: 0.06vw dashed #c7ccd1; padding-top: 0.9vw; }
.remarks-title { margin: 0 0 0.4em; font-size: 0.88em; font-weight: 700; color: #1d4ed8; }
.remarks-body { margin: 0; font-size: 0.8em; color: #3e4c59; white-space: pre-wrap; }
.totals-block { flex: 0 0 38%; }
.totals-table { border-collapse: collapse; font-size: 0.9em; width: 100%; }
.totals-table th { text-align: left; font-weight: 500; color: #52606d; padding: 0.4em 1em 0.4em 0.2em; }
.totals-table td { text-align: right; padding: 0.4em 0.2em; }
.totals-table .total-row th, .totals-table .total-row td {
  border-top: 0.13vw solid #1f2933;
  font-size: 1.15em;
  font-weight: 700;
  padding-top: 0.6em;
}
"""

_LANDSCAPE_DATA: dict = {
    "recipient_name": "株式会社サンプル商事",
    "invoice_no": "INV-2026-0711",
    "issue_date": "2026年7月11日",
    "due_date": "2026年7月31日",
    "billing_period": "2026年6月分",
    "bank_name": "みずさわ銀行",
    "branch_name": "丸の内支店",
    "account_type": "普通",
    "account_number": "1234567",
    "account_holder": "アダプトシート（カ",
    "item_1_name": "帳票作成AIプラットフォーム 利用料（Standardプラン）",
    "item_1_qty": "1",
    "item_1_unit": "式",
    "item_1_unit_price": "80,000",
    "item_1_tax_rate": "10%",
    "item_1_amount": "80,000",
    "item_2_name": "追加ユーザーライセンス",
    "item_2_qty": "5",
    "item_2_unit": "名",
    "item_2_unit_price": "3,000",
    "item_2_tax_rate": "10%",
    "item_2_amount": "15,000",
    "item_3_name": "PDFテンプレート解析（Docling）オプション",
    "item_3_qty": "200",
    "item_3_unit": "件",
    "item_3_unit_price": "50",
    "item_3_tax_rate": "10%",
    "item_3_amount": "10,000",
    "item_4_name": "導入サポート（初期設定代行）",
    "item_4_qty": "1",
    "item_4_unit": "式",
    "item_4_unit_price": "30,000",
    "item_4_tax_rate": "10%",
    "item_4_amount": "30,000",
    "item_5_name": "保守サポート（当月分）",
    "item_5_qty": "1",
    "item_5_unit": "式",
    "item_5_unit_price": "12,000",
    "item_5_tax_rate": "10%",
    "item_5_amount": "12,000",
    "subtotal": "147,000",
    "tax": "14,700",
    "total": "161,700",
    "remarks": "お振込手数料は貴社にてご負担をお願いいたします。",
}

LANDSCAPE_INVOICE = MockDocument(html=_LANDSCAPE_HTML, css=_LANDSCAPE_CSS, data=_LANDSCAPE_DATA)
