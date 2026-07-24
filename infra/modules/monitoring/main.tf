# ログを取るだけでは障害に気づけないため、発報経路までをコード化する（ADR-030）。
# 通知先はSNSトピックに集約し、購読手段（メール/後からChatbot等）はトピックへ足す形にする。
resource "aws_sns_topic" "alarms" {
  name = "${var.name}-alarms"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# --- Lambda（backend / docling / pdf2htmlex） ---

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = toset(var.lambda_function_names)

  alarm_name          = "${each.value}-errors"
  alarm_description   = "Lambda ${each.value} が例外で終了した"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = var.period_seconds
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = var.lambda_error_threshold

  # エラーが起きない間はデータポイント自体が来ない。missingをnotBreachingにしないと
  # 常時INSUFFICIENT_DATAになり、アラームとして機能しない。
  treat_missing_data = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  for_each = toset(var.lambda_function_names)

  alarm_name          = "${each.value}-throttles"
  alarm_description   = "Lambda ${each.value} が同時実行数の上限で絞られた"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = var.period_seconds
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
}

# --- API Gateway ---

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.name}-api-5xx"
  alarm_description   = "API Gatewayが5XXを返した（Lambda障害・統合タイムアウト等）"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5XXError"
  dimensions          = { ApiName = var.api_name, Stage = var.api_stage_name }
  statistic           = "Sum"
  period              = var.period_seconds
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = var.api_5xx_threshold
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_4xx" {
  alarm_name          = "${var.name}-api-4xx"
  alarm_description   = "API Gatewayの4XXが多発（スロットリング429の常態化・不正リクエストの可能性）"
  namespace           = "AWS/ApiGateway"
  metric_name         = "4XXError"
  dimensions          = { ApiName = var.api_name, Stage = var.api_stage_name }
  statistic           = "Sum"
  period              = var.period_seconds
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = var.api_4xx_threshold
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
}

# --- アプリログ（ADR-011のJSON構造化ログ）由来 ---

# AWS/Lambdaの Errors はハンドラが例外で落ちた場合しか数えない。ADR-012により想定外例外も
# 500レスポンスへ変換して正常終了するため、アプリ内部のERRORはログからしか観測できない。
resource "aws_cloudwatch_log_metric_filter" "backend_errors" {
  name           = "${var.name}-backend-app-errors"
  log_group_name = var.backend_log_group_name

  # ADR-011のJSON1行ログを前提に、levelフィールドで絞る。
  pattern = "{ $.level = \"ERROR\" }"

  metric_transformation {
    name      = "BackendApplicationErrors"
    namespace = "${var.name}/Application"
    value     = "1"
    # フィルタに一致しない期間を0で埋めることで、アラームがINSUFFICIENT_DATAへ落ちない。
    default_value = 0
  }
}

resource "aws_cloudwatch_metric_alarm" "backend_app_errors" {
  alarm_name          = "${var.name}-backend-app-errors"
  alarm_description   = "backendのアプリケーションログにERRORが出た（500へ丸められた想定外例外を含む）"
  namespace           = aws_cloudwatch_log_metric_filter.backend_errors.metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.backend_errors.metric_transformation[0].name
  statistic           = "Sum"
  period              = var.period_seconds
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
}
