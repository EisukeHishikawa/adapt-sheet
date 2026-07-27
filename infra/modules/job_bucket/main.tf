data "aws_caller_identity" "current" {}

# 非同期レンダリングジョブの入出力置き場（backendがアップロード用の署名付きURLを発行し、
# render-workerが結果を書き込む）。バケット名はグローバル一意が必要なためアカウントIDを付与する。
resource "aws_s3_bucket" "this" {
  bucket = "${var.name}-render-jobs-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ブラウザ（フロントのCloudFrontオリジン）から署名付きURLへ直接PUTするため、CORSの許可が必須。
# 未設定だとpresigned URLの署名自体は正しくても、ブラウザのfetchがCORSでブロックし
# 「サーバーで想定外のエラーが発生しました」として失敗する（curl等CORSを検査しないツールでは再現しない）。
resource "aws_s3_bucket_cors_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = var.allowed_origins
    allowed_headers = ["Content-Type"]
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# アップロードされたPDF・ジョブ結果は短命なデータのため、一定期間で自動失効させて
# 溜め続けない（PDFは業務データを含むため無期限に残さない）。
resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    id     = "expire-jobs"
    status = "Enabled"

    filter {}

    expiration {
      days = var.expiration_days
    }
  }
}
