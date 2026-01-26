import 'dotenv/config'
import express from 'express'
import http from 'http'
import cors from 'cors'
import { Server } from 'socket.io'
import { connectDatabase } from './infrastructure/database/connection'
import { initGameDataCache } from './infrastructure/gameData/GameDataCache'
import { registerSocketHandlers } from './infrastructure/sockets/socketHandlers'

const app = express()
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'
app.use(
    cors({
        origin: CORS_ORIGIN
    })
)
app.use(express.json())

const server = http.createServer(app)
const io = new Server(server, {
    cors: {
        origin: CORS_ORIGIN
    }
})

registerSocketHandlers(io)

const PORT = process.env.PORT || 3001
const MONGO_URI =
    process.env.MONGO_URI || 'mongodb://localhost:27017/cronicas-algorion'

async function start() {
    try {
        await connectDatabase(MONGO_URI)
        await initGameDataCache()
        server.listen(PORT, () => {
            console.log(`Servidor ativo na porta ${PORT}`)
        })
    } catch (error) {
        console.error('Erro ao iniciar servidor', error)

        const isAtlas = MONGO_URI.startsWith('mongodb+srv://')
        const helpLines: string[] = []

        helpLines.push('\nComo corrigir:')
        if (isAtlas) {
            helpLines.push(
                '- Você está usando MongoDB Atlas (mongodb+srv). Verifique se seu IP está liberado em Atlas > Network Access.'
            )
            helpLines.push(
                '- Para DEV rápido, você pode liberar temporariamente 0.0.0.0/0 (não recomendado em produção).'
            )
            helpLines.push(
                '- Confirme usuário/senha e se a senha tem caracteres especiais, use URL-encode.'
            )
        } else {
            helpLines.push(
                '- Você está usando Mongo local. Certifique-se de que o MongoDB está rodando em localhost:27017.'
            )
            helpLines.push(
                '- Alternativa rápida: Docker -> docker run -d --name mongo-algorion -p 27017:27017 mongo:7'
            )
        }
        helpLines.push(
            `- A URI atual vem de MONGO_URI. Se não existir, cai no padrão: mongodb://localhost:27017/cronicas-algorion`
        )
        helpLines.push(
            '- Depois de conectar, rode: npm run seed (na pasta backend)'
        )

        console.error(helpLines.join('\n'))
        process.exit(1)
    }
}

start()
