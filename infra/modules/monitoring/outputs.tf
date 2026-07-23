output "alarm_topic_arn" {
  description = "アラーム通知先のSNSトピックARN（購読を後から追加する際に使う）"
  value       = aws_sns_topic.alarms.arn
}
