import { Card } from './Card'
import { Player } from './Player'

export type EventModifiers = {
    moverDelta?: number
    primeiroMovimentoGratisPorJogador?: boolean
    primeiroEnigmaDesconto?: number
    saltoLivreCusto?: number
    discussaoEmGrupoBloqueada?: boolean
}

export type EventCard = {
    id: string
    nome: string
    descricao: string
    modificadores: EventModifiers
    backSource?: string
}

export type SessionActionCosts = {
    mover: number
    explorar: number
    explorarNovamente: number
    saltoLivre: number
}

export type SessionCatalog = {
    heroes: Array<{
        id: string
        tipo: string
        nome: string
        habilidade: string
        descricao: string
    }>
    houses: Array<{
        id: string
        nome: string
        ordem: number
        hasTip: boolean
    }>
    events: Array<{
        id: string
        nome: string
        descricao: string
        backSource?: string
    }>
    gameConfig: {
        initialPh: number
        gridSize: string
        startingCardId: string
        totalEventsInDeck: number
        actionCosts: SessionActionCosts
    }
}

// Representa uma carta de pista no deck do jogador
export interface HintCard {
    id: string
    casaId: string
    tipo: 'easy' | 'hard'
    texto: string
    source: string
    frontSource: string
    fragmentIndex: number
    ordem?: number // Ordem original da casa (C1=1, C2=2, etc.)
}

export type PuzzleDeckState = {
    drawPile: number[]
    assignedByHouse: Record<string, number>
}

// Slot para montar o enigma final
export interface HintSlot {
    slotIndex: number
    cardId: string | null // ID da carta posicionada ou null se vazio
}

export interface GameSessionProps {
    id: string
    ph: number
    rodadaAtual: number
    deckEventos: string[]
    estadoTabuleiro: (Card | null)[][] // 3x3
    cronometro: number // segundos
    listaJogadores: Player[]
    slotsEnigmaFinal?: HintSlot[]
    catalogo?: SessionCatalog
}

function buildDefaultFinalSlots(): HintSlot[] {
    return Array.from({ length: 8 }, (_, slotIndex) => ({
        slotIndex,
        cardId: null
    }))
}

export class GameSession {
    public id: string
    public fase: 'lobby' | 'jogo' = 'lobby'
    public ph: number
    public rodadaAtual: number
    public deckEventos: string[]
    public estadoTabuleiro: (Card | null)[][]
    public cronometro: number
    public listaJogadores: Player[]
    public eventoAtivo: EventCard | null = null
    public catalogo: SessionCatalog | null = null
    public primeiroMovimentoGratisUsadoPorJogador: Record<string, boolean> = {}
    public primeiroEnigmaDescontoUsado: boolean = false
    public movimentoGratisHeroiPorJogador: Record<string, boolean> = {}
    public descontoEnigmaHeroiPorJogador: Record<string, number> = {}
    public habilidadesUsadasPorJogador: Record<string, boolean> = {}

    // Deck de cartas de pista coletadas (para arrastar no frontend)
    public deckPistas: HintCard[] = []

    // Deck/permutação de fragmentos do enigma final (1..8) para atribuição aleatória por casa
    public puzzleDeck: PuzzleDeckState = {
        drawPile: [],
        assignedByHouse: {}
    }

    // Slots para montar o enigma final (8 slots, um por casa exceto C5)
    public slotsEnigmaFinal: HintSlot[] = buildDefaultFinalSlots()

    // Texto montado do enigma final (atualizado quando slots são preenchidos)
    public textoEnigmaFinalMontado: string = ''

    // Controle de turno
    public jogadorAtualIndex: number = 0
    public jogoFinalizado: boolean = false
    public resultadoFinal: 'vitoria' | 'derrota' | null = null

    public inventarioPistas: {
        easy: string[]
        hard: string[]
    } = {
        easy: [],
        hard: []
    }
    public riddlePendente: {
        casaId: string
        custoPH: number
        jogadorId?: string
        isRetry?: boolean
    } | null = null
    public registrosEnigmas: Record<string, 'SucessoOtimo' | 'Bom' | 'Ruim'> =
        {}
    public desafioSelecionadoPorCasa: Record<string, string> = {}
    public enigmasExibidos: Record<string, boolean> = {}

    constructor(props: GameSessionProps) {
        this.id = props.id
        this.ph = props.ph
        this.rodadaAtual = props.rodadaAtual
        this.deckEventos = props.deckEventos
        this.estadoTabuleiro = props.estadoTabuleiro
        this.cronometro = props.cronometro
        this.listaJogadores = props.listaJogadores
        this.slotsEnigmaFinal =
            props.slotsEnigmaFinal && props.slotsEnigmaFinal.length === 8
                ? props.slotsEnigmaFinal
                : buildDefaultFinalSlots()
        this.catalogo = props.catalogo ?? null
    }
}
