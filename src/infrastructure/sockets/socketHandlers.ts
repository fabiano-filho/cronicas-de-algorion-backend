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

// Contador global para IDs de cartas de pista
let hintCardIdCounter = 1

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
            slotsEnigmaFinal: session.slotsEnigmaFinal
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
                    deckEventos: [
                        'Fluxo Laminar',
                        'Eco do Contrato',
                        'Terreno Quebradiço',
                        'Atalho Efêmero',
                        'Névoa da Dúvida'
                    ],
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
                const hero = buildHero(heroiTipo)

                // Verificar se jogador já existe na sessão
                const existingPlayerIndex = session.listaJogadores.findIndex(
                    p => p.id === jogadorId
                )

                if (existingPlayerIndex !== -1) {
                    // Atualizar herói do jogador existente
                    session.listaJogadores[existingPlayerIndex].hero = hero
                } else {
                    // Criar novo jogador
                    const player = new Player({
                        id: jogadorId,
                        nome,
                        hero,
                        posicao: 'C5' // Posição inicial é sempre C5 (centro do tabuleiro)
                    })
                    session.listaJogadores.push(player)
                }

                socket.join(sessionId)

                // Emitir atualização do lobby para todos
                io.to(session.id).emit('lobby_atualizado', {
                    jogadores: session.listaJogadores
                })
                emitEstado(io, session)
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
                    actionManager.moverPeao(session, jogadorId, destinoId)
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
                    riddleController.registrarResposta(session, {
                        casaId,
                        jogadorId
                    })

                    // Notificar todos (incluindo Mestre) sobre a submissão do enigma
                    io.to(session.id).emit('charada_iniciada', {
                        casaId,
                        texto,
                        jogador: {
                            id: player.id,
                            nome: player.nome
                        },
                        custoPH: session.riddlePendente?.custoPH ?? null
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
                        session.descontoEnigmaHeroiPorJogador[jogadorId] = -1
                        break
                    case 'Humano':
                        session.movimentoGratisHeroiPorJogador[jogadorId] = true
                        break
                    case 'Sereia':
                        io.to(session.id).emit('sinal_dica_sutil', {
                            jogadorId,
                            heroi: 'Sereia'
                        })
                        break
                    case 'Bruxa': {
                        const ocultas = session.estadoTabuleiro
                            .flat()
                            .filter(card => card && !card.revelada) as Card[]

                        for (let i = ocultas.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1))
                            const tmp = ocultas[i]
                            ocultas[i] = ocultas[j]
                            ocultas[j] = tmp
                        }

                        const cartasOcultas = ocultas.slice(0, 2).map(card => ({
                            id: card.id,
                            custoExploracao: card.custoExploracao
                        }))

                        io.to(session.id).emit('custos_cartas_revelados', {
                            jogadorId,
                            cartas: cartasOcultas
                        })
                        break
                    }
                }

                session.habilidadesUsadasPorJogador[jogadorId] = true
                emitEstado(io, session)
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
                    actionManager.saltoLivre(session, jogadorId, destinoId)
                    iniciarProximoTurno(io, session)
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
                    actionManager.explorarNovamente(session)
                    // O Mestre deve revelar a nova carta manualmente
                    io.to(session.id).emit('explorar_novamente_solicitado', {
                        jogadorId,
                        posicao: session.listaJogadores.find(
                            p => p.id === jogadorId
                        )?.posicao
                    })
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
            'responder_desafio_final',
            ({
                sessionId,
                jogadorId,
                resposta
            }: {
                sessionId: string
                jogadorId: string
                resposta: string
            }) => {
                const session = getSession(sessionId)
                if (!session) return

                if (session.jogoFinalizado) {
                    socket.emit('acao_negada', { motivo: 'Jogo já finalizado' })
                    return
                }

                try {
                    assertJogadorDaVez(session, jogadorId)
                } catch (error) {
                    socket.emit('acao_negada', {
                        motivo: (error as Error).message
                    })
                    return
                }

                // A resposta correta é "Herança Diamante"
                const respostaCorreta = 'Herança Diamante'
                const respostaNormalizada = resposta.trim().toLowerCase()
                const corretaNormalizada = respostaCorreta.toLowerCase()

                session.jogoFinalizado = true

                if (respostaNormalizada === corretaNormalizada) {
                    session.resultadoFinal = 'vitoria'
                    io.to(session.id).emit('jogo_finalizado', {
                        resultado: 'vitoria',
                        mensagem:
                            'Parabéns! O grupo identificou corretamente a Herança Diamante!',
                        respostaCorreta,
                        respostaEnviada: resposta
                    })
                } else {
                    session.resultadoFinal = 'derrota'
                    io.to(session.id).emit('jogo_finalizado', {
                        resultado: 'derrota',
                        mensagem:
                            'O grupo não conseguiu identificar o problema. A resposta correta era: Herança Diamante',
                        respostaCorreta,
                        respostaEnviada: resposta
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
