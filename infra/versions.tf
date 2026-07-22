terraform {
  # 実際のバージョン固定はmise.tomlが持つ（ADR-023）。ここはmise外で実行された場合のガード。
  required_version = "~> 1.15"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
