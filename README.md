# Crônicas de Algorion — Backend

Backend do jogo **Crônicas de Algorion** (Node.js + TypeScript + Socket.IO + MongoDB).

## Requisitos

- Node.js 18+ (recomendado)
- MongoDB:
    - **Atlas** (recomendado) ou
    - **Local** (localhost:27017)

## Configuração (.env)

Crie um arquivo `.env` na raiz do backend (veja `.env.example`):

```env
MONGO_URI=mongodb://localhost:27017/cronicas-algorion
PORT=3001
CORS_ORIGIN=*
```

### Variáveis de ambiente

- `MONGO_URI`: string de conexão do MongoDB (Atlas ou local)
- `PORT`: porta do servidor HTTP/Socket.IO
- `CORS_ORIGIN`: origem permitida (em produção, use a URL do seu frontend)

> Dica (Atlas): se aparecer erro de whitelist/IP, configure em Atlas > Network Access.

## Instalação

```bash
npm install
```

## Rodar em desenvolvimento

```bash
npm run dev
```

## Build / Produção

```bash
npm run build
npm start
```

## Seed do banco

Popula as coleções com dados do jogo (heróis, casas, fragmentos do enigma final, etc.).

```bash
npm run seed
```

> O seed usa a mesma `MONGO_URI` do `.env`.

## Smoke test (Socket.IO)

Executa um teste automatizado do fluxo principal via Socket.IO:

```bash
npm run smoke:test
```

## Observações

- O servidor encerra com código 1 se não conseguir conectar ao MongoDB.
- Em ambientes como Render, configure `MONGO_URI` e `CORS_ORIGIN` nas variáveis do serviço.
