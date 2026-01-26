import { GameSession } from '../entities/GameSession'
import { Player } from '../entities/Player'

export type ActionCostType =
    | 'Mover'
    | 'Explorar'
    | 'ResolverEnigma'
    | 'ExplorarNovamente'
    | 'SaltoLivre'

// Mapa de adjacências do tabuleiro 3x3
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
    private getPlayer(session: GameSession, playerId: string): Player {
        const player = session.listaJogadores.find(p => p.id === playerId)
        if (!player) {
            throw new Error('Jogador não encontrado')
        }
        return player
    }

    // Verifica se duas casas são ortogonalmente adjacentes
    public saoAdjacentes(origemId: string, destinoId: string): boolean {
        const adjacentes = ADJACENCIAS[origemId]
        return adjacentes ? adjacentes.includes(destinoId) : false
    }

    public calcularCusto(
        session: GameSession,
        tipo: ActionCostType,
        enigmaCusto: 0 | 1 | 2 | 3 = 1,
        playerId?: string
    ): number {
        let base: number
        const modificadores = session.eventoAtivo?.modificadores
        switch (tipo) {
            case 'Mover':
                base = 1
                const gratuitoEvento =
                    !!playerId &&
                    modificadores?.primeiroMovimentoGratisPorJogador &&
                    !session.primeiroMovimentoGratisUsadoPorJogador[playerId]
                const gratuitoHeroi =
                    !!playerId &&
                    session.movimentoGratisHeroiPorJogador[playerId]
                if (gratuitoEvento || gratuitoHeroi) {
                    return 0
                }
                return base + (modificadores?.moverDelta ?? 0)
            case 'Explorar':
                return 1
            case 'ResolverEnigma':
                return enigmaCusto
            case 'ExplorarNovamente':
                return 2
            case 'SaltoLivre':
                return modificadores?.saltoLivreCusto ?? 2
            default:
                return 1
        }
    }

    private consumirPH(session: GameSession, custo: number): void {
        if (session.ph < custo) {
            throw new Error('PH insuficiente')
        }
        session.ph -= custo
    }

    public moverPeao(
        session: GameSession,
        playerId: string,
        destinoId: string
    ): GameSession {
        const player = this.getPlayer(session, playerId)

        // Validar adjacência ortogonal
        if (!this.saoAdjacentes(player.posicao, destinoId)) {
            throw new Error(
                `Movimento inválido: ${player.posicao} não é adjacente a ${destinoId}. Use Salto Livre para casas não adjacentes.`
            )
        }

        const usadoEvento =
            session.eventoAtivo?.modificadores
                ?.primeiroMovimentoGratisPorJogador &&
            !session.primeiroMovimentoGratisUsadoPorJogador[playerId]
        const usadoHeroi = session.movimentoGratisHeroiPorJogador[playerId]
        const custo = this.calcularCusto(session, 'Mover', 1, playerId)
        this.consumirPH(session, custo)

        player.posicao = destinoId
        if (usadoEvento) {
            session.primeiroMovimentoGratisUsadoPorJogador[playerId] = true
        }
        if (usadoHeroi) {
            session.movimentoGratisHeroiPorJogador[playerId] = false
        }
        return session
    }

    public explorarCarta(
        session: GameSession,
        custoExploracao: 1 | 2 | 3
    ): GameSession {
        const custo = this.calcularCusto(session, 'Explorar')
        this.consumirPH(session, custo)
        return session
    }

    public resolverEnigma(
        session: GameSession,
        enigmaCusto: 0 | 1 | 2 | 3,
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
        const player = this.getPlayer(session, playerId)
        const custo = this.calcularCusto(session, 'SaltoLivre')
        this.consumirPH(session, custo)
        player.posicao = destinoId
        return session
    }

    // Verificar se PH chegou a 0 e forçar desafio final
    public verificarFimDeJogo(session: GameSession): boolean {
        if (session.ph <= 0 && !session.jogoFinalizado) {
            return true // Deve forçar o desafio final
        }
        return false
    }

    // Avançar para o próximo jogador
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
