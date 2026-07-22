// vscode-eslint-language-serverをコンテナ内で起動するための中継（ADR-024）。
//
// vscode-languageserverはinitializeで受け取ったprocessId（エディタのPID）を定期的に
// kill(0)で生存確認し、見つからなければ孤児プロセスとみなして自らexitする。ホストのPIDは
// コンテナからは存在しないため、この監視は必ず失敗する。processIdのみnullへ書き換えて
// 監視を無効化し、以降はLSPの標準入出力をそのまま中継する（親の終了はstdinのEOFで伝わる）。
const { spawn } = require('node:child_process')

const server = spawn('vscode-eslint-language-server', ['--stdio'], {
  stdio: ['pipe', 'inherit', 'inherit'],
})

server.on('exit', (code) => process.exit(code ?? 0))

let buffer = Buffer.alloc(0)
let rewritten = false

const forward = (chunk) => {
  if (rewritten) {
    server.stdin.write(chunk)
    return
  }

  buffer = Buffer.concat([buffer, chunk])
  const separator = buffer.indexOf('\r\n\r\n')
  if (separator === -1) return

  const header = buffer.subarray(0, separator).toString('ascii')
  const length = Number(/content-length:\s*(\d+)/i.exec(header)?.[1])
  const bodyStart = separator + 4
  if (!Number.isFinite(length) || buffer.length < bodyStart + length) return

  const message = JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString('utf8'))
  if (message.method === 'initialize') {
    message.params.processId = null
  }

  const body = Buffer.from(JSON.stringify(message), 'utf8')
  server.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
  server.stdin.write(body)
  server.stdin.write(buffer.subarray(bodyStart + length))
  rewritten = true
  buffer = Buffer.alloc(0)
}

process.stdin.on('data', forward)
process.stdin.on('end', () => server.stdin.end())
