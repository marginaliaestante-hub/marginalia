# Marginália

Estante pessoal de leitura (Julia e irmã). Site estático publicado no GitHub Pages; login, banco e arquivos no Supabase.

## Arquivos
- `index.html` — a Marginália (mesmo código do artefato, com ajustes mínimos)
- `marginalia-cloud.js` — camada que imita `window.claude.use('db' | 'assets' | 'downloads')` em cima do Supabase, e a tela de login
- `sw.js` — service worker que serve `_blob/{id}` (capas, textos, PDFs) do armazenamento privado e guarda cópia no aparelho
- `config.js` — URL do projeto e chave *publishable* (pública por natureza)
- `vendor/supabase-2.117.3.js` — biblioteca do Supabase (copiada aqui para não depender de CDN)

## Supabase
- Tabela `public.docs (owner, path, data, parent, id, updated_at)` — cada documento do antigo `db` vira uma linha; regras de segurança: cada usuária só lê/escreve as próprias linhas.
- Função `doc_update(path, patch)` — atualização parcial (mescla campos).
- Bucket privado `files`, pasta `{uid}/` por usuária, até 50 MB por arquivo.

## Nunca vai para o GitHub
`token-github.txt` e qualquer secret key (veja `.gitignore`).
