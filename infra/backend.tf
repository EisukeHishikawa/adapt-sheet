# Terraform state はS3（ロックはDynamoDB）で管理する（ADR-005）。バケット/テーブル自体は
# infra/bootstrap で先に作成し、その値を init 時に -backend-config で渡す（partial configuration）。
# 値をここへ直書きしないのは、state置き場をコミットせず環境ごとに差し替えられるようにするため。
terraform {
  backend "s3" {
    # 例: terraform init \
    #   -backend-config="bucket=adapt-sheet-tfstate-<account_id>" \
    #   -backend-config="key=prod/terraform.tfstate" \
    #   -backend-config="region=ap-northeast-1" \
    #   -backend-config="dynamodb_table=adapt-sheet-tflock" \
    #   -backend-config="encrypt=true"
  }
}
