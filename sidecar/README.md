# SnapTudo Sidecar

Aplicativo nativo opcional que conecta a extensão ao `yt-dlp`. Ele existe porque extensões Manifest V3 não podem executar binários locais.

## Instalar

1. Baixe `snaptudo-sidecar-vX.Y.Z-win-x64.zip` na Release do SnapTudo.
2. Confira o arquivo `.sha256` publicado junto da Release.
3. Extraia o ZIP.
4. Execute `install-sidecar.ps1` no PowerShell e confirme **Sim** no pedido de administrador do Windows.
5. Recarregue o SnapTudo em `chrome://extensions`.

O instalador coloca o sidecar em `C:\ProgramData\SnapTudo\Sidecar` para que Chrome, Edge e Brave consigam ler o manifesto nativo. Ele registra o host somente para o ID fixo do SnapTudo, nas visões 32 e 64 bits, tanto no usuário atual quanto no sistema.

O sidecar aceita apenas URLs HTTPS de `youtube.com` e `youtu.be`, sempre com `--no-playlist`.

Os arquivos são salvos, por padrão, em `Downloads\SnapTudo`. Se FFmpeg estiver instalado, o modo vídeo combina vídeo e áudio em MP4 até 1080p; sem FFmpeg, tenta um formato combinado de até 720p. O modo áudio baixa a melhor faixa M4A disponível.

Durante o download, o ícone do SnapTudo mostra o percentual no badge. O estado fica salvo pelo sidecar: ao reabrir o popup, você vê se ainda está baixando, finalizando, concluído ou se ocorreu uma falha. O botão **Abrir pasta Downloads\SnapTudo** leva aos arquivos prontos; os logs técnicos ficam em `C:\ProgramData\SnapTudo\Sidecar\logs`.

## Desinstalar

Execute `uninstall-sidecar.ps1` e confirme o pedido de administrador. A pasta de downloads não é removida.
