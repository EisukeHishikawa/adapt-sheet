# APIキーの入れ物（SecureString）のみをTerraformで作成する。実値はイメージにもstateにも残さないため、
# ダミー値で作成し、以降の実値はコンソール/CLIで投入する（ignore_changesでTerraformは値を追跡しない）。
# ADR-017・CLAUDE.mdのセキュリティ規約に基づく。
resource "aws_ssm_parameter" "secret" {
  for_each = toset(var.secret_names)

  name        = "${var.prefix}/${each.value}"
  type        = "SecureString"
  value       = "PLACEHOLDER_SET_OUT_OF_BAND"
  description = "API key: ${each.value}（実値はTerraform管理外で投入する）"

  lifecycle {
    ignore_changes = [value]
  }
}
