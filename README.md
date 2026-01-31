# Audio Editor

https://github.com/houslast/pythonVideoAudio/blob/main/ddd.png
https://github.com/houslast/pythonVideoAudio/blob/main/dfdf.png
https://github.com/houslast/pythonVideoAudio/blob/main/dfdf.png
https://github.com/houslast/pythonVideoAudio/blob/main/dsd.png

Editor de áudio para sincronizar SFX com um vídeo e exportar o resultado.

## Requisitos

- Windows
- Python 3.10+
- Token do Freesound (obrigatório para buscar/baixar previews)

## Instalação

1. Abra um terminal na pasta do projeto.
2. Rode:

```bat
install.bat
```

Isso cria o `.venv`, instala as dependências e tenta baixar o modelo de tradução PT→EN.

## Rodar o app

```bat
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Depois, abra no navegador:

- http://127.0.0.1:8000/

## Como usar

### Buscar SFX (Freesound)

1. Clique em **Config** e cole seu token do Freesound.
2. Busque no painel esquerdo (em PT).
3. Arraste um resultado para a timeline.

### Timeline

- Arraste clipes para mover.
- Ctrl+Z / Ctrl+Y: desfazer / refazer
- Del: deletar
- R (ou Ctrl+K): recortar no playhead
- G: automação de ganho
- P: automação de pan
- Duplo clique no clipe: cria ponto de automação

### Mixagem (transição gradual)

Na aba **Mixagem**, ajuste **Tempo entre transição (crossfade)**.

Quando dois clipes na mesma faixa se sobrepõem até esse tempo:

- o clipe anterior faz fade-out gradual;
- o próximo faz fade-in gradual.

### Exportar MP3

Em **Config**, use a seção de exportação para gerar MP3.



