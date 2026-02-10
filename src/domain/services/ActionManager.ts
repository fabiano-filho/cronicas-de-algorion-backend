import { GameSession } from '../entities/GameSession'
import { Player } from '../entities/Player'

export type ActionCostType =
    | 'Mover'
    | 'Explorar'
    | 'ResolverEnigma'
    | 'ExplorarNovamente'
    | 'SaltoLivre'

export type ActionBaseCosts = {
    mover: number
    explorar: number
    explorarNovamente: number
    saltoLivre: number
}

const DEFAULT_ACTION_COSTS: ActionBaseCosts = {
    mover: 1,
    explorar: 1,
    explorarNovamente: 2,
    saltoLivre: 2
}

// Mapa de adjacencias do tabuleiro 3x3
// C1 C2 C3
// C4 C5 C6
// C7 C8 C9
const ADJACENCIAS: Record<string, string[]> = {
    C1: ['C2', 'C4'],
    C2: ['C1', 'C3', 'C5'],
    C3: ['C2', 'C6'],
    C4: ['C1', 'C5', 'C7'],
    C5: ['C2', 'C4', 'C6', 'C8'],
    C6: ['C3', 'C5', 'C9'],
    C7: ['C4', 'C8'],
    C8: ['C5', 'C7', 'C9'],
    C9: ['C6', 'C8']
}

export class ActionManager {
    constructor(
        private resolveActionCosts: () => ActionBaseCosts = () =>
            DEFAULT_ACTION_COSTS
    ) {}

    private getActionCosts(): ActionBaseCosts {
        const costs = this.resolveActionCosts?.() ?? DEFAULT_ACTION_COSTS
        const safe = (value: unknown, fallback: number): number => {
            const parsed = Number(value)
            return Number.isFinite(parsed) ? parsed : fallback
        }

        return {
            mover: safe(costs.mover, DEFAULT_ACTION_COSTS.mover),
            explorar: safe(costs.explorar, DEFAULT_ACTION_COSTS.explorar),
            explorarNovamente: safe(
                costs.explorarNovamente,
                DEFAULT_ACTION_COSTS.explorarNovamente
            ),
            saltoLivre: safe(costs.saltoLivre, DEFAULT_ACTION_COSTS.saltoLivre)
        }
    }

    private getPlayer(session: GameSession, playerId: string): Player {
        const player = session.listaJogadores.find(p => p.id === playerId)
        if (!player) {
            throw new Error('Jogador nao encontrado')
        }
        return player
    }

    // Verifica se duas casas sao ortogonalmente adjacentes
    public saoAdjacentes(origemId: string, destinoId: string): boolean {
        const adjacentes = ADJACENCIAS[origemId]
        return adjacentes ? adjacentes.includes(destinoId) : false
    }

    private isEventFirstMoveFree(session: GameSession, playerId?: string): boolean {
        if (!playerId) return false
        const modifiers = session.eventoAtivo?.modificadores
        return (
            !!modifiers?.primeiroMovimentoGratisPorJogador &&
            !session.primeiroMovimentoGratisUsadoPorJogador[playerId]
        )
    }

    private isHeroMoveFree(session: GameSession, playerId?: string): boolean {
        if (!playerId) return false
        return !!session.movimentoGratisHeroiPorJogador[playerId]
    }

    private markEventFirstMoveUsed(session: GameSession, playerId?: string): void {
        if (!playerId) return
        session.primeiroMovimentoGratisUsadoPorJogador[playerId] = true
    }

    public calcularCusto(
        session: GameSession,
        tipo: ActionCostType,
        enigmaCusto = 1,
        playerId?: string
    ): number {
        const actionCosts = this.getActionCosts()
        const gratuitoEvento = this.isEventFirstMoveFree(session, playerId)
        const gratuitoHeroi = this.isHeroMoveFree(session, playerId)
        let base: number
        const modificadores = session.eventoAtivo?.modificadores

        switch (tipo) {
            case 'Mover':
                base = actionCosts.mover
                if (gratuitoEvento || gratuitoHeroi) {
                    return 0
                }
                return base + (modificadores?.moverDelta ?? 0)
            case 'Explorar':
                return actionCosts.explorar
            case 'ResolverEnigma':
                return enigmaCusto
            case 'ExplorarNovamente':
                return actionCosts.explorarNovamente
            case 'SaltoLivre':
                if (gratuitoEvento || gratuitoHeroi) {
                    return 0
                }
                return modificadores?.saltoLivreCusto ?? actionCosts.saltoLivre
            default:
                return actionCosts.mover
        }
    }

    private consumirPH(session: GameSession, custo: number): void {
        if (session.ph < custo) {
            throw new Error('PH insuficiente')
        }
        session.ph -= custo
    }

    public consumirPHFixo(session: GameSession, custo: number): void {
        this.consumirPH(session, custo)
    }

    public moverPeao(
        session: GameSession,
        playerId: string,
        destinoId: string
    ): GameSession {
        const player = this.getPlayer(session, playerId)

        // Validar adjacencia ortogonal
        if (!this.saoAdjacentes(player.posicao, destinoId)) {
            throw new Error(
                `Movimento invalido: ${player.posicao} nao e adjacente a ${destinoId}. Use Salto Livre para casas nao adjacentes.`
            )
        }

        const eventoGratuito = this.isEventFirstMoveFree(session, playerId)
        const heroGratuito = this.isHeroMoveFree(session, playerId)
        const custo = this.calcularCusto(session, 'Mover', 1, playerId)
        this.consumirPH(session, custo)

        player.posicao = destinoId
        if (eventoGratuito) {
            this.markEventFirstMoveUsed(session, playerId)
        }
        if (heroGratuito) {
            session.movimentoGratisHeroiPorJogador[playerId] = false
        }
        return session
    }

    public explorarCarta(session: GameSession): GameSession {
        const custo = this.calcularCusto(session, 'Explorar')
        this.consumirPH(session, custo)
        return session
    }

    public resolverEnigma(
        session: GameSession,
        enigmaCusto: number,
        ajusteHeroi: number = 0
    ): GameSession {
        const descontoEvento =
            session.eventoAtivo?.modificadores?.primeiroEnigmaDesconto &&
            !session.primeiroEnigmaDescontoUsado
                ? session.eventoAtivo.modificadores.primeiroEnigmaDesconto
                : 0
        const custoBase = enigmaCusto + descontoEvento
        const custoFinal = Math.max(0, custoBase + ajusteHeroi)
        this.consumirPH(session, custoFinal)
        if (descontoEvento !== 0) {
            session.primeiroEnigmaDescontoUsado = true
        }
        return session
    }

    public explorarNovamente(session: GameSession): GameSession {
        const custo = this.calcularCusto(session, 'ExplorarNovamente')
        this.consumirPH(session, custo)
        return session
    }

    public saltoLivre(
        session: GameSession,
        playerId: string,
        destinoId: string
    ): GameSession {
        const eventoGratuito = this.isEventFirstMoveFree(session, playerId)
        const heroGratuito = this.isHeroMoveFree(session, playerId)
        const player = this.getPlayer(session, playerId)
        const custo = this.calcularCusto(session, 'SaltoLivre', 1, playerId)
        this.consumirPH(session, custo)
        player.posicao = destinoId
        if (eventoGratuito) {
            this.markEventFirstMoveUsed(session, playerId)
        }
        if (heroGratuito) {
            session.movimentoGratisHeroiPorJogador[playerId] = false
        }
        return session
    }

    // Verificar se PH chegou a 0 e forcar desafio final
    public verificarFimDeJogo(session: GameSession): boolean {
        if (session.ph <= 0 && !session.jogoFinalizado) {
            return true
        }
        return false
    }

    // Avancar para o proximo jogador
    public avancarTurno(session: GameSession): void {
        if (session.listaJogadores.length === 0) return
        session.jogadorAtualIndex =
            (session.jogadorAtualIndex + 1) % session.listaJogadores.length
    }

    // Obter jogador da vez
    public getJogadorAtual(session: GameSession): Player | null {
        if (session.listaJogadores.length === 0) return null
        return session.listaJogadores[session.jogadorAtualIndex]
    }
}
