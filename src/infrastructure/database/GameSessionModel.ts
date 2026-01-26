import mongoose, { Schema } from 'mongoose'

const PlayerSchema = new Schema({
    id: { type: String, required: true },
    nome: { type: String, required: true },
    heroType: { type: String, required: true },
    posicao: { type: String, required: true }
})

const CardSchema = new Schema({
    id: { type: String, required: true },
    tipo: { type: String, required: true },
    revelada: { type: Boolean, required: true },
    custoExploracao: { type: Number, required: true },
    enigma: { type: String, required: true }
})

const HintCardSchema = new Schema({
    id: { type: String, required: true },
    casaId: { type: String, required: true },
    tipo: { type: String, enum: ['easy', 'hard'], required: true },
    texto: { type: String, required: true },
    source: { type: String, required: true },
    frontSource: { type: String, required: true },
    fragmentIndex: { type: Number, required: true },
    ordem: { type: Number, required: false }
})

const GameSessionSchema = new Schema({
    id: { type: String, required: true },
    ph: { type: Number, required: true },
    rodadaAtual: { type: Number, required: true },
    deckEventos: { type: [String], required: true },
    estadoTabuleiro: { type: [[CardSchema]], required: true },
    cronometro: { type: Number, required: true },
    listaJogadores: { type: [PlayerSchema], required: true },
    deckPistas: { type: [HintCardSchema], default: [] },
    puzzleDeck: {
        drawPile: { type: [Number], default: [] },
        assignedByHouse: { type: Schema.Types.Mixed, default: {} }
    },
    eventoAtivo: { type: Schema.Types.Mixed, default: null },
    primeiroMovimentoGratisUsadoPorJogador: {
        type: Schema.Types.Mixed,
        default: {}
    },
    primeiroEnigmaDescontoUsado: { type: Boolean, default: false },
    movimentoGratisHeroiPorJogador: { type: Schema.Types.Mixed, default: {} },
    descontoEnigmaHeroiPorJogador: { type: Schema.Types.Mixed, default: {} },
    habilidadesUsadasPorJogador: { type: Schema.Types.Mixed, default: {} },
    inventarioPistas: {
        type: Schema.Types.Mixed,
        default: { easy: [], hard: [] }
    },
    riddlePendente: { type: Schema.Types.Mixed, default: null },
    registrosEnigmas: { type: Schema.Types.Mixed, default: {} }
})

export const GameSessionModel = mongoose.model('GameSession', GameSessionSchema)
