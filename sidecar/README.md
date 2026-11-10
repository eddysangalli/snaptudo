# SnapTudo Sidecar

Aplicativo nativo opcional que conecta a extensão ao `yt-dlp`. Ele existe porque extensões Manifest V3 não podem executar binários locais.

## Instalar

1. Baixe `snaptudo-sidecar-vX.Y.Z-win-x64.zip` na Release do SnapTudo.
2. Confira o arquivo `.sha256` publicado junto da Release.
3. Extraia o ZIP.
4. Execute `install-sidecar.ps1` no PowerShell.
5. Recarregue o SnapTudo em `chrome://extensions`.

O instalador registra o host somente para o ID fixo do SnapTudo e para Chrome, Edge e Brave no usuário atual. O sidecar aceita apenas URLs HTTPS de `youtube.com` e `youtu.be`, sempre com `--no-playlist`.

Os arquivos são salvos, por padrão, em `Downloads\SnapTudo`. Se FFmpeg estiver instalado, o modo vídeo combina vídeo e áudio em MP4 até 1080p; sem FFmpeg, tenta um formato combinado de até 720p. O modo áudio baixa a melhor faixa M4A disponível.

## Desinstalar

Execute `uninstall-sidecar.ps1`. A pasta de downloads não é removida.
