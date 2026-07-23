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
