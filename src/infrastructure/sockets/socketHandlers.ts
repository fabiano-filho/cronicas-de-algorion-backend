import { Server, Socket } from 'socket.io'
import { ActionManager } from '../../domain/services/ActionManager'
import { EventService } from '../../domain/services/EventSystem'
import {
    PuzzleValidator,
    QualidadeResposta
} from '../../domain/services/PuzzleValidator'
import { GameSession, HintCard } from '../../domain/entities/GameSession'
import { Card } from '../../domain/entities/Card'
import { Anao, Bruxa, Humano, Sereia } from '../../domain/entities/Hero'
import { Player } from '../../domain/entities/Player'
import { RiddleController } from '../../domain/services/RiddleController'
import { saveSession, getSession } from './sessionStore'
import {
    getFinalRiddleFragment,
    getHouseTipFrontSource
} from '../gameData/GameDataCache'

const actionManager = new ActionManager()
const eventService = new EventService()
const puzzleValidator = new PuzzleValidator()
const riddleController = new RiddleController(actionManager)

const DECK_EVENTOS_INICIAL = [
    'Fluxo Laminar',
    'Eco do Contrato',
    'Terreno Quebradiço',
    'Atalho Efêmero',
    'Névoa da Dúvida'
]

// Contador global para IDs de cartas de pista
let hintCardIdCounter = 1

// Habilidade da Bruxa: fluxo em duas etapas (seleção -> revelação de custos)
// Guardamos um "pending" simples por sessão+jogador para evitar spam/reentrância.
const bruxaEscolhaPendente = new Map<string, true>()

// Desafio Final: fluxo em chamada (jogador avisa -> mestre confirma)
const desafioFinalPendentePorSessao = new Map<string, string>()

// Nome pendente (antes de escolher herói)
const nomesPendentesPorSessao = new Map<string, Map<string, string>>()

function bruxaKey(sessionId: string, jogadorId: string): string {
    return `${sessionId}:${jogadorId}`
}

function getNomePendente(sessionId: string, jogadorId: string): string | null {
    return nomesPendentesPorSessao.get(sessionId)?.get(jogadorId) ?? null
}

function setNomePendente(
    sessionId: string,
    jogadorId: string,
    nome: string
): void {
    const atual = nomesPendentesPorSessao.get(sessionId) ?? new Map()
    atual.set(jogadorId, nome)
    nomesPendentesPorSessao.set(sessionId, atual)
}

function clearNomePendente(sessionId: string, jogadorId: string): void {
    const atual = nomesPendentesPorSessao.get(sessionId)
    if (!atual) return
    atual.delete(jogadorId)
    if (atual.size === 0) {
        nomesPendentesPorSessao.delete(sessionId)
    }
}

function nomeEmUso(
    session: GameSession,
    sessionId: string,
    nome: string,
    jogadorId: string
): boolean {
    const nomeLower = nome.toLowerCase()
    const duplicadoLista = session.listaJogadores.some(
        p => p.id !== jogadorId && p.nome.toLowerCase() === nomeLower
    )
    const duplicadoPendente = Array.from(
        nomesPendentesPorSessao.get(sessionId)?.entries() ?? []
    ).some(
        ([id, pendente]) =>
            id !== jogadorId && pendente.toLowerCase() === nomeLower
    )
    return duplicadoLista || duplicadoPendente
}

function todosSlotsEnigmaFinalPreenchidos(session: GameSession): boolean {
    return (
        Array.isArray(session.slotsEnigmaFinal) &&
        session.slotsEnigmaFinal.length > 0 &&
        session.slotsEnigmaFinal.every(s => !!s?.cardId)
    )
}

function getCustoEnigmaSemHeroi(session: GameSession, casaId: string): number {
    const custoCasa = riddleController.getCustoPH(casaId)
    const descontoEvento =
        session.eventoAtivo?.modificadores?.primeiroEnigmaDesconto &&
        !session.primeiroEnigmaDescontoUsado
            ? session.eventoAtivo.modificadores.primeiroEnigmaDesconto
            : 0
    return Math.max(0, custoCasa + descontoEvento)
}

function isCarta5Revelada(session: GameSession): boolean {
    try {
        const { row, col } = getBoardCoordsFromCasaId('C5')
        const card = session.estadoTabuleiro?.[row]?.[col] ?? null
        return !!card?.revelada
    } catch {
        return false
    }
}

function assertCarta5ReveladaParaMover(session: GameSession): void {
    if (!isCarta5Revelada(session)) {
        throw new Error(
            'A carta C5 precisa estar revelada antes de mover o peão.'
        )
    }
}

function generateHintCardId(): string {
    return `hint_${hintCardIdCounter++}`
}

function buildShuffledPuzzleDeck(): number[] {
    const deck = [1, 2, 3, 4, 5, 6, 7, 8]
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = deck[i]
        deck[i] = deck[j]
        deck[j] = tmp
    }
    return deck
}

function buildEmptyBoard(): null[][] {
    return [
        [null, null, null],
        [null, null, null],
        [null, null, null]
    ]
}

function buildEmptySlotsEnigmaFinal() {
    return [
        { slotIndex: 0, cardId: null },
        { slotIndex: 1, cardId: null },
        { slotIndex: 2, cardId: null },
        { slotIndex: 3, cardId: null },
        { slotIndex: 4, cardId: null },
        { slotIndex: 5, cardId: null },
        { slotIndex: 6, cardId: null },
        { slotIndex: 7, cardId: null }
    ]
}

function getBoardCoordsFromCasaId(casaId: string): {
    row: number
    col: number
} {
    const n = parseInt(casaId.replace('C', ''), 10)
    if (!Number.isFinite(n) || n < 1 || n > 9) {
        throw new Error(`Casa inválida: ${casaId}`)
    }
    const row = Math.floor((n - 1) / 3)
    const col = (n - 1) % 3
    return { row, col }
}

function ensureCardOnBoard(
    session: GameSession,
    casaId: string,
    custoExploracao: 0 | 1 | 2 | 3
): Card {
    const { row, col } = getBoardCoordsFromCasaId(casaId)
    const current = session.estadoTabuleiro?.[row]?.[col] ?? null
    if (current && current.id === casaId) {
        return current
    }
    const card = new Card({
        id: casaId,
        tipo: 'Local',
        revelada: false,
        custoExploracao,
        enigma: ''
    })
    session.estadoTabuleiro[row][col] = card
    return card
}

function buildInitialBoard(): (Card | null)[][] {
    const board = buildEmptyBoard() as (Card | null)[][]
    for (let n = 1; n <= 9; n++) {
        const casaId = `C${n}`
        const { row, col } = getBoardCoordsFromCasaId(casaId)
        board[row][col] = new Card({
            id: casaId,
            tipo: 'Local',
            revelada: false,
            custoExploracao: riddleController.getCustoPH(casaId),
            enigma: ''
        })
    }
    return board
}

function resetSessionState(session: GameSession): void {
    session.ph = 40
    session.rodadaAtual = 1
    session.deckEventos = [...DECK_EVENTOS_INICIAL]
    session.estadoTabuleiro = buildInitialBoard()
    session.cronometro = 0
    session.eventoAtivo = null
    session.primeiroMovimentoGratisUsadoPorJogador = {}
    session.primeiroEnigmaDescontoUsado = false
    session.movimentoGratisHeroiPorJogador = {}
    session.descontoEnigmaHeroiPorJogador = {}
    session.habilidadesUsadasPorJogador = {}
    session.deckPistas = []
    session.puzzleDeck.drawPile = buildShuffledPuzzleDeck()
    session.puzzleDeck.assignedByHouse = {}
    session.slotsEnigmaFinal = buildEmptySlotsEnigmaFinal()
    session.textoEnigmaFinalMontado = ''
    session.jogadorAtualIndex = 0
    session.jogoFinalizado = false
    session.resultadoFinal = null
    session.inventarioPistas = { easy: [], hard: [] }
    session.riddlePendente = null
    session.registrosEnigmas = {}

    session.listaJogadores.forEach(player => {
        player.posicao = 'C5'
    })
}

function buildHero(tipo: string) {
    switch (tipo) {
        case 'Anao':
            return new Anao()
        case 'Humano':
            return new Humano()
        case 'Sereia':
            return new Sereia()
        case 'Bruxa':
            return new Bruxa()
        default:
            return new Humano()
    }
}

function emitEstado(io: Server, session: GameSession): void {
    // Verificar se PH chegou a 0
    if (actionManager.verificarFimDeJogo(session)) {
        io.to(session.id).emit('forcar_desafio_final', {
            motivo: 'PH esgotado! O grupo deve responder o Desafio Final agora.',
            deckPistas: session.deckPistas,
            slotsEnigmaFinal: session.slotsEnigmaFinal,
            textoEnigmaFinalMontado: session.textoEnigmaFinalMontado
        })
    }
    io.to(session.id).emit('estado_atualizado', session)
}

function emitEventoAtivo(io: Server, session: GameSession): void {
    io.to(session.id).emit(
        'evento_ativo',
        session.eventoAtivo
            ? {
                nome: session.eventoAtivo.nome,
                descricao: session.eventoAtivo.descricao,
                modificadores: session.eventoAtivo.modificadores
            }
            : null
    )
}

function emitTurnoAtualizado(io: Server, session: GameSession): void {
    const jogadorAtual = actionManager.getJogadorAtual(session)
    io.to(session.id).emit('turno_atualizado', {
        jogadorAtualId: jogadorAtual?.id,
        jogadorAtualNome: jogadorAtual?.nome,
        jogadorAtualIndex: session.jogadorAtualIndex,
        rodadaAtual: session.rodadaAtual
    })
}

function iniciarProximoTurno(io: Server, session: GameSession): void {
    if (session.listaJogadores.length === 0) return

    const previousIndex = session.jogadorAtualIndex
    actionManager.avancarTurno(session)

    // Regra: o evento permanece durante a rodada inteira.
    // A rodada avança somente quando todos os jogadores já jogaram,
    // ou seja, quando o turno "dá a volta" e volta ao início.
    const wrappedToNewRound =
        session.listaJogadores.length > 0 &&
        session.jogadorAtualIndex <= previousIndex

    if (wrappedToNewRound) {
        session.rodadaAtual += 1
        eventService.iniciarRodada(session)
        emitEventoAtivo(io, session)
    }

    emitTurnoAtualizado(io, session)
}

function assertJogadorDaVez(session: GameSession, jogadorId: string): void {
    const jogadorAtual = actionManager.getJogadorAtual(session)
    if (!jogadorAtual) {
        throw new Error('Nenhum jogador definido para o turno atual')
    }
    if (jogadorAtual.id !== jogadorId) {
        throw new Error(
            `Ação negada: apenas o jogador da vez (${jogadorAtual.nome}) pode emitir comandos agora.`
        )
    }
}

function assertSemRespostaPendente(
    session: GameSession,
    jogadorId: string
): void {
    if (session.riddlePendente?.jogadorId === jogadorId) {
        throw new Error(
            'Aguarde a validação do Mestre para continuar após responder o enigma.'
        )
    }
}

export function registerSocketHandlers(io: Server): void {
    io.on('connection', (socket: Socket) => {
        // Verificar se uma sessão existe
        socket.on(
            'verificar_sessao',
            ({ sessionId }: { sessionId: string }) => {
                const session = getSession(sessionId)
                socket.emit('sessao_verificada', {
                    sessionId,
                    existe: !!session,
                    jogadoresConectados: session?.listaJogadores.length ?? 0
                })
            }
        )

        socket.on(
            'iniciar_sessao',
            ({
                sessionId,
                mestreId
            }: {
                sessionId: string
                mestreId: string
            }) => {
                const session = new GameSession({
                    id: sessionId,
                    ph: 40,
                    rodadaAtual: 1,
                    deckEventos: [...DECK_EVENTOS_INICIAL],
                    estadoTabuleiro: buildInitialBoard(),
                    cronometro: 0,
                    listaJogadores: []
                })

                // Inicializar permutação do puzzle (fragmentos 1..8) sem repetição
                session.puzzleDeck.drawPile = buildShuffledPuzzleDeck()
                session.puzzleDeck.assignedByHouse = {}

                eventService.iniciarRodada(session)
                saveSession(session)
                socket.join(sessionId)
                emitEstado(io, session)
                emitEventoAtivo(io, session)
            }
        )

        socket.on(
            'abrir_cronometro',
            ({ sessionId, tempo }: { sessionId: string; tempo: number }) => {
                const session = getSession(sessionId)
                if (!session) return
                session.cronometro = tempo
                emitEstado(io, session)
            }
        )

        // Compat: "avancar_rodada" avança o turno.
        // A rodada (e o evento) só avançam quando o turno volta ao primeiro jogador.
        socket.on('avancar_rodada', ({ sessionId }: { sessionId: string }) => {
            const session = getSession(sessionId)
            if (!session) return
            if (session.jogoFinalizado) {
                socket.emit('acao_negada', { motivo: 'Jogo já finalizado' })
                return
            }

            iniciarProximoTurno(io, session)
            emitEstado(io, session)
        })

        socket.on(
            'validar_resposta',
            ({
                sessionId,
                jogadorId,
                qualidade
            }: {
                sessionId: string
                jogadorId: string
                qualidade: QualidadeResposta
            }) => {
                const session = getSession(sessionId)
                if (!session) return
                puzzleValidator.registrarQualidade(
                    session,
                    jogadorId,
                    qualidade
                )
                emitEstado(io, session)
            }
        )

        socket.on(
            'liberar_dica',
            ({
                sessionId,
                cartaId
            }: {
                sessionId: string
                cartaId: string
            }) => {
                const session = getSession(sessionId)
                if (!session) return
                const todasCartas = session.estadoTabuleiro
                    .flat()
                    .filter(Boolean)
                const carta = todasCartas.find(c => c?.id === cartaId)
                if (carta) {
                    carta.revelada = true
                }
                emitEstado(io, session)
            }
        )

        // Entrar no lobby (para sincronização)
        socket.on(
            'entrar_lobby',
            ({
                sessionId,
                jogadorId,
                nome,
                isMestre
            }: {
                sessionId: string
                jogadorId: string
                nome: string
                isMestre: boolean
            }) => {
                const session = getSession(sessionId)
                if (!session) {
                    socket.emit('sessao_nao_encontrada')
                    return
                }
                socket.join(sessionId)

                // Emitir estado atual para o novo participante
                io.to(session.id).emit('lobby_atualizado', {
                    jogadores: session.listaJogadores
                })
                emitEstado(io, session)
            }
        )

        // Remover herói (jogador quer trocar)
        socket.on(
            'remover_heroi',
            ({
                sessionId,
                jogadorId
            }: {
                sessionId: string
                jogadorId: string
            }) => {
                const session = getSession(sessionId)
                if (!session) return

                // Remover jogador da lista (para ele poder escolher outro herói)
                const index = session.listaJogadores.findIndex(
                    p => p.id === jogadorId
                )
                if (index !== -1) {
                    session.listaJogadores.splice(index, 1)
                }

                io.to(session.id).emit('lobby_atualizado', {
                    jogadores: session.listaJogadores
                })
                emitEstado(io, session)
            }
        )

        // Iniciar o jogo (apenas mestre)
        socket.on(
            'iniciar_jogo',
            ({
                sessionId,
                mestreId
            }: {
                sessionId: string
                mestreId: string
            }) => {
                const session = getSession(sessionId)
                if (!session) return

                // Verificar se todos têm herói
                const todosComHeroi = session.listaJogadores.every(
                    j => j.hero !== null && j.hero !== undefined
                )

                if (!todosComHeroi) {
                    socket.emit('acao_negada', {
                        motivo: 'Todos os jogadores precisam escolher um herói antes de iniciar.'
                    })
                    return
                }

                if (session.listaJogadores.length === 0) {
                    socket.emit('acao_negada', {
                        motivo: 'Nenhum jogador conectado.'
                    })
                    return
                }

                // Marcar jogo como iniciado e emitir para todos
                io.to(session.id).emit('jogo_iniciado', {
                    sessionId,
                    jogadores: session.listaJogadores,
                    ph: session.ph,
                    rodadaAtual: session.rodadaAtual,
                    eventoAtivo: session.eventoAtivo
                })
            }
        )

        socket.on(
            'escolher_heroi',
            ({
                sessionId,
                jogadorId,
                nome,
                heroiTipo
            }: {
                sessionId: string
                jogadorId: string
                nome: string
                heroiTipo: string
            }) => {
                const session = getSession(sessionId)
                if (!session) return

                const nomePendente = getNomePendente(sessionId, jogadorId)
                const nomeNormalizado = (nomePendente ?? nome).trim()
                if (!nomeNormalizado) {
                    socket.emit('acao_negada', {
                        motivo: 'O nome não pode estar vazio.'
                    })
                    return
                }

                // Verificar se jogador já existe na sessão
                const existingPlayerIndex = session.listaJogadores.findIndex(
                    p => p.id === jogadorId
                )

                // Verificar se já existe outro jogador com o mesmo nome
                const nomeDuplicado = nomeEmUso(
                    session,
                    sessionId,
                    nomeNormalizado,
                    jogadorId
                )

                if (nomeDuplicado) {
                    socket.emit('acao_negada', {
                        motivo: `Já existe um jogador com o nome "${nomeNormalizado}" nesta sessão. Escolha outro nome.`
                    })
                    return
                }

                const hero = buildHero(heroiTipo)

                if (existingPlayerIndex !== -1) {
                    // Atualizar herói do jogador existente
                    session.listaJogadores[existingPlayerIndex].hero = hero
                    session.listaJogadores[existingPlayerIndex].nome =
                        nomeNormalizado
                } else {
                    // Criar novo jogador
                    const player = new Player({
                        id: jogadorId,
                        nome: nomeNormalizado,
                        hero,
                        posicao: 'C5' // Posição inicial é sempre C5 (centro do tabuleiro)
                    })
                    session.listaJogadores.push(player)
                }

                socket.join(sessionId)
                clearNomePendente(sessionId, jogadorId)

                // Emitir atualização do lobby para todos
                io.to(session.id).emit('lobby_atualizado', {
                    jogadores: session.listaJogadores
                })
                emitEstado(io, session)
            }
        )

        // Alterar nome do jogador
        socket.on(
            'alterar_nome',
            ({
                sessionId,
                jogadorId,
                novoNome
            }: {
                sessionId: string
                jogadorId: string
                novoNome: string
            }) => {
                const session = getSession(sessionId)
                if (!session) return

                const nomeNormalizado = novoNome.trim()
                if (!nomeNormalizado) {
                    socket.emit('acao_negada', {
                        motivo: 'O nome não pode estar vazio.'
                    })
                    return
                }

                // Verificar se já existe outro jogador com o mesmo nome
                const nomeDuplicado = nomeEmUso(
                    session,
                    sessionId,
                    nomeNormalizado,
                    jogadorId
                )

                if (nomeDuplicado) {
                    socket.emit('acao_negada', {
                        motivo: `Já existe um jogador com o nome "${nomeNormalizado}" nesta sessão. Escolha outro nome.`
                    })
                    return
                }

                // Encontrar jogador e atualizar nome
                const jogador = session.listaJogadores.find(p => p.id === jogadorId)
                if (jogador) {
                    jogador.nome = nomeNormalizado
                    clearNomePendente(sessionId, jogadorId)

                    // Emitir atualização para todos
                    io.to(session.id).emit('lobby_atualizado', {
                        jogadores: session.listaJogadores
                    })
                    emitEstado(io, session)

                    // Confirmar para o jogador
                    socket.emit('nome_alterado', { novoNome: nomeNormalizado })
                } else {
                    setNomePendente(sessionId, jogadorId, nomeNormalizado)
                    socket.emit('nome_alterado', { novoNome: nomeNormalizado })
                }
            }
        )

        // Remover jogador (mestre)
        socket.on(
            'remover_jogador',
            ({
                sessionId,
                jogadorIdRemover
            }: {
                sessionId: string
                jogadorIdRemover: string
            }) => {
                const session = getSession(sessionId)
                if (!session) return

                const index = session.listaJogadores.findIndex(
                    p => p.id === jogadorIdRemover
                )
                if (index === -1) return

                session.listaJogadores.splice(index, 1)

                // Ajustar turno atual
                if (session.listaJogadores.length === 0) {
                    session.jogadorAtualIndex = 0
                } else if (index < session.jogadorAtualIndex) {
                    session.jogadorAtualIndex = Math.max(
                        0,
                        session.jogadorAtualIndex - 1
                    )
                } else if (
                    index === session.jogadorAtualIndex &&
                    session.jogadorAtualIndex >= session.listaJogadores.length
                ) {
                    session.jogadorAtualIndex = 0
                }

                // Limpar pendências do jogador removido
                if (session.riddlePendente?.jogadorId === jogadorIdRemover) {
                    session.riddlePendente = null
                }
                if (
                    desafioFinalPendentePorSessao.get(sessionId) ===
                    jogadorIdRemover
                ) {
                    desafioFinalPendentePorSessao.delete(sessionId)
                }

                delete session.primeiroMovimentoGratisUsadoPorJogador[
                    jogadorIdRemover
                ]
                delete session.movimentoGratisHeroiPorJogador[jogadorIdRemover]
                delete session.descontoEnigmaHeroiPorJogador[jogadorIdRemover]
                delete session.habilidadesUsadasPorJogador[jogadorIdRemover]
                clearNomePendente(sessionId, jogadorIdRemover)
                bruxaEscolhaPendente.delete(bruxaKey(sessionId, jogadorIdRemover))

                io.to(session.id).emit('lobby_atualizado', {
                    jogadores: session.listaJogadores
                })
                emitTurnoAtualizado(io, session)
                emitEstado(io, session)
            }
        )

        // Mestre: virar carta 5
        socket.on('virar_carta5', ({ sessionId }: { sessionId: string }) => {
            const session = getSession(sessionId)
            if (!session) return

            const { row, col } = getBoardCoordsFromCasaId('C5')
            const card = session.estadoTabuleiro?.[row]?.[col] ?? null
            if (card && !card.revelada) {
                card.revelada = true
            }
            emitEstado(io, session)
        })

        // Mestre: reiniciar sessão
        socket.on(
            'reiniciar_sessao',
            ({ sessionId }: { sessionId: string }) => {
                const session = getSession(sessionId)
                if (!session) return

                resetSessionState(session)
                desafioFinalPendentePorSessao.delete(sessionId)
                nomesPendentesPorSessao.delete(sessionId)
                session.listaJogadores.forEach(player => {
                    bruxaEscolhaPendente.delete(
                        bruxaKey(sessionId, player.id)
                    )
                })

                eventService.iniciarRodada(session)
                io.to(session.id).emit('lobby_atualizado', {
                    jogadores: session.listaJogadores
                })
                emitEventoAtivo(io, session)
                emitTurnoAtualizado(io, session)
                emitEstado(io, session)
            }
        )

        // Mestre: exibir enigma para usuários (sem custo)
        socket.on(
            'mestre_exibir_enigma',
            ({
                sessionId,
                casaId,
                texto
            }: {
                sessionId: string
                casaId: string
                texto: string
            }) => {
                const session = getSession(sessionId)
                if (!session) return

                const textoNormalizado = (texto || '').trim()
                if (!textoNormalizado) {
                    socket.emit('acao_negada', {
                        motivo: 'Informe um texto para o enigma.'
                    })
                    return
                }
                try {
                    getBoardCoordsFromCasaId(casaId)
                } catch {
                    socket.emit('acao_negada', {
                        motivo: `Casa inválida: ${casaId}`
                    })
                    return
                }

                io.to(session.id).emit('enigma_exibido', {
                    casaId,
                    texto: textoNormalizado
                })
            }
        )

        socket.on(
            'mover_peao',
            ({
                sessionId,
                jogadorId,
                destinoId
            }: {
                sessionId: string
                jogadorId: string
                destinoId: string
            }) => {
                const session = getSession(sessionId)
                if (!session) return

                if (session.jogoFinalizado) {
                    socket.emit('acao_negada', { motivo: 'Jogo já finalizado' })
                    return
                }

                try {
                    assertJogadorDaVez(session, jogadorId)
                    assertSemRespostaPendente(session, jogadorId)
                    assertCarta5ReveladaParaMover(session)
                    actionManager.moverPeao(session, jogadorId, destinoId)
                    emitEstado(io, session)
                } catch (error) {
                    socket.emit('acao_negada', {
                        motivo: (error as Error).message
                    })
                }
            }
        )

        socket.on(
            'explorar_carta',
            ({
                sessionId,
                jogadorId,
                custoExploracao
            }: {
                sessionId: string
                jogadorId: string
                custoExploracao?: 0 | 1 | 2 | 3
            }) => {
                const session = getSession(sessionId)
                if (!session) return
                if (session.jogoFinalizado) {
                    socket.emit('acao_negada', { motivo: 'Jogo já finalizado' })
                    return
                }
                try {
                    assertJogadorDaVez(session, jogadorId)
                    assertSemRespostaPendente(session, jogadorId)
                    const player = session.listaJogadores.find(
                        p => p.id === jogadorId
                    )
                    if (!player) {
                        throw new Error('Jogador não encontrado')
                    }

                    // Explorar (1 PH): revela a carta onde o jogador está.
                    const casaId = player.posicao
                    const card = ensureCardOnBoard(
                        session,
                        casaId,
                        riddleController.getCustoPH(casaId)
                    )
                    card.revelada = true

                    actionManager.explorarCarta(session, 1)
                    emitEstado(io, session)
                } catch (error) {
                    socket.emit('acao_negada', {
                        motivo: (error as Error).message
                    })
                }
            }
        )

        socket.on(
            'responder_enigma',
            ({
                sessionId,
                jogadorId,
                texto,
                casaId,
                linhas
            }: {
                sessionId: string
                jogadorId: string
                texto: string
                casaId: string
                linhas?: {
                    easy: string
                    hard: string
                }
            }) => {
                const session = getSession(sessionId)
                if (!session) return
                const player = session.listaJogadores.find(
                    p => p.id === jogadorId
                )
                if (!player) return
                try {
                    if (session.jogoFinalizado) {
                        throw new Error('Jogo já finalizado')
                    }
                    assertJogadorDaVez(session, jogadorId)

                    if (session.riddlePendente) {
                        throw new Error(
                            'Já existe uma charada pendente para validação do Mestre.'
                        )
                    }

                    if (
                        player.hero.tipo === 'Sereia' &&
                        !session.habilidadesUsadasPorJogador[jogadorId]
                    ) {
                        io.to(session.id).emit('habilidade_usada', {
                            jogador: { id: player.id, nome: player.nome },
                            heroi: 'Sereia'
                        })
                        io.to(session.id).emit('sinal_dica_sutil', {
                            jogadorId,
                            heroi: 'Sereia'
                        })
                        session.habilidadesUsadasPorJogador[jogadorId] = true
                    }

                    // Regra: ao clicar para responder, o custo da casa é pago imediatamente.
                    const custoCasa = riddleController.getCustoPH(casaId)
                    session.riddlePendente = {
                        casaId,
                        custoPH: custoCasa,
                        jogadorId
                    }

                    const ajusteHeroi =
                        session.descontoEnigmaHeroiPorJogador[jogadorId] ?? 0
                    const descontoEvento =
                        session.eventoAtivo?.modificadores
                            ?.primeiroEnigmaDesconto &&
                            !session.primeiroEnigmaDescontoUsado
                            ? session.eventoAtivo.modificadores
                                .primeiroEnigmaDesconto
                            : 0
                    const custoBase = custoCasa
                    const custoCobrado = Math.max(
                        0,
                        custoBase + descontoEvento + ajusteHeroi
                    )

                    actionManager.resolverEnigma(
                        session,
                        custoBase as 0 | 1 | 2 | 3,
                        ajusteHeroi
                    )

                    // Desconto do Anão é consumido na ação atual
                    session.descontoEnigmaHeroiPorJogador[jogadorId] = 0

                    // Notificar todos (incluindo Mestre) sobre a submissão do enigma
                    io.to(session.id).emit('charada_iniciada', {
                        casaId,
                        texto,
                        jogador: {
                            id: player.id,
                            nome: player.nome
                        },
                        custoPH: custoCobrado
                    })

                    // Compat: manter o evento antigo para o socket do jogador
                    socket.emit('enigma_recebido', { texto, casaId })
                    emitEstado(io, session)
                } catch (error) {
                    socket.emit('acao_negada', {
                        motivo: (error as Error).message
                    })
                }
            }
        )

        socket.on(
            'confirm_answer',
            ({
                sessionId,
                jogadorId,
                quality
            }: {
                sessionId: string
                jogadorId: string
                quality: 'otima' | 'ruim'
            }) => {
                const session = getSession(sessionId)
                if (!session) return
                try {
                    if (session.jogoFinalizado) {
                        throw new Error('Jogo já finalizado')
                    }
                    assertJogadorDaVez(session, jogadorId)

                    const jogadorAtual = session.listaJogadores.find(
                        p => p.id === jogadorId
                    )

                    const resultado = riddleController.confirmarResposta(
                        session,
                        quality
                    )

                    const casaId = resultado.casaId
                    const ordem = parseInt(casaId.replace('C', '') || '0')

                    // Casa 5 não gera pista
                    if (casaId !== 'C5') {
                        const tipoPista: 'easy' | 'hard' =
                            quality === 'otima' ? 'easy' : 'hard'

                        // Atribuição aleatória (sem repetição) de fragmento por casa
                        let fragmentIndex =
                            session.puzzleDeck.assignedByHouse[casaId]
                        if (!fragmentIndex) {
                            const next = session.puzzleDeck.drawPile.shift()
                            if (!next) {
                                throw new Error(
                                    'Deck de fragmentos esgotado. Verifique se uma casa está concedendo mais de uma pista.'
                                )
                            }
                            fragmentIndex = next
                            session.puzzleDeck.assignedByHouse[casaId] =
                                fragmentIndex
                        }

                        const tip = getFinalRiddleFragment(
                            fragmentIndex,
                            tipoPista
                        )
                        const frontSource = getHouseTipFrontSource(casaId)

                        const existente = session.deckPistas.find(
                            c => c.casaId === casaId
                        )

                        if (existente) {
                            existente.tipo = tipoPista
                            existente.texto = tip.text
                            existente.source = tip.source
                            existente.frontSource = frontSource
                            existente.fragmentIndex = fragmentIndex
                            existente.ordem = ordem

                            io.to(session.id).emit('carta_pista_atualizada', {
                                carta: existente
                            })
                        } else {
                            const novaCartaPista: HintCard = {
                                id: generateHintCardId(),
                                casaId,
                                tipo: tipoPista,
                                texto: tip.text,
                                source: tip.source,
                                frontSource,
                                fragmentIndex,
                                ordem
                            }
                            session.deckPistas.push(novaCartaPista)

                            io.to(session.id).emit('carta_pista_adicionada', {
                                carta: novaCartaPista,
                                totalCartas: session.deckPistas.length
                            })
                        }

                        io.to(session.id).emit('pista_adicionada', {
                            casaId,
                            dificuldade: tipoPista,
                            pista: tip.text,
                            source: tip.source,
                            frontSource,
                            fragmentIndex
                        })
                    } else {
                        io.to(session.id).emit('pista_adicionada', {
                            casaId,
                            skipped: true
                        })
                    }

                    // Notificar validação para a sala (tela do Mestre usa isso para limpar a charada)
                    io.to(session.id).emit('resposta_validada', {
                        casaId,
                        acertou: quality === 'otima',
                        jogador: jogadorAtual
                            ? { id: jogadorAtual.id, nome: jogadorAtual.nome }
                            : { id: jogadorId, nome: '' }
                    })

                    // Registrar que a casa já teve resposta (para permitir "responder novamente")
                    session.registrosEnigmas[casaId] =
                        quality === 'otima' ? 'SucessoOtimo' : 'Ruim'

                    iniciarProximoTurno(io, session)
                    emitEstado(io, session)
                } catch (error) {
                    socket.emit('acao_negada', {
                        motivo: (error as Error).message
                    })
                }
            }
        )

        socket.on(
            'usar_habilidade_heroi',
            ({
                sessionId,
                jogadorId
            }: {
                sessionId: string
                jogadorId: string
            }) => {
                const session = getSession(sessionId)
                if (!session) return
                if (session.jogoFinalizado) {
                    socket.emit('acao_negada', { motivo: 'Jogo já finalizado' })
                    return
                }
                const player = session.listaJogadores.find(
                    p => p.id === jogadorId
                )
                if (!player) return
                try {
                    assertJogadorDaVez(session, jogadorId)
                    assertSemRespostaPendente(session, jogadorId)
                } catch (error) {
                    socket.emit('acao_negada', {
                        motivo: (error as Error).message
                    })
                    return
                }
                if (session.habilidadesUsadasPorJogador[jogadorId]) {
                    socket.emit('acao_negada', {
                        motivo: 'Habilidade já utilizada na partida'
                    })
                    return
                }

                switch (player.hero.tipo) {
                    case 'Anao':
                        if (
                            getCustoEnigmaSemHeroi(
                                session,
                                player.posicao
                            ) <= 0
                        ) {
                            socket.emit('acao_negada', {
                                motivo: 'A habilidade do Anão só pode ser usada quando o custo do enigma for maior que 0.'
                            })
                            return
                        }
                        io.to(session.id).emit('habilidade_usada', {
                            jogador: { id: player.id, nome: player.nome },
                            heroi: player.hero.tipo
                        })
                        session.descontoEnigmaHeroiPorJogador[jogadorId] = -1
                        session.habilidadesUsadasPorJogador[jogadorId] = true
                        break
                    case 'Humano':
                        {
                            const custoMover = actionManager.calcularCusto(
                                session,
                                'Mover',
                                1,
                                jogadorId
                            )
                            if (custoMover <= 0) {
                                socket.emit('acao_negada', {
                                    motivo: 'A habilidade do Humano só pode ser usada quando o custo de movimento for maior que 0.'
                                })
                                return
                            }
                        }
                        io.to(session.id).emit('habilidade_usada', {
                            jogador: { id: player.id, nome: player.nome },
                            heroi: player.hero.tipo
                        })
                        session.movimentoGratisHeroiPorJogador[jogadorId] = true
                        session.habilidadesUsadasPorJogador[jogadorId] = true
                        break
                    case 'Sereia':
                        socket.emit('acao_negada', {
                            motivo: 'A habilidade da Sereia só pode ser usada ao responder um enigma.'
                        })
                        return
                    case 'Bruxa': {
                        const key = bruxaKey(sessionId, jogadorId)
                        if (bruxaEscolhaPendente.has(key)) {
                            socket.emit('acao_negada', {
                                motivo: 'Habilidade da Bruxa já está em seleção. Escolha as cartas antes de tentar novamente.'
                            })
                            return
                        }

                        const ocultas = session.estadoTabuleiro
                            .flat()
                            .filter(
                                card =>
                                    card &&
                                    !card.revelada &&
                                    card.id !== 'C5'
                            ) as Card[]

                        if (ocultas.length === 0) {
                            socket.emit('acao_negada', {
                                motivo: 'Nenhuma carta oculta disponível para a Bruxa revelar (C5 não é permitido).'
                            })
                            return
                        }

                        bruxaEscolhaPendente.set(key, true)

                        // Enviar opções para o próprio jogador escolher (sem revelar custos ainda)
                        socket.emit('bruxa_escolher_cartas', {
                            opcoes: ocultas.map(card => ({ id: card.id }))
                        })
                        // Não marca como usada aqui; só quando o jogador confirmar a seleção.
                        emitEstado(io, session)
                        return
                    }
                }

                emitEstado(io, session)
            }
        )

        // Bruxa: jogador escolhe 1-2 cartas ocultas para ver o custo
        socket.on(
            'bruxa_revelar_custos',
            ({
                sessionId,
                jogadorId,
                casaIds
            }: {
                sessionId: string
                jogadorId: string
                casaIds: string[]
            }) => {
                const session = getSession(sessionId)
                if (!session) return

                if (session.jogoFinalizado) {
                    socket.emit('acao_negada', { motivo: 'Jogo já finalizado' })
                    return
                }

                const player = session.listaJogadores.find(
                    p => p.id === jogadorId
                )
                if (!player) return

                try {
                    assertJogadorDaVez(session, jogadorId)
                    assertSemRespostaPendente(session, jogadorId)
                } catch (error) {
                    socket.emit('acao_negada', {
                        motivo: (error as Error).message
                    })
                    return
                }

                if (player.hero.tipo !== 'Bruxa') {
                    socket.emit('acao_negada', {
                        motivo: 'Ação inválida: apenas a Bruxa pode revelar custos.'
                    })
                    return
                }

                if (session.habilidadesUsadasPorJogador[jogadorId]) {
                    socket.emit('acao_negada', {
                        motivo: 'Habilidade já utilizada na partida'
                    })
                    return
                }

                const key = bruxaKey(sessionId, jogadorId)
                if (!bruxaEscolhaPendente.has(key)) {
                    socket.emit('acao_negada', {
                        motivo: 'Nenhuma seleção pendente da Bruxa. Use a habilidade antes.'
                    })
                    return
                }

                const unique = Array.from(
                    new Set((casaIds || []).filter(Boolean))
                )
                if (unique.length === 0) {
                    socket.emit('acao_negada', {
                        motivo: 'Selecione ao menos uma carta.'
                    })
                    return
                }
                if (unique.length > 2) {
                    socket.emit('acao_negada', {
                        motivo: 'Selecione no máximo duas cartas.'
                    })
                    return
                }
                if (unique.some(id => id === 'C5')) {
                    socket.emit('acao_negada', {
                        motivo: 'A Bruxa não pode usar a habilidade na casa C5.'
                    })
                    return
                }

                const cartas: { id: string; custoExploracao: number }[] = []
                for (const casaId of unique) {
                    const { row, col } = getBoardCoordsFromCasaId(casaId)
                    const card = session.estadoTabuleiro?.[row]?.[col] ?? null
                    if (!card) {
                        socket.emit('acao_negada', {
                            motivo: `Casa inválida: ${casaId}`
                        })
                        return
                    }
                    if (card.revelada) {
                        socket.emit('acao_negada', {
                            motivo: `A casa ${casaId} já está revelada.`
                        })
                        return
                    }
                    cartas.push({
                        id: card.id,
                        custoExploracao: card.custoExploracao
                    })
                }

                // Enviar os custos apenas ao jogador que usou a habilidade
                socket.emit('custos_cartas_revelados', {
                    jogadorId,
                    cartas
                })

                // Notificar o mestre (em tempo real) com detalhes
                io.to(session.id).emit('habilidade_usada', {
                    jogador: { id: player.id, nome: player.nome },
                    heroi: 'Bruxa',
                    detalhes: { cartas }
                })

                bruxaEscolhaPendente.delete(key)
                session.habilidadesUsadasPorJogador[jogadorId] = true
                emitEstado(io, session)
            }
        )

        socket.on(
            'bruxa_cancelar',
            ({
                sessionId,
                jogadorId
            }: {
                sessionId: string
                jogadorId: string
            }) => {
                const key = bruxaKey(sessionId, jogadorId)
                bruxaEscolhaPendente.delete(key)
            }
        )

        // Salto Livre: movimento para qualquer casa não adjacente (2 PH, ou 1 PH com Atalho Efêmero)
        socket.on(
            'salto_livre',
            ({
                sessionId,
                jogadorId,
                destinoId
            }: {
                sessionId: string
                jogadorId: string
                destinoId: string
            }) => {
                const session = getSession(sessionId)
                if (!session) return

                if (session.jogoFinalizado) {
                    socket.emit('acao_negada', { motivo: 'Jogo já finalizado' })
                    return
                }

                try {
                    assertJogadorDaVez(session, jogadorId)
                    assertSemRespostaPendente(session, jogadorId)
                    assertCarta5ReveladaParaMover(session)
                    actionManager.saltoLivre(session, jogadorId, destinoId)
                    emitEstado(io, session)
                } catch (error) {
                    socket.emit('acao_negada', {
                        motivo: (error as Error).message
                    })
                }
            }
        )

        // Explorar Novamente: trocar a carta da posição atual (2 PH)
        socket.on(
            'explorar_novamente',
            ({
                sessionId,
                jogadorId,
                texto
            }: {
                sessionId: string
                jogadorId: string
                texto: string
            }) => {
                const session = getSession(sessionId)
                if (!session) return

                if (session.jogoFinalizado) {
                    socket.emit('acao_negada', { motivo: 'Jogo já finalizado' })
                    return
                }

                try {
                    assertJogadorDaVez(session, jogadorId)
                    assertSemRespostaPendente(session, jogadorId)

                    if (session.riddlePendente) {
                        throw new Error(
                            'Já existe uma charada pendente para validação do Mestre.'
                        )
                    }

                    const player = session.listaJogadores.find(
                        p => p.id === jogadorId
                    )
                    if (!player) {
                        throw new Error('Jogador não encontrado')
                    }

                    if (
                        player.hero.tipo === 'Sereia' &&
                        !session.habilidadesUsadasPorJogador[jogadorId]
                    ) {
                        io.to(session.id).emit('habilidade_usada', {
                            jogador: { id: player.id, nome: player.nome },
                            heroi: 'Sereia'
                        })
                        io.to(session.id).emit('sinal_dica_sutil', {
                            jogadorId,
                            heroi: 'Sereia'
                        })
                        session.habilidadesUsadasPorJogador[jogadorId] = true
                    }

                    const casaId = player.posicao
                    const { row, col } = getBoardCoordsFromCasaId(casaId)
                    const card = session.estadoTabuleiro?.[row]?.[col] ?? null

                    if (!card || !card.revelada) {
                        throw new Error(
                            'Ação negada: a carta precisa estar revelada para responder novamente.'
                        )
                    }

                    if (!session.registrosEnigmas[casaId]) {
                        throw new Error(
                            'Ação negada: só é possível responder novamente após a casa já ter sido respondida ao menos uma vez.'
                        )
                    }

                    // Regra: segunda tentativa tem custo fixo 2 PH (cobrado ao iniciar a tentativa)
                    actionManager.consumirPHFixo(session, 2)

                    session.riddlePendente = {
                        casaId,
                        custoPH: 2,
                        jogadorId,
                        isRetry: true
                    }

                    io.to(session.id).emit('charada_iniciada', {
                        casaId,
                        texto,
                        jogador: {
                            id: player.id,
                            nome: player.nome
                        },
                        custoPH: 2
                    })

                    socket.emit('enigma_recebido', { texto, casaId })
                    emitEstado(io, session)
                } catch (error) {
                    socket.emit('acao_negada', {
                        motivo: (error as Error).message
                    })
                }
            }
        )

        // Passar turno manualmente
        socket.on('passar_turno', ({ sessionId }: { sessionId: string }) => {
            const session = getSession(sessionId)
            if (!session) return

            if (session.jogoFinalizado) {
                socket.emit('acao_negada', { motivo: 'Jogo já finalizado' })
                return
            }

            iniciarProximoTurno(io, session)
            emitEstado(io, session)
        })

        // Posicionar carta de pista em slot do enigma final
        socket.on(
            'posicionar_pista_slot',
            ({
                sessionId,
                jogadorId,
                cardId,
                slotIndex
            }: {
                sessionId: string
                jogadorId: string
                cardId: string
                slotIndex: number
            }) => {
                const session = getSession(sessionId)
                if (!session) return
                if (session.jogoFinalizado) {
                    socket.emit('acao_negada', { motivo: 'Jogo já finalizado' })
                    return
                }
                try {
                    assertJogadorDaVez(session, jogadorId)
                    assertSemRespostaPendente(session, jogadorId)
                } catch (error) {
                    socket.emit('acao_negada', {
                        motivo: (error as Error).message
                    })
                    return
                }

                // Verificar se a carta existe no deck
                const carta = session.deckPistas.find(c => c.id === cardId)
                if (!carta) {
                    socket.emit('acao_negada', {
                        motivo: 'Carta não encontrada no deck'
                    })
                    return
                }

                // Verificar se o slot é válido
                if (
                    slotIndex < 0 ||
                    slotIndex >= session.slotsEnigmaFinal.length
                ) {
                    socket.emit('acao_negada', { motivo: 'Slot inválido' })
                    return
                }

                // Remover carta de qualquer slot anterior
                session.slotsEnigmaFinal.forEach(slot => {
                    if (slot.cardId === cardId) {
                        slot.cardId = null
                    }
                })

                // Posicionar carta no slot
                session.slotsEnigmaFinal[slotIndex].cardId = cardId

                // Recalcular texto montado
                session.textoEnigmaFinalMontado = session.slotsEnigmaFinal
                    .filter(slot => slot.cardId !== null)
                    .map(slot => {
                        const c = session.deckPistas.find(
                            p => p.id === slot.cardId
                        )
                        return c?.texto || ''
                    })
                    .join(' ')

                io.to(session.id).emit('slot_atualizado', {
                    slotsEnigmaFinal: session.slotsEnigmaFinal,
                    textoEnigmaFinalMontado: session.textoEnigmaFinalMontado,
                    todosSlotsPreenchiods: session.slotsEnigmaFinal.every(
                        s => s.cardId !== null
                    )
                })
                emitEstado(io, session)
            }
        )

        // Remover carta de um slot
        socket.on(
            'remover_pista_slot',
            ({
                sessionId,
                jogadorId,
                slotIndex
            }: {
                sessionId: string
                jogadorId: string
                slotIndex: number
            }) => {
                const session = getSession(sessionId)
                if (!session) return

                if (session.jogoFinalizado) {
                    socket.emit('acao_negada', { motivo: 'Jogo já finalizado' })
                    return
                }

                try {
                    assertJogadorDaVez(session, jogadorId)
                    assertSemRespostaPendente(session, jogadorId)
                } catch (error) {
                    socket.emit('acao_negada', {
                        motivo: (error as Error).message
                    })
                    return
                }

                if (
                    slotIndex >= 0 &&
                    slotIndex < session.slotsEnigmaFinal.length
                ) {
                    session.slotsEnigmaFinal[slotIndex].cardId = null

                    // Recalcular texto montado
                    session.textoEnigmaFinalMontado = session.slotsEnigmaFinal
                        .filter(slot => slot.cardId !== null)
                        .map(slot => {
                            const c = session.deckPistas.find(
                                p => p.id === slot.cardId
                            )
                            return c?.texto || ''
                        })
                        .join(' ')

                    io.to(session.id).emit('slot_atualizado', {
                        slotsEnigmaFinal: session.slotsEnigmaFinal,
                        textoEnigmaFinalMontado:
                            session.textoEnigmaFinalMontado,
                        todosSlotsPreenchiods: session.slotsEnigmaFinal.every(
                            s => s.cardId !== null
                        )
                    })
                    emitEstado(io, session)
                }
            }
        )

        // Responder Desafio Final (compilar)
        socket.on(
            'iniciar_desafio_final',
            ({
                sessionId,
                jogadorId
            }: {
                sessionId: string
                jogadorId: string
            }) => {
                const session = getSession(sessionId)
                if (!session) return

                if (session.jogoFinalizado) {
                    socket.emit('acao_negada', { motivo: 'Jogo já finalizado' })
                    return
                }

                try {
                    assertJogadorDaVez(session, jogadorId)
                    assertSemRespostaPendente(session, jogadorId)
                } catch (error) {
                    socket.emit('acao_negada', {
                        motivo: (error as Error).message
                    })
                    return
                }

                const slotsOk = todosSlotsEnigmaFinalPreenchidos(session)
                // Se PH esgotou, o desafio pode ser forçado mesmo sem slots completos.
                if (!slotsOk && session.ph > 0) {
                    socket.emit('acao_negada', {
                        motivo: 'Preencha todos os slots do enigma final antes de responder.'
                    })
                    return
                }

                const pendente = desafioFinalPendentePorSessao.get(session.id)
                if (pendente) {
                    socket.emit('acao_negada', {
                        motivo: 'Desafio final já está pendente para validação do Mestre.'
                    })
                    return
                }

                const player = session.listaJogadores.find(
                    p => p.id === jogadorId
                )
                desafioFinalPendentePorSessao.set(session.id, jogadorId)

                io.to(session.id).emit('desafio_final_iniciado', {
                    motivo: 'jogador_iniciou',
                    jogador: player
                        ? { id: player.id, nome: player.nome }
                        : { id: jogadorId, nome: '' },
                    textoEnigmaFinalMontado: session.textoEnigmaFinalMontado,
                    slotsPreenchidos: slotsOk,
                    ph: session.ph
                })
            }
        )

        socket.on(
            'confirmar_desafio_final',
            ({
                sessionId,
                jogadorId,
                correta
            }: {
                sessionId: string
                jogadorId: string
                correta: boolean
            }) => {
                const session = getSession(sessionId)
                if (!session) return

                if (session.jogoFinalizado) {
                    socket.emit('acao_negada', { motivo: 'Jogo já finalizado' })
                    return
                }

                try {
                    // Reaproveita a regra atual: validar com o jogador da vez
                    assertJogadorDaVez(session, jogadorId)
                } catch (error) {
                    socket.emit('acao_negada', {
                        motivo: (error as Error).message
                    })
                    return
                }

                const pendente = desafioFinalPendentePorSessao.get(session.id)
                if (!pendente) {
                    socket.emit('acao_negada', {
                        motivo: 'Nenhum desafio final pendente para validação do Mestre.'
                    })
                    return
                }

                // A resposta correta é "Herança Diamante"
                const respostaCorreta = 'Herança Diamante'
                const respostaEnviada = '(verbal na chamada)'

                session.jogoFinalizado = true
                desafioFinalPendentePorSessao.delete(session.id)

                if (correta) {
                    session.resultadoFinal = 'vitoria'
                    io.to(session.id).emit('jogo_finalizado', {
                        resultado: 'vitoria',
                        mensagem:
                            'Parabéns! O grupo identificou corretamente a Herança Diamante!',
                        respostaCorreta,
                        respostaEnviada
                    })
                } else {
                    session.resultadoFinal = 'derrota'
                    io.to(session.id).emit('jogo_finalizado', {
                        resultado: 'derrota',
                        mensagem:
                            'O grupo não conseguiu identificar o problema. A resposta correta era: Herança Diamante',
                        respostaCorreta,
                        respostaEnviada
                    })
                }

                emitEstado(io, session)
            }
        )

        // Obter informação do jogador da vez
        socket.on(
            'get_jogador_atual',
            ({ sessionId }: { sessionId: string }) => {
                const session = getSession(sessionId)
                if (!session) return

                const jogadorAtual = actionManager.getJogadorAtual(session)
                socket.emit('jogador_atual', {
                    jogadorAtualId: jogadorAtual?.id,
                    jogadorAtualNome: jogadorAtual?.nome,
                    jogadorAtualIndex: session.jogadorAtualIndex
                })
            }
        )
    })
}
