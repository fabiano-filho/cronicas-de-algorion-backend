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
    nome: string
    descricao: string
    modificadores: EventModifiers
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
}

export class GameSession {
    public id: string
    public ph: number
    public rodadaAtual: number
    public deckEventos: string[]
    public estadoTabuleiro: (Card | null)[][]
    public cronometro: number
    public listaJogadores: Player[]
    public eventoAtivo: EventCard | null = null
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
    public slotsEnigmaFinal: HintSlot[] = [
        { slotIndex: 0, cardId: null },
        { slotIndex: 1, cardId: null },
        { slotIndex: 2, cardId: null },
        { slotIndex: 3, cardId: null },
        { slotIndex: 4, cardId: null },
        { slotIndex: 5, cardId: null },
        { slotIndex: 6, cardId: null },
        { slotIndex: 7, cardId: null }
    ]

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
        custoPH: 0 | 1 | 2 | 3
        jogadorId?: string
    } | null = null
    public registrosEnigmas: Record<string, 'SucessoOtimo' | 'Bom' | 'Ruim'> =
        {}

    constructor(props: GameSessionProps) {
        this.id = props.id
        this.ph = props.ph
        this.rodadaAtual = props.rodadaAtual
        this.deckEventos = props.deckEventos
        this.estadoTabuleiro = props.estadoTabuleiro
        this.cronometro = props.cronometro
        this.listaJogadores = props.listaJogadores
    }
}
