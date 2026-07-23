data "aws_caller_identity" "current" {}

# バケット名はグローバル一意が必要なため、アカウントIDを付与して衝突を避ける。
resource "aws_s3_bucket" "frontend" {
  bucket = "${var.name}-frontend-${data.aws_caller_identity.current.account_id}"
}

# 直接公開せず、CloudFront（OAC）経由でのみ配信する。
resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudFrontのアクセスログ置き場。公開の入口であるCloudFrontのログが無いと、
# 「誰がどのパスを叩いたか」がAPI Gatewayへ到達したリクエストの分しか残らない（ADR-030）。
resource "aws_s3_bucket" "logs" {
  count  = var.enable_access_logging ? 1 : 0
  bucket = "${var.name}-cf-logs-${data.aws_caller_identity.current.account_id}"

  # ログは再作成できない資産ではないため、destroy時に中身ごと消せるようにして
  # `terraform destroy`がバケット非空で失敗するのを避ける。
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "logs" {
  count  = var.enable_access_logging ? 1 : 0
  bucket = aws_s3_bucket.logs[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudFrontの標準ログ配信はバケットACL（awslogsdeliveryへのFULL_CONTROL付与）を使うため、
# ACL無効（BucketOwnerEnforced）だと配信自体が失敗する。ACLの付与はCloudFrontが自動で行う。
resource "aws_s3_bucket_ownership_controls" "logs" {
  count  = var.enable_access_logging ? 1 : 0
  bucket = aws_s3_bucket.logs[0].id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  count  = var.enable_access_logging ? 1 : 0
  bucket = aws_s3_bucket.logs[0].id

  rule {
    apply_server_side_encryption_by_default {
      # CloudFrontの標準ログ配信はSSE-KMSのバケットへ書き込めないため、SSE-S3にする。
      sse_algorithm = "AES256"
    }
  }
}

# 保持期間を明示しないとログが無期限に積み上がり、コストだけが増え続ける。
resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  count  = var.enable_access_logging ? 1 : 0
  bucket = aws_s3_bucket.logs[0].id

  rule {
    id     = "expire-access-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = var.log_retention_in_days
    }
  }
}

resource "aws_cloudfront_origin_access_control" "this" {
  name                              = "${var.name}-frontend-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# SPAのフォールバック。distribution全体に効く custom_error_response ではなくビューワーリクエストの
# URI書き換えで行う。前者は /api/* のレスポンスにも適用され、バックエンドが返す403（未ログインの
# ゲート判定）や404がHTML（index.html）へ差し替わってしまうため（ADR-012の構造化エラーが壊れる）。
resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${var.name}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true

  code = <<-JS
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
      // 拡張子を持たないパス（クライアントルーティングのURL）だけをindex.htmlへ集約し、
      // 実在しないアセットは404のままにする。
      if (lastSegment.indexOf('.') === -1) {
        request.uri = '/index.html';
      }
      return request;
    }
  JS
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200"

  dynamic "logging_config" {
    for_each = var.enable_access_logging ? [1] : []

    content {
      bucket = aws_s3_bucket.logs[0].bucket_domain_name
      prefix = "cloudfront/"
      # 認証はAuthorizationヘッダーのJWTで行いCookieを使わないため、記録する価値がない。
      include_cookies = false
    }
  }

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.this.id
  }

  # SPAとAPIを同一オリジン（CloudFrontのドメイン）に揃える。フロントは相対パスで/api/...を叩く
  # ため、別オリジンにするとCORSとCSP（connect-src 'self'）の両方に阻まれる。
  origin {
    domain_name = var.api_origin_domain_name
    origin_id   = "apigw-backend"
    origin_path = var.api_origin_path

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      # API Gateway REST APIの統合タイムアウト上限（29秒）より短く切らない。
      origin_read_timeout = 30
    }
  }

  default_cache_behavior {
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = "apigw-backend"
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    # PDFはgzip済みの内容が多く再圧縮の利得が薄いうえ、CloudFrontの圧縮はリクエストボディには
    # 効かないため無効にする。
    compress = false

    # APIレスポンスはユーザーごとに異なるためキャッシュしない。
    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0

    forwarded_values {
      query_string = true
      # Supabase JWTを載せるAuthorizationはオリジンへ通す必要がある。
      headers = ["Authorization", "Content-Type"]
      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    # 独自ドメインは未使用のため、CloudFront既定証明書（*.cloudfront.net）を使う。
    cloudfront_default_certificate = true
  }

  # ログ配信のACL付与はバケットのACLが有効になっている必要があるため、作成順を固定する。
  depends_on = [aws_s3_bucket_ownership_controls.logs]
}

# CloudFront（このディストリビューション）からのみS3読み取りを許可する。
data "aws_iam_policy_document" "s3" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.s3.json
}
