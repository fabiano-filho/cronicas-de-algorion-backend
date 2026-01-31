import 'dotenv/config'
import mongoose from 'mongoose'
import * as fs from 'fs'
import * as path from 'path'
import {
    EventModel,
    FinalChallengeModel,
    FinalRiddleFragmentModel,
    GameConfigModel,
    HeroModel,
    HouseChallengeModel,
    HouseModel
} from '../models'

const MONGO_URI =
    process.env.MONGO_URI || 'mongodb://localhost:27017/cronicas-algorion'

async function seed() {
    try {
        await mongoose.connect(MONGO_URI)
        console.log('Conectado ao MongoDB')

        const seedPath = path.join(__dirname, 'algorion.seed.json')
        const rawData = fs.readFileSync(seedPath, 'utf-8')
        const data = JSON.parse(rawData)

        // Limpar coleções existentes
        await GameConfigModel.deleteMany({})
        await HeroModel.deleteMany({})
        await EventModel.deleteMany({})
        await HouseModel.deleteMany({})
        await FinalRiddleFragmentModel.deleteMany({})
        await FinalChallengeModel.deleteMany({})
        await HouseChallengeModel.deleteMany({})
        console.log('Coleções limpas')

        // Inserir game_config
        await GameConfigModel.create(data.game_config)
        console.log('GameConfig inserido')

        // Inserir heróis
        await HeroModel.insertMany(data.heroes)
        console.log(`${data.heroes.length} heróis inseridos`)

        // Inserir eventos
        await EventModel.insertMany(data.events)
        console.log(`${data.events.length} eventos inseridos`)

        // Inserir casas
        await HouseModel.insertMany(data.houses)
        console.log(`${data.houses.length} casas inseridas`)

        // Inserir fragmentos do enigma final
        await FinalRiddleFragmentModel.insertMany(data.final_riddle_fragments)
        console.log(
            `${data.final_riddle_fragments.length} fragmentos do enigma final inseridos`
        )

        // Inserir desafio final
        await FinalChallengeModel.create(data.final_challenge)
        console.log('Desafio final inserido')

        // Inserir desafios das casas
        await HouseChallengeModel.insertMany(data.house_challenges || [])
        console.log(
            `${(data.house_challenges || []).length} desafios das casas inseridos`
        )

        console.log('Seed concluído com sucesso!')
    } catch (error) {
        console.error('Erro ao executar seed:', error)
    } finally {
        await mongoose.disconnect()
        console.log('Desconectado do MongoDB')
    }
}

seed()

